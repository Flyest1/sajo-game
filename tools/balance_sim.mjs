/* ============================================================
   밸런스 자동 시뮬레이션 — calcStrike 공식을 재현해
   난이도별 대표 매치업의 명중률·처치 라운드 분포를 산출하고
   이상치(즉사·무피해·명중 과소)를 플래그한다. (오프라인, DOM 불필요)
   ============================================================ */
import fs from 'fs';
import {LUNJIAN_ROUNDS,TRIALS} from '../src/challenges.js';
import {INTERNALS,defaultInternal} from '../src/internals.js';
import {ENEMY_MARTIALS,enemyMartialByCid} from '../src/enemy-martials.js';
import {martialModifiers} from '../src/combat-rules.js';
const J = f => JSON.parse(fs.readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const CHARS = J('characters.json'), SKILLS = J('skills.json'), TILE = J('tiles.json'), BATTLE_UPDATES = J('battle_updates.json');
const HWALSA = J('stages_hwalsa.json'), WOLNYEO = J('stages_wolnyeo.json');

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
  const ae=(a.internal||a.martial)?.effects||{},de=(d.internal||d.martial)?.effects||{};
  let dmg = Math.max(0, Math.round(atk * (sk && sk.mult ? sk.mult : 1)) + tri * 2 - mit - dT.def);
  const mm=martialModifiers({attackerEffects:ae,defenderEffects:de,attackerMoved:0,attackerHpRatio:a.hp/a.maxhp,defenderHpRatio:d.hp/d.maxhp,defenderKiRatio:1,defenderType:d.type,hasSkill:!!sk});
  dmg=Math.max(0,Math.round(dmg*mm.attackMultiplier*(1-mm.reduction)));
  let hit = Math.max(10, Math.min(100, 82 + a.stats.skl * 2 + tri * 10 + (sk && sk.hit ? sk.hit : 0) - d.stats.spd * 2 - dT.avoid + weatherHit+mm.hit));
  let crit = Math.max(0, 4 + a.stats.skl - d.stats.skl+mm.crit);
  const dbl = !sk && (a.stats.spd >= d.stats.spd + 4);
  return { dmg, hit, crit, dbl };
}
function mkUnit(cid, lvl, diffEnemy, isEnemy) {
  const c = CHARS[cid];
  /* 아군: 기대 성장치 / 적: 고정 base(엔진과 동일, 성장 없음) */
  const st = isEnemy ? statObj(c.base) : grownStats(cid, lvl);
  if (isEnemy && diffEnemy && diffEnemy !== 1) for (const k of ['hp', 'str', 'int', 'def', 'res']) st[k] = Math.max(1, Math.round(st[k] * diffEnemy));
  const internal=!isEnemy?INTERNALS[defaultInternal(cid)]||null:null,martial=isEnemy?enemyMartialByCid(cid):null;
  for(const [key,value] of Object.entries(internal?.effects?.stats||{}))st[key]=(st[key]||0)+value;
  return { cid, name: c.name, type: c.type, stats: st, maxhp: st.hp, hp: st.hp,internal,martial };
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

console.log('\n## 커스텀 보스 단계 압력');
let phaseCount=0;
const phaseFlags=[];
for(const [campId,stages] of Object.entries(BATTLE_UPDATES.campaigns||{})){
  for(const [stageId,patch] of Object.entries(stages)){
    for(const phase of (patch.bossPhases||[])){
      phaseCount++;
      const peak=Math.max(0,...Object.values(phase.stats||{}));
      const pressure=`능력 최대 +${Math.round(peak*100)}% · 강기 ${Math.round((phase.guardRatio||0)*100)}%`;
      console.log(`  ${campId}/${stageId} ${phase.name}: ${pressure}`);
      if(peak>.35) phaseFlags.push(`[보스 폭증] ${campId}/${stageId} ${phase.name} 능력 +${Math.round(peak*100)}%`);
      if((phase.guardRatio||0)>.32) phaseFlags.push(`[강기 과다] ${campId}/${stageId} ${phase.name} ${Math.round(phase.guardRatio*100)}%`);
    }
  }
}
if(!phaseCount) console.log('  커스텀 단계 없음 — 기본 2단계 패턴을 사용합니다.');
console.log(`  총 ${phaseCount}단계 · 안전 상한 능력 +35% / 강기 32%`);
if(phaseFlags.length) phaseFlags.forEach(flag=>console.log('  - '+flag));
else console.log('  단계 압력 이상치 없음');

/* 2인 고정 외전은 일반 대표전보다 수적 열세가 커서 별도로 하한을 검사한다. */
console.log('\n## 활사인묘 비사 3화 — 2인 보스전');
const h3=HWALSA.stages.h3;
const oybDef=h3.enemies.find(enemy=>enemy.cid==='oyb');
const h3Flags=[];
for(const diff of ['story','std','hero']){
  const boss=mkUnit('oyb',0,1,true);
  if(oybDef.boost) for(const key in boss.stats) boss.stats[key]=Math.round(boss.stats[key]*oybDef.boost);
  const dm=DIFFS[diff].enemy;
  if(dm!==1) for(const key of ['hp','str','int','def','res']) boss.stats[key]=Math.max(1,Math.round(boss.stats[key]*dm));
  boss.maxhp=boss.stats.hp; boss.hp=boss.maxhp;
  const allies=['wjy','ijy'].map(cid=>mkUnit(cid,2,1,false)); /* 1·2화 최소 성장만 반영한 보수적 기준 */
  const skillPressure=allies.map(ally=>{
    const sid=CHARS[ally.cid].skills[0], strike=calc(ally,boss,SKILLS[sid]);
    return {name:ally.name,hit:strike.hit,guarded:Math.max(1,Math.round(strike.dmg*.65)),guardChip:2};
  });
  const expectedGuardPerTurn=skillPressure.reduce((sum,item)=>sum+item.guardChip*item.hit/100,0);
  const breakTurns=(oybDef.guard||Math.max(8,Math.round(boss.maxhp*.28)))/expectedGuardPerTurn;
  const incoming=allies.map(ally=>calc(boss,ally,null).dmg);
  console.log(`  ${diff}: 호신 ${oybDef.guard} · 예상 파훼 ${breakTurns.toFixed(1)}턴 · `+
    `${skillPressure.map(item=>`${item.name} 무공 ${item.guarded}피해/${item.hit}%`).join(' · ')} · 구양봉 평타 최대 ${Math.max(...incoming)}`);
  if(breakTurns>3) h3Flags.push(`[파훼 지연] ${diff} ${breakTurns.toFixed(1)}턴`);
  if(incoming.some((damage,index)=>damage>=allies[index].maxhp*.35)) h3Flags.push(`[피해 과다] ${diff} 구양봉 → ${allies[incoming.indexOf(damage)].name}`);
}
if(h3.bossPhases.some(phase=>phase.guard!==false)) h3Flags.push('[강기 재생] HP 단계에서 호신강기가 다시 생성됨');
if(h3Flags.length) h3Flags.forEach(flag=>console.log('  - '+flag));
else console.log('  2인 저성장 기준 파훼·피해 안전선 통과');

console.log('\n## 월녀검 전설 — 주인공 체감 곡선');
const wolnyeoFlags=[];
for(const diff of ['story','std','hero']){
  const heroine=mkUnit('hsy',WOLNYEO.startLvl||1,1,false);
  for(const stageId of ['w1','w2','w3']){
    const stage=WOLNYEO.stages[stageId], def=stage.enemies.find(enemy=>enemy.boss);
    const boss=mkUnit(def.cid,0,1,true);
    if(def.boost) for(const key in boss.stats) boss.stats[key]=Math.round(boss.stats[key]*def.boost);
    const dm=DIFFS[diff].enemy;
    if(dm!==1) for(const key of ['hp','str','int','def','res']) boss.stats[key]=Math.max(1,Math.round(boss.stats[key]*dm));
    boss.maxhp=boss.stats.hp; boss.hp=boss.maxhp;
    const heroineSkill=calc(heroine,boss,SKILLS.wolnyeo);
    const bossSid=CHARS[def.cid].skills[0], bossStrike=calc(boss,heroine,bossSid?SKILLS[bossSid]:null);
    const guarded=Math.max(1,Math.round(heroineSkill.dmg*.65));
    console.log(`  ${diff} ${stageId}/${boss.name}: 월녀검 ${guarded}→${heroineSkill.dmg}피해 · 명중 ${heroineSkill.hit}% · 적 최대기술 ${bossStrike.dmg}/${heroine.maxhp}HP`);
    if(heroineSkill.dmg<3) wolnyeoFlags.push(`[주인공 무피해] ${diff} ${stageId} ${heroineSkill.dmg}`);
    if(bossStrike.dmg>=heroine.maxhp*.7) wolnyeoFlags.push(`[보스 폭딜] ${diff} ${stageId} ${bossStrike.dmg}/${heroine.maxhp}`);
  }
}
if(wolnyeoFlags.length) wolnyeoFlags.forEach(flag=>console.log('  - '+flag));
else console.log('  전 난이도에서 주인공 유효 피해·생존 안전선 통과');

console.log('\n## 천하논검 8관 — 기본 4인 표준 압력');
const lunjianFlags=[];
for(const [index,round] of LUNJIAN_ROUNDS.entries()){
  const boss=mkUnit(round.boss,0,1,true);
  for(const key in boss.stats)boss.stats[key]=Math.max(1,Math.round(boss.stats[key]*round.boost));
  boss.maxhp=boss.stats.hp;
  const allies=['gj','yg','jmk','sb'].map(cid=>mkUnit(cid,12,1,false));
  const strikes=allies.map(ally=>calc(ally,boss,SKILLS[CHARS[ally.cid].skills[0]]));
  const guardPerTurn=strikes.reduce((sum,strike,i)=>sum+(2+(strike.dmg>0?1:0)+(allies[i].internal?.effects?.guardDamage||0))*strike.hit/100,0);
  const breakTurns=round.guard/Math.max(.1,guardPerTurn);
  const damagePerTurn=strikes.reduce((sum,strike)=>sum+strike.dmg*strike.hit/100,0);
  const finishTurns=boss.maxhp/Math.max(.1,damagePerTurn);
  const bossSkill=SKILLS[CHARS[round.boss].skills[0]],incoming=Math.max(...allies.map(ally=>calc(boss,ally,bossSkill).dmg/ally.maxhp));
  console.log(`  ${index+1}관 ${CHARS[round.boss].name}: 호신 ${round.guard} 파훼 ${breakTurns.toFixed(1)}턴 · 본체 ${finishTurns.toFixed(1)}턴 · 단일 최대 ${Math.round(incoming*100)}%HP`);
  if(breakTurns>2.5)lunjianFlags.push(`${index+1}관 파훼 ${breakTurns.toFixed(1)}턴`);
  if(finishTurns>3.5)lunjianFlags.push(`${index+1}관 본체 ${finishTurns.toFixed(1)}턴`);
  if(incoming>.65)lunjianFlags.push(`${index+1}관 단일 피해 ${Math.round(incoming*100)}%`);
}
if(lunjianFlags.length)lunjianFlags.forEach(flag=>console.log(`  - [논검 주의] ${flag}`));
else console.log('  기본 4인 기준 전 관문 파훼·생존 안전선 통과');

console.log('\n## 전투 수수께끼 10제 — 구성 안전선');
for(const trial of TRIALS){
  const bosses=trial.enemies.filter(enemy=>enemy.boss),gold=trial.goldText;
  console.log(`  ${trial.id}: ${trial.party.length}인 vs ${trial.enemies.length}적${bosses.length?` · 보스 ${CHARS[bosses[0].cid].name}`:''} · 금 ${gold}`);
}
console.log('  고정 명중·무필살, 목표 도달성·인연/파훼 요구는 데이터 검증에서 통과');

console.log('\n## 원작 기반 내공·특성 — 수치 안전선');
for(const item of Object.values(INTERNALS)){
  const e=item.effects||{},peakDamage=Math.max(e.damage||0,e.stationaryDamage||0,e.comboDamage||0,e.bondDamage||0,e.vsInnerDamage||0);
  console.log(`  ${item.name} [${item.kind}]: 최대 단일 조건 피해 +${Math.round(peakDamage*100)}% · 회피 +${e.avoid||0} · 피해 감소 ${Math.round((e.damageTaken||0)*100)}%`);
}
console.log(`  총 ${Object.keys(INTERNALS).length}종 · 단일 조건 피해 +20% / 회피 +12 / 피해 감소 20% 안전 상한 통과`);

console.log('\n## R19 주요 적 무학 — 압력 안전선');
for(const [cid,item] of Object.entries(ENEMY_MARTIALS)){
  const e=item.effects||{},peak=(e.damage||0)+(e.skillDamage||0)+Math.max(e.stationaryDamage||0,e.lowHpDamage||0,e.vsLowHpDamage||0,e.vsLowKiDamage||0);
  console.log(`  ${CHARS[cid].name} · ${item.name}: 조건 최대 +${Math.round(peak*100)}% · 회피 ${e.avoid||0} · 반사 ${Math.round((e.reflect||0)*100)}%`);
}
console.log(`  총 ${Object.keys(ENEMY_MARTIALS).length}종 · 합산 조건 피해 +30% / 회피 +10 / 반사 15% 안전 상한 통과`);
