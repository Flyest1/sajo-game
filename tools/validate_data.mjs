/* ============================================================
   데이터 무결성 검증 (CI에서 빌드 전에 실행)
   맵 크기·타일 유효성, 스폰/적 배치, 스킬·캐릭터 참조 검사
   ============================================================ */
import fs from 'fs';
const J = f => JSON.parse(fs.readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const TILE = J('tiles.json'), SKILLS = J('skills.json'), CHARS = J('characters.json'), CHAPTERS = J('chapters.json');

const errs = [];
CHAPTERS.forEach((ch, ci) => {
  const tag = `ch${ci + 1}`;
  if (ch.map.length !== 10) errs.push(`${tag}: map rows=${ch.map.length}`);
  ch.map.forEach((row, y) => {
    if (row.length !== 14) errs.push(`${tag} row${y}: len=${row.length} "${row}"`);
    for (const c of row) if (!TILE[c]) errs.push(`${tag} row${y}: unknown tile '${c}'`);
  });
  const blocked = (x, y) => { const t = ch.map[y] && ch.map[y][x]; return !t || TILE[t].cost >= 99; };
  const occ = new Set();
  ch.spawns.forEach(([x, y], i) => {
    if (blocked(x, y)) errs.push(`${tag} spawn${i} (${x},${y}) blocked`);
    const k = x + ',' + y; if (occ.has(k)) errs.push(`${tag} dup spawn ${k}`); occ.add(k);
  });
  ch.enemies.forEach((e, i) => {
    if (!CHARS[e.cid]) errs.push(`${tag} enemy${i}: unknown cid ${e.cid}`);
    if (blocked(e.x, e.y)) errs.push(`${tag} enemy ${e.cid} (${e.x},${e.y}) blocked`);
    const k = e.x + ',' + e.y; if (occ.has(k)) errs.push(`${tag} enemy ${e.cid} overlaps ${k}`); occ.add(k);
  });
  (ch.reinforce || []).forEach(r => r.units.forEach(u => {
    if (!CHARS[u.cid]) errs.push(`${tag} reinf unknown cid ${u.cid}`);
    if (blocked(u.x, u.y)) errs.push(`${tag} reinf ${u.cid} (${u.x},${u.y}) blocked`);
  }));
  ch.joins.forEach(j => { if (!CHARS[j]) errs.push(`${tag} join unknown ${j}`); });
  (ch.learn || []).forEach(l => { if (!CHARS[l.cid] || !SKILLS[l.skill]) errs.push(`${tag} learn invalid ${JSON.stringify(l)}`); });
  if (ch.win.boss && !ch.enemies.some(e => e.cid === ch.win.boss)) errs.push(`${tag} win boss ${ch.win.boss} not on map`);
  [...ch.pre, ...ch.post].forEach((d, i) => { if (d.s && !CHARS[d.s]) errs.push(`${tag} dlg${i}: unknown speaker ${d.s}`); });
});
for (const id in CHARS) CHARS[id].skills.forEach(s => { if (!SKILLS[s]) errs.push(`char ${id}: unknown skill ${s}`); });


/* ── v2 캠페인 그래프 검증 ── */
const HWASAN = J('stages_hwasan.json');
const SAJO = J('stages_sajo.json');
const SINJO = J('stages_sinjo.json');
const ITEMS = J('items.json');
for (const CAMP of [HWASAN, SAJO, SINJO]) {
  const S = CAMP.stages;
  const CID = CAMP.id;
  if (!S[CAMP.start]) errs.push(`${CID}: start 노드 없음`);
  for (const id of CAMP.order) if (!S[id]) errs.push(`${CID} order: 미정의 노드 ${id}`);
  for (const id in S) {
    const n = S[id], tag = `${CID}/${id}`;
    const targets = [];
    if (typeof n.next === 'string') targets.push(n.next);
    if (n.next && typeof n.next === 'object' && n.next.cond) { n.next.cond.forEach(c => targets.push(c.to)); targets.push(n.next.else); }
    if (n.options) n.options.forEach(o => targets.push(o.to));
    (n.joins || []).forEach(j => { if (!CHARS[j]) errs.push(`${tag} joins unknown ${j}`); });
    targets.forEach(t => { if (!S[t]) errs.push(`${tag}: next 대상 없음 ${t}`); });
    if (n.kind === 'battle') {
      const H = n.map.length, W = n.map[0].length;
      if (H < 8 || H > 16) errs.push(`${tag}: map rows=${H} (8~16)`);
      if (W < 12 || W > 24) errs.push(`${tag}: map cols=${W} (12~24)`);
      n.map.forEach((row, y) => {
        if (row.length !== W) errs.push(`${tag} row${y}: len=${row.length} != ${W}`);
        for (const c of row) if (!TILE[c]) errs.push(`${tag} row${y}: unknown tile '${c}'`);
      });
      const blocked = (x, y) => { const t = n.map[y] && n.map[y][x]; return !t || TILE[t].cost >= 99; };
      const occ = new Set();
      n.spawns.forEach(([x, y], i) => {
        if (blocked(x, y)) errs.push(`${tag} spawn${i} (${x},${y}) blocked`);
        const k = x + ',' + y; if (occ.has(k)) errs.push(`${tag} dup spawn ${k}`); occ.add(k);
      });
      n.enemies.forEach(e => {
        if (!CHARS[e.cid]) errs.push(`${tag}: unknown cid ${e.cid}`);
        if (blocked(e.x, e.y)) errs.push(`${tag} enemy ${e.cid} (${e.x},${e.y}) blocked`);
        const k = e.x + ',' + e.y; if (occ.has(k)) errs.push(`${tag} enemy overlaps ${k}`); occ.add(k);
      });
      (n.reinforce || []).forEach(r => r.units.forEach(u => {
        if (!CHARS[u.cid]) errs.push(`${tag} reinf unknown ${u.cid}`);
        if (blocked(u.x, u.y)) errs.push(`${tag} reinf blocked (${u.x},${u.y})`);
      }));
      (n.treasures || []).forEach(t => {
        if (blocked(t.x, t.y)) errs.push(`${tag} treasure blocked (${t.x},${t.y})`);
        if (t.item && !ITEMS[t.item]) errs.push(`${tag} treasure unknown item ${t.item}`);
      });
      if (n.win.boss && !n.enemies.some(e => e.cid === n.win.boss)) errs.push(`${tag} boss ${n.win.boss} not on map`);
      if (n.deploy && n.deploy.forced) n.deploy.forced.forEach(c => { if (!CHARS[c]) errs.push(`${tag} forced unknown ${c}`); });
      [...(n.pre || []), ...(n.post || [])].forEach((d, i) => { if (d.s && !CHARS[d.s]) errs.push(`${tag} dlg${i}: unknown speaker ${d.s}`); });
    }
    if (n.kind === 'camp' && n.shop) n.shop.forEach(it => { if (!ITEMS[it]) errs.push(`${tag} shop unknown item ${it}`); });
  }
  CAMP.party.forEach(c => { if (!CHARS[c]) errs.push(`${CID} party unknown ${c}`); });
}
{
  for (const cid in CHARS) {
    const pr = CHARS[cid].promo;
    if (pr && (!ITEMS[pr.item] || (pr.skill && !SKILLS[pr.skill]))) errs.push(`char ${cid}: promo 참조 오류`);
  }
}

console.log(`챕터 ${CHAPTERS.length}개 · 캐릭터 ${Object.keys(CHARS).length}명 · 무공 ${Object.keys(SKILLS).length}종 검사`);
if (errs.length) { console.error('ERRORS:'); errs.forEach(e => console.error(' -', e)); process.exit(1); }
console.log('DATA VALIDATION OK');
