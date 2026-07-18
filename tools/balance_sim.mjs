/* ============================================================
   밸런스 자동 시뮬레이션 — calcStrike 공식을 재현해
   난이도별 대표 매치업의 명중률·처치 라운드 분포를 산출하고
   이상치(즉사·무피해·명중 과소)를 플래그한다. (오프라인, DOM 불필요)
   ============================================================ */
import fs from 'fs';
const J = f => JSON.parse(fs.readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const CHARS = J('characters.json'), SKILLS = J('skills.json'), TILE = J('tiles.json');

const DIFFS = {
  story: { enemy: 0.85 }, std: { enemy: 1.0 }, hero: { enemy: 1.15 },
};
function triangle(a, b) {
  if (a === b) return 0;
  if ((a === '외' && b === '경') || (a === '경' && b === '내') || (a === '내' && b === '외')) return 1;
  return -1;
}
function statObj(base) { return { hp: base[0], str: base[1], int: base[2], def: base[3], res: base[4], spd: base[5], skl: base[6], mov: base[7], ki: base[8] }; }
/* 성장: 평균 성장률로 레벨업 (기대값) */
function grownStats(cid, lvl) {
  const c = CHARS[cid]; const s = statObj(c.base); const g = c.grow;
  const names = ['hp', 'str', 'int', 'def', 'res', 'spd', 'skl'];
  for (let L = 1; L < lvl; L++) names.forEach((n, i) => { s[n] += g[i] / 100; });
  for (const k in s) s[k] = Math.round(s[k]);
  return s;
}
/* 엔진 calcStrike 재현 (장비·협공·인연·숙련·날씨 0 기준) */
function calc(a, d, sk, weatherHit = 0) {
  const tri = triangle(a.type, d.type);
  const atk = a.type === '내' ? a.stats.int : a.stats.str;
  const mit = a.type === '내' ? d.stats.res : d.stats.def;
  const dT = TILE['.'];
  let dmg = Math.max(0, Math.round(atk * (sk && sk.mult ? sk.mult : 1)) + tri * 2 - mit - dT.def);
  let hit = Math.max(10, Math.min(100, 82 + a.stats.skl * 2 + tri * 10 + (sk && sk.hit ? sk.hit : 0) - d.stats.spd * 2 - dT.avoid + weatherHit));
  let crit = Math.max(0, 4 + a.stats.skl - d.stats.skl);
  const dbl = !sk && (a.stats.spd >= d.stats.spd + 4);
  return { dmg, hit, crit, dbl };
}
function mkUnit(cid, lvl, diffEnemy, isEnemy) {
  const c = CHARS[cid];
  /* 아군: 기대 성장치 / 적: 고정 base(엔진과 동일, 성장 없음) */
  const st = isEnemy ? statObj(c.base) : grownStats(cid, lvl);
  if (isEnemy && diffEnemy && diffEnemy !== 1) for (const k of ['hp', 'str', 'int', 'def', 'res']) st[k] = Math.max(1, Math.round(st[k] * diffEnemy));
  return { cid, name: c.name, type: c.type, stats: st, maxhp: st.hp, hp: st.hp };
}
/* 기대 라운드: 평균 피해 × 명중으로 처치까지 라운드 수 (크리 포함) */
function expRounds(a, d) {
  const c = calc(a, d, null);
  const perHit = c.dmg * (1 + 0.6 * c.crit / 100) * (c.dbl ? 2 : 1);
  const perRound = perHit * (c.hit / 100);
  if (perRound <= 0.01) return { rounds: 99, hit: c.hit, dmg: c.dmg, dbl: c.dbl };
  return { rounds: d.maxhp / perRound, hit: c.hit, dmg: c.dmg, dbl: c.dbl };
}

/* 대표 매치업: 주요 아군 리더 vs 대표 적/보스, 캠페인 레벨대 */
const MATCHES = [
  { camp: '사조', ally: 'gj', lvl: 6, foes: ['dj', 'mcp', 'ygang', 'oyb'] },
  { camp: '신조', ally: 'yg', lvl: 10, foes: ['imsu', 'grb', 'gwd'] },
  { camp: '의천', ally: 'jmk', lvl: 12, foes: ['hbo', 'sgon', 'myeoljeol'] },
  { camp: '천룡', ally: 'sb', lvl: 12, foes: ['myb', 'gmj', 'jcc', 'yyh'] },
  { camp: '진최종', ally: 'gj', lvl: 14, foes: ['oyb', 'grb', 'myb', 'jcc'] },
];

const flags = [];
console.log('# 밸런스 시뮬레이션 (난이도별 대표 매치업)\n');
for (const diff of ['story', 'std', 'hero']) {
  const dm = DIFFS[diff].enemy;
  console.log(`## 난이도: ${diff} (적 ×${dm})`);
  for (const m of MATCHES) {
    const a = mkUnit(m.ally, m.lvl, 1, false);
    for (const fcid of m.foes) {
      if (!CHARS[fcid]) { console.log(`  ? 미존재 ${fcid}`); continue; }
      const d = mkUnit(fcid, 0, dm, true);
      const atk = expRounds(a, d);      // 아군 → 적
      const def = expRounds(d, a);      // 적 → 아군
      const line = `  ${m.camp} ${CHARS[m.ally].name}(L${m.lvl}) vs ${CHARS[fcid].name}: ` +
        `아군 명중 ${atk.hit}% 처치 ${atk.rounds.toFixed(1)}R | 적 명중 ${def.hit}% 처치 ${def.rounds.toFixed(1)}R`;
      console.log(line);
      // 이상치 판정
      if (def.rounds < 1.2) flags.push(`[즉사위험] ${diff} ${CHARS[fcid].name} → ${CHARS[m.ally].name} ${def.rounds.toFixed(1)}R`);
      if (atk.rounds < 1.0) flags.push(`[적 즉사] ${diff} ${CHARS[m.ally].name} → ${CHARS[fcid].name} ${atk.rounds.toFixed(1)}R (긴장감 저하)`);
      if (atk.hit < 45) flags.push(`[명중 과소] ${diff} ${CHARS[m.ally].name} → ${CHARS[fcid].name} ${atk.hit}%`);
      if (def.rounds > 12 && atk.rounds > 12) flags.push(`[교착] ${diff} ${CHARS[m.ally].name} vs ${CHARS[fcid].name} 양측 >12R`);
    }
  }
  console.log('');
}
console.log('## 이상치 플래그');
if (!flags.length) console.log('  (없음) — 대표 매치업이 건전한 곡선 안에 있습니다.');
else flags.forEach(f => console.log('  - ' + f));
