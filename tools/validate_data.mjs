/* ============================================================
   데이터 무결성 검증 (CI에서 빌드 전에 실행)
   맵 크기·타일 유효성, 스폰/적 배치, 스킬·캐릭터 참조 검사
   ============================================================ */
import fs from 'fs';
import {LUNJIAN_HEROES,LUNJIAN_ROUNDS,TRIALS,makeLunjianBattle} from '../src/challenges.js';
import {INTERNALS,HERO_INTERNALS,internalEffectText,validInternal,newlyUnlockedInternals} from '../src/internals.js';
import {ENEMY_MARTIALS,enemyMartialEffectText} from '../src/enemy-martials.js';
import {enemyMartialCounter} from '../src/combat-rules.js';
const J = f => JSON.parse(fs.readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const TILE = J('tiles.json'), SKILLS = J('skills.json'), CHARS = J('characters.json'), CHAPTERS = J('chapters.json');
const PORTRAITS = J('portraits.json');

const errs = [];
const validateTrialObjective=(objective,trial,path='objective')=>{
  if(!['rout','boss','survive','seize','escape','subdue','all','any'].includes(objective.type))errs.push(`trial/${trial.id} ${path} unknown type ${objective.type}`);
  if((objective.type==='all'||objective.type==='any')){
    if(!Array.isArray(objective.objectives)||!objective.objectives.length)errs.push(`trial/${trial.id} ${path} requires objectives`);
    (objective.objectives||[]).forEach((child,i)=>validateTrialObjective(child,trial,`${path}.${i}`));
  }
  if(objective.boss&&!trial.enemies.some(enemy=>enemy.cid===objective.boss))errs.push(`trial/${trial.id} ${path} boss missing ${objective.boss}`);
  if(objective.target&&!trial.enemies.some(enemy=>enemy.cid===objective.target))errs.push(`trial/${trial.id} ${path} target missing ${objective.target}`);
};
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
const campaignDir=new URL('../src/data/',import.meta.url);
const CAMPAIGN_FILES=fs.readdirSync(campaignDir)
  .filter(name=>/^stages_.+\.json$/.test(name))
  .map(name=>J(name));
const campaignById=id=>CAMPAIGN_FILES.find(campaign=>campaign.id===id);
const WOLNYEO=campaignById('wolnyeo'), HWALSA=campaignById('hwalsa');
const ITEMS = J('items.json');
const CAMPAIGN_MANIFEST = J('campaigns.json');
const STORY_EXPANSIONS = J('story_expansions.json');
const BATTLE_EXPANSIONS = J('battle_expansions.json');
const BATTLE_UPDATES = J('battle_updates.json');
const MAIN_CAMPAIGNS = new Set(['sajo','sinjo','uicheon','chunryong']);
const SPECIAL_OBJECTIVES = new Set(['survive','seize','escape','subdue','all','any']);
const SCENE_THEMES = new Set(['jianghu','jiangnan','taohua','xiangyang','guangming','shaolin','huashan']);
const specialCounts = Object.fromEntries([...MAIN_CAMPAIGNS].map(id=>[id,0]));
const flowStats=[];
for (const [campId,pack] of Object.entries(STORY_EXPANSIONS.campaigns||{})) {
  const camp=CAMPAIGN_FILES.find(c=>c.id===campId);
  if(!camp){ errs.push(`story expansion unknown campaign ${campId}`); continue; }
  for(const [anchorId,defs] of Object.entries(pack.after||{})){
    const anchor=camp.stages[anchorId];
    if(!anchor){ errs.push(`${campId}: expansion anchor missing ${anchorId}`); continue; }
    if(typeof anchor.next!=='string'){ errs.push(`${campId}: expansion anchor next must be string ${anchorId}`); continue; }
    const oldNext=anchor.next, ids=defs.map(d=>d.id);
    if(new Set(ids).size!==ids.length) errs.push(`${campId}: expansion duplicate ids after ${anchorId}`);
    anchor.next=ids[0]||oldNext;
    defs.forEach((def,i)=>{
      if(camp.stages[def.id]) errs.push(`${campId}: expansion id already exists ${def.id}`);
      camp.stages[def.id]={...JSON.parse(JSON.stringify(def)),next:ids[i+1]||oldNext};
    });
    const pos=camp.order.indexOf(anchorId);
    if(pos>=0) camp.order.splice(pos+1,0,...ids);
  }
}
const U6_STORY_MIN={sajo:5,sinjo:4,uicheon:4,chunryong:8};
for(const [campId,min] of Object.entries(U6_STORY_MIN)){
  const nodes=Object.values(STORY_EXPANSIONS.campaigns[campId]?.after||{}).flat().filter(node=>node.id?.startsWith('u6_'));
  if(nodes.length<min) errs.push(`${campId}: U6 story scenes ${nodes.length} < ${min}`);
}
for (const [campId,pack] of Object.entries(BATTLE_EXPANSIONS.campaigns||{})) {
  const camp=CAMPAIGN_FILES.find(c=>c.id===campId);
  if(!camp){ errs.push(`battle expansion unknown campaign ${campId}`); continue; }
  for(const [anchorId,defs] of Object.entries(pack.after||{})){
    const anchor=camp.stages[anchorId];
    if(!anchor||typeof anchor.next!=='string'){ errs.push(`${campId}: battle expansion anchor invalid ${anchorId}`); continue; }
    const oldNext=anchor.next, ids=defs.map(d=>d.id);
    anchor.next=ids[0]||oldNext;
    defs.forEach((raw,i)=>{
      const layout=BATTLE_EXPANSIONS.layouts[raw.layout];
      if(!layout) errs.push(`${campId}/${raw.id}: unknown battle layout ${raw.layout}`);
      camp.stages[raw.id]={...JSON.parse(JSON.stringify(layout||{})),...JSON.parse(JSON.stringify(raw)),next:ids[i+1]||oldNext};
    });
    const pos=camp.order.indexOf(anchorId);
    if(pos>=0) camp.order.splice(pos+1,0,...ids);
  }
}
const U6_BATTLE_MIN={sajo:4,sinjo:3,uicheon:3,chunryong:7};
for(const [campId,min] of Object.entries(U6_BATTLE_MIN)){
  const nodes=Object.values(BATTLE_EXPANSIONS.campaigns[campId]?.after||{}).flat();
  if(nodes.length<min) errs.push(`${campId}: U6 battle scenes ${nodes.length} < ${min}`);
}
{
  const w2=WOLNYEO.stages.w2.enemies.find(enemy=>enemy.boss), w3=WOLNYEO.stages.w3.enemies.find(enemy=>enemy.boss);
  if((WOLNYEO.startLvl||1)<3) errs.push('wolnyeo: startLvl must be at least 3');
  if(!w2||w2.guard>8||w2.wait<2) errs.push('wolnyeo/w2: boss relief settings regressed');
  if(!w3||w3.boost>.85||w3.guard>8||w3.wait<2) errs.push('wolnyeo/w3: boss relief settings regressed');
  if(CHARS.hsy.base[0]<30||CHARS.hsy.base[1]<10||CHARS.hsy.base[3]<8) errs.push('wolnyeo: heroine core stats regressed');
}
for (const [campId,updates] of Object.entries(BATTLE_UPDATES.campaigns||{})) {
  const camp=CAMPAIGN_FILES.find(c=>c.id===campId);
  if(!camp){ errs.push(`battle update unknown campaign ${campId}`); continue; }
  for(const [stageId,patch] of Object.entries(updates)){
    if(!camp.stages[stageId]){ errs.push(`${campId}: battle update stage missing ${stageId}`); continue; }
    Object.assign(camp.stages[stageId],JSON.parse(JSON.stringify(patch)));
  }
}
const CAMPAIGN_IDS = new Set([...CAMPAIGN_FILES.map(c=>c.id),'chronicle']);
const discoveredIds=CAMPAIGN_FILES.map(c=>c.id);
if(new Set(discoveredIds).size!==discoveredIds.length) errs.push('campaign files contain duplicate ids');
const declaredIds=new Set(CAMPAIGN_MANIFEST.groups.flatMap(group=>group.campaigns));
for(const id of discoveredIds) if(!declaredIds.has(id)) errs.push(`campaign file ${id}: missing from manifest groups`);
for(const id of declaredIds) if(id!=='chronicle'&&!discoveredIds.includes(id)) errs.push(`campaign manifest ${id}: stages file not discovered`);
for (const group of CAMPAIGN_MANIFEST.groups) {
  if (!group.id || !group.name || !Array.isArray(group.campaigns)) errs.push(`campaign group invalid ${JSON.stringify(group)}`);
  group.campaigns.forEach(id => { if (!CAMPAIGN_IDS.has(id)) errs.push(`campaign group ${group.id}: unknown ${id}`); });
}
for (const id of CAMPAIGN_IDS) {
  const meta=CAMPAIGN_MANIFEST.campaigns[id];
  if (!meta || !meta.canon || !meta.era || !meta.source) errs.push(`campaign meta invalid ${id}`);
}
for (const CAMP of CAMPAIGN_FILES) {
  const S = CAMP.stages;
  const CID = CAMP.id;
  const edges = new Map();
  if (!S[CAMP.start]) errs.push(`${CID}: start 노드 없음`);
  for (const id of CAMP.order) if (!S[id]) errs.push(`${CID} order: 미정의 노드 ${id}`);
  for (const id in S) {
    const n = S[id], tag = `${CID}/${id}`;
    const targets = [];
    if (typeof n.next === 'string') targets.push(n.next);
    if (n.next && typeof n.next === 'object' && n.next.cond) { n.next.cond.forEach(c => targets.push(c.to)); targets.push(n.next.else); }
    (n.rewardItems || []).forEach(ri => { if (!ITEMS[ri]) errs.push(`${tag} rewardItem unknown ${ri}`); });
    if (n.options) n.options.forEach(o => targets.push(o.to));
    edges.set(id, targets.filter(Boolean));
    (n.joins || []).forEach(j => { if (!CHARS[j]) errs.push(`${tag} joins unknown ${j}`); });
    if(n.joinLevel!==undefined&&(!Number.isInteger(n.joinLevel)||n.joinLevel<1||n.joinLevel>20)) errs.push(`${tag} joinLevel invalid ${n.joinLevel}`);
    if(n.source&&!['canon','short-story','recollection','original','noncanon'].includes(n.source)) errs.push(`${tag}: invalid source ${n.source}`);
    [...(n.pre || []), ...(n.post || [])].forEach((d, i) => { if (d.s && !CHARS[d.s]) errs.push(`${tag} dlg${i}: unknown speaker ${d.s}`); if(!d.t) errs.push(`${tag} dlg${i}: empty text`); });
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
      const objective=n.objective||n.win;
      if(MAIN_CAMPAIGNS.has(CID)&&SPECIAL_OBJECTIVES.has(objective.type)) specialCounts[CID]++;
      const validateObjective=(o,path='objective')=>{
        if (!['rout','boss','survive','seize','escape','subdue','all','any'].includes(o.type)) errs.push(`${tag} ${path} unknown type ${o.type}`);
        if ((o.type==='all'||o.type==='any')) {
          if(!Array.isArray(o.objectives)||!o.objectives.length) errs.push(`${tag} ${path} requires objectives`);
          (o.objectives||[]).forEach((child,i)=>validateObjective(child,`${path}.${i}`));
        }
        if (o.boss && !n.enemies.some(e => e.cid === o.boss)) errs.push(`${tag} ${path} boss ${o.boss} not on map`);
        if (o.target && !n.enemies.some(e => e.cid === o.target)) errs.push(`${tag} ${path} target ${o.target} not on map`);
        (o.protect||[]).forEach(cid=>{ if(!CHARS[cid]) errs.push(`${tag} ${path} protect unknown ${cid}`); });
        (o.tiles||o.zones||[]).forEach((t,i)=>{
          const [x,y]=Array.isArray(t)?t:[t.x,t.y];
          if(blocked(x,y)) errs.push(`${tag} ${path} tile${i} (${x},${y}) blocked`);
        });
      };
      validateObjective(objective);
      (n.bossPhases||[]).forEach((p,i)=>{
        if(!(p.at>0&&p.at<1)) errs.push(`${tag} bossPhase${i}.at invalid`);
        if(p.target&&!n.enemies.some(e=>e.cid===p.target&&e.boss)) errs.push(`${tag} bossPhase${i} target ${p.target} is not a deployed boss`);
        if(i>0&&p.at>n.bossPhases[i-1].at) errs.push(`${tag} bossPhase${i} thresholds must descend`);
        if(Math.max(0,...Object.values(p.stats||{}))>.35) errs.push(`${tag} bossPhase${i} stat boost exceeds 35%`);
        if((p.guardRatio||0)>.32) errs.push(`${tag} bossPhase${i} guardRatio exceeds 32%`);
      });
      if (n.weather && !['clear','snow','rain','fog','night'].includes(n.weather)) errs.push(`${tag} unknown weather ${n.weather}`);
      if (n.sceneTheme && !SCENE_THEMES.has(n.sceneTheme)) errs.push(`${tag} unknown sceneTheme ${n.sceneTheme}`);
      if (n.cut && (!Array.isArray(n.cut.lines) || !n.cut.lines.length)) errs.push(`${tag} cut.lines invalid`);
      if (n.cut && n.cut.bg && !['siege','duel','throne','snow','peak'].includes(n.cut.bg)) errs.push(`${tag} cut.bg unknown ${n.cut.bg}`);
      if (n.deploy && n.deploy.forced) n.deploy.forced.forEach(c => { if (!CHARS[c]) errs.push(`${tag} forced unknown ${c}`); });
    }
    if (n.kind === 'camp' && n.shop) n.shop.forEach(it => { if (!ITEMS[it]) errs.push(`${tag} shop unknown item ${it}`); });
  }
  const seen=new Set(), queue=[CAMP.start];
  while(queue.length){ const id=queue.shift(); if(seen.has(id)||!S[id])continue; seen.add(id); for(const to of (edges.get(id)||[])) if(!seen.has(to))queue.push(to); }
  for(const id of CAMP.order) if(!seen.has(id)) errs.push(`${CID}: 시작점에서 도달 불가 ${id}`);
  const reachableEnds=[...seen].filter(id=>S[id]?.kind==='end');
  if(!reachableEnds.length) errs.push(`${CID}: 시작점에서 도달 가능한 종막 없음`);
  const reverse=new Map([...seen].map(id=>[id,[]]));
  for(const [from,targets] of edges) for(const to of targets) if(reverse.has(to)) reverse.get(to).push(from);
  const canFinish=new Set(reachableEnds), finishQueue=[...reachableEnds];
  while(finishQueue.length){
    const id=finishQueue.shift();
    for(const from of (reverse.get(id)||[])) if(!canFinish.has(from)){ canFinish.add(from); finishQueue.push(from); }
  }
  for(const id of seen){
    if(S[id]?.kind!=='end'&&!(edges.get(id)||[]).length) errs.push(`${CID}/${id}: 종막이 아닌 막힌 경로`);
    if(!canFinish.has(id)) errs.push(`${CID}/${id}: 어떤 종막으로도 이어지지 않음`);
  }
  flowStats.push(`${CID} ${seen.size}노드/${reachableEnds.length}종막`);
  CAMP.party.forEach(c => { if (!CHARS[c]) errs.push(`${CID} party unknown ${c}`); });
}

/* ── 반실사 초상 자산 검증: 매니페스트·캐릭터·두 해상도 파일을 함께 확인 ── */
const portraitIds=PORTRAITS.ids||Object.keys(PORTRAITS.characters||{});
if(new Set(portraitIds).size!==portraitIds.length) errs.push('portrait ids contain duplicates');
for(const cid of Object.keys(CHARS)) if(!portraitIds.includes(cid)) errs.push(`portrait coverage missing ${cid}`);
for(const cid of portraitIds){
  if(!CHARS[cid]) errs.push(`portrait unknown character ${cid}`);
  const source=(PORTRAITS.aliases&&PORTRAITS.aliases[cid])||cid;
  if(PORTRAITS.aliases&&PORTRAITS.aliases[cid]&&!portraitIds.includes(source)) errs.push(`portrait ${cid}: alias target unknown ${source}`);
  for(const [size,maxBytes] of [['hero',220*1024],['thumb',30*1024]]){
    const url=new URL(`../public/portraits/${size}/${source}.webp`,import.meta.url);
    if(!fs.existsSync(url)){ errs.push(`portrait ${cid}: ${size} file missing`); continue; }
    const bytes=fs.statSync(url).size;
    if(bytes>maxBytes) errs.push(`portrait ${cid}: ${size} ${bytes} bytes exceeds ${maxBytes}`);
  }
}
let expressionCount=0;
for(const [cid,meta] of Object.entries(PORTRAITS.characters||{})){
  if(!portraitIds.includes(cid)) errs.push(`portrait metadata id not covered ${cid}`);
  if(!Array.isArray(meta.variants)||!meta.variants.includes('calm')) errs.push(`portrait ${cid}: calm variant missing`);
  for(const expression of (meta.variants||[]).filter(v=>v!=='calm')){
    expressionCount++;
    const url=new URL(`../public/portraits/expressions/${cid}-${expression}.webp`,import.meta.url);
    if(!fs.existsSync(url)){ errs.push(`portrait ${cid}: expression ${expression} missing`); continue; }
    if(fs.statSync(url).size>220*1024) errs.push(`portrait ${cid}: expression ${expression} exceeds 220KB`);
  }
}

const specialTotal=Object.values(specialCounts).reduce((sum,n)=>sum+n,0);
for(const [cid,count] of Object.entries(specialCounts)) if(count<3) errs.push(`${cid}: special battles ${count} < 3`);
if(specialTotal<12) errs.push(`main campaigns: special battles ${specialTotal} < 12`);
{
  for (const cid in CHARS) {
    const pr = CHARS[cid].promo;
    if (pr && (!ITEMS[pr.item] || (pr.skill && !SKILLS[pr.skill]))) errs.push(`char ${cid}: promo 참조 오류`);
  }
}

/* ── 인연(지원 대화) 검증 ── */
const SUPPORTS = J('supports.json');
{
  const seen = new Set();
  SUPPORTS.pairs.forEach((p, i) => {
    const tag = `support#${i} ${p.a}_${p.b}`;
    if (!CHARS[p.a]) errs.push(`${tag}: unknown a ${p.a}`);
    if (!CHARS[p.b]) errs.push(`${tag}: unknown b ${p.b}`);
    if (p.a === p.b) errs.push(`${tag}: 동일 인물`);
    const key = [p.a, p.b].sort().join('_');
    if (seen.has(key)) errs.push(`${tag}: 중복 페어`); seen.add(key);
    for (const rk of SUPPORTS.ranks) {
      const conv = p.convs[rk];
      if (!conv || !conv.length) { errs.push(`${tag}: ${rk} 대화 없음`); continue; }
      conv.forEach((ln, j) => {
        if (ln.s && !CHARS[ln.s]) errs.push(`${tag} ${rk}#${j}: unknown speaker ${ln.s}`);
        if (!ln.t) errs.push(`${tag} ${rk}#${j}: 빈 대사`);
      });
    }
  });
}

/* ── 데이터 기반 도전 모드 검증 ── */
{
  if(LUNJIAN_ROUNDS.length!==8) errs.push(`lunjian rounds ${LUNJIAN_ROUNDS.length} != 8`);
  if(TRIALS.length!==10) errs.push(`combat trials ${TRIALS.length} != 10`);
  for(const cid of LUNJIAN_HEROES) if(!CHARS[cid]) errs.push(`lunjian hero unknown ${cid}`);
  LUNJIAN_ROUNDS.forEach((round,index)=>{
    const battle=makeLunjianBattle(index,CHAPTERS),tag=`lunjian#${index+1}`;
    if(!CHARS[round.boss]) errs.push(`${tag} boss unknown ${round.boss}`);
    battle.enemies.forEach(enemy=>{if(!CHARS[enemy.cid])errs.push(`${tag} enemy unknown ${enemy.cid}`);});
    if(!battle.enemies.some(enemy=>enemy.cid===battle.win.boss&&enemy.boss))errs.push(`${tag} win boss missing`);
    (round.phases||[]).forEach((phase,i)=>{if(!(phase.at>0&&phase.at<1))errs.push(`${tag} phase${i} threshold invalid`);});
  });
  const trialIds=new Set();
  TRIALS.forEach(trial=>{
    const tag=`trial/${trial.id}`;
    if(trialIds.has(trial.id))errs.push(`${tag} duplicate id`);trialIds.add(trial.id);
    if(trial.map.length!==8||trial.map.some(row=>row.length!==12))errs.push(`${tag} map must be 12x8`);
    trial.map.forEach((row,y)=>[...row].forEach(tile=>{if(!TILE[tile])errs.push(`${tag} row${y} unknown tile ${tile}`);}));
    trial.party.forEach(cid=>{if(!CHARS[cid])errs.push(`${tag} party unknown ${cid}`);});
    trial.enemies.forEach(enemy=>{if(!CHARS[enemy.cid])errs.push(`${tag} enemy unknown ${enemy.cid}`);});
    validateTrialObjective(trial.objective,trial);
    if(!trial.goldText||!trial.silverText)errs.push(`${tag} medal text missing`);
    if(trial.gold.guardBreaks&&!trial.enemies.some(enemy=>(enemy.guard||0)>0||enemy.boss))errs.push(`${tag} gold requires guard break without guarded enemy`);
    if(trial.gold.bondStrikes){
      const hasBond=SUPPORTS.pairs.some(pair=>trial.party.includes(pair.a)&&trial.party.includes(pair.b));
      if(!hasBond)errs.push(`${tag} gold requires bond strikes without support pair`);
    }
    if(trial.gold.enemyKillsMax===0&&trial.objective.type!=='subdue')errs.push(`${tag} zero-kill gold requires subdue objective`);
    const leaves=(objective)=>objective.objectives?objective.objectives.flatMap(leaves):[objective];
    for(const objective of leaves(trial.objective)){
      const targets=objective.tiles||objective.zones||[];
      if(targets.length&&trial.gold.turns){
        const maxMove=Math.max(...trial.party.map(cid=>CHARS[cid].base[7]))*trial.gold.turns;
        for(const target of targets){
          const [x,y]=Array.isArray(target)?target:[target.x,target.y];
          const nearest=Math.min(...trial.spawns.slice(0,trial.party.length).map(([sx,sy])=>Math.abs(sx-x)+Math.abs(sy-y)));
          if(nearest>maxMove)errs.push(`${tag} gold target (${x},${y}) unreachable in ${trial.gold.turns} turns`);
        }
      }
    }
  });
}

/* ── 원작 기반 내공·고유 특성 검증 ── */
{
  const statKeys=new Set(['hp','str','int','def','res','spd','skl','mov','ki']);
  const allowedKinds=new Set(['내공','심법','경공','특성']);
  if(Object.keys(HERO_INTERNALS).length!==12)errs.push(`internal heroes ${Object.keys(HERO_INTERNALS).length} != 12`);
  for(const cid of LUNJIAN_HEROES){
    const options=HERO_INTERNALS[cid];
    if(!Array.isArray(options)||options.length<2)errs.push(`internal/${cid}: at least two options required`);
    if(validInternal(cid,'missing')!==options?.[0])errs.push(`internal/${cid}: default selection invalid`);
    for(const id of options||[]){
      const item=INTERNALS[id];
      if(!item){errs.push(`internal/${cid}: unknown ${id}`);continue;}
      if(!allowedKinds.has(item.kind))errs.push(`internal/${id}: invalid kind ${item.kind}`);
      if(!item.name||!item.role||!item.desc||!item.source)errs.push(`internal/${id}: documentation incomplete`);
      if(item.unlockLevel!==undefined&&(!Number.isInteger(item.unlockLevel)||item.unlockLevel<1))errs.push(`internal/${id}: invalid unlockLevel ${item.unlockLevel}`);
      if(!internalEffectText(id))errs.push(`internal/${id}: effect text missing`);
      for(const key of Object.keys(item.effects?.stats||{}))if(!statKeys.has(key))errs.push(`internal/${id}: invalid stat ${key}`);
      if((item.effects?.damage||0)>.2||(item.effects?.stationaryDamage||0)>.2||(item.effects?.damageTaken||0)>.2||(item.effects?.avoid||0)>12)errs.push(`internal/${id}: effect exceeds safety cap`);
    }
  }
  if(INTERNALS[HERO_INTERNALS.gj?.[0]]?.name!=='구음진경')errs.push('internal/gj: canonical default must be 구음진경');
  if((HERO_INTERNALS.gj||[]).some(id=>INTERNALS[id]?.name.includes('구양')))errs.push('internal/gj: 구양신공 must not be assigned to 곽정');
  for(const [id,item] of Object.entries(INTERNALS)){
    if(!item.unlock)continue;
    const camp=campaignById(item.unlock.campaign);
    if(!camp){errs.push(`internal/${id}: unlock campaign missing ${item.unlock.campaign}`);continue;}
    for(const stageId of [...(item.unlock.clearedAny||[]),...(item.unlock.reachedAny||[])])if(!camp.stages[stageId])errs.push(`internal/${id}: unlock stage missing ${item.unlock.campaign}/${stageId}`);
  }
  const growthProbe=newlyUnlockedInternals(
    {camp:'sajo',stageId:'s7',cleared:[]},
    {camp:'sajo',stageId:'s7',cleared:['s7']},
    ['gj'],
  );
  if(growthProbe.length!==1||growthProbe[0].id!=='gj_jiuyin')errs.push('internal growth reward probe failed');
}

/* ── R19~R20 주요 적 무학·파훼·예고 행동 검증 ── */
{
  if(Object.keys(ENEMY_MARTIALS).length!==20)errs.push(`enemy martials ${Object.keys(ENEMY_MARTIALS).length} != 20`);
  let actionCount=0;
  const actionShapes=new Set(['line','cross','cone','radius']);
  const campaignBosses=new Set(CAMPAIGN_FILES.flatMap(campaign=>Object.values(campaign.stages||{}).flatMap(stage=>(stage.enemies||[]).filter(enemy=>enemy.boss).map(enemy=>enemy.cid))));
  for(const [cid,style] of Object.entries(ENEMY_MARTIALS)){
    if(!CHARS[cid])errs.push(`enemy martial: unknown character ${cid}`);
    if(!style.name||!style.kind||!style.role||!style.source||!style.tell||!style.counter?.text)errs.push(`enemy martial/${cid}: documentation incomplete`);
    if(!enemyMartialEffectText(style))errs.push(`enemy martial/${cid}: effect text missing`);
    if(!Array.isArray(style.phases)||style.phases.length!==2)errs.push(`enemy martial/${cid}: two phases required`);
    if((style.effects?.damage||0)>.15||(style.effects?.skillDamage||0)>.1||(style.effects?.reflect||0)>.15||(style.effects?.avoid||0)>10)errs.push(`enemy martial/${cid}: effect exceeds safety cap`);
    const routes=[...(style.counter.types||[]),style.counter.minAllies?'allies':null,style.counter.combo?'combo':null].filter(Boolean);
    if(!routes.length)errs.push(`enemy martial/${cid}: counter route missing`);
    const probe=enemyMartialCounter(style,{attackerType:style.counter.types?.[0],adjacentAllies:style.counter.minAllies||0,comboStep:style.counter.combo?1:0});
    if(!probe.active||probe.guardDamage<1)errs.push(`enemy martial/${cid}: counter probe failed`);
    for(const action of style.actions||[]){
      actionCount++;
      if(!action.id||!action.name||!action.charge?.label)errs.push(`enemy martial/${cid}: boss action documentation incomplete`);
      if(!actionShapes.has(action.shape?.type)||!(action.shape?.range>=1&&action.shape.range<=6))errs.push(`enemy martial/${cid}: boss action shape invalid`);
      if(action.skill&&!SKILLS[action.skill])errs.push(`enemy martial/${cid}: boss action skill unknown ${action.skill}`);
      if(!['cancel','weaken'].includes(action.counter?.mode))errs.push(`enemy martial/${cid}: boss action counter mode invalid`);
      if(action.power<.8||action.power>1.3||Math.abs(action.hitBonus||0)>15)errs.push(`enemy martial/${cid}: boss action exceeds safety cap`);
      if(!campaignBosses.has(cid))errs.push(`enemy martial/${cid}: boss action has no campaign boss encounter`);
    }
  }
  if(actionCount!==8)errs.push(`boss actions ${actionCount} != 8`);
  if(CHARS.myeoljeol?.skills?.includes('wolnyeo')||!CHARS.myeoljeol?.skills?.includes('emei'))errs.push('character/myeoljeol: must use 아미검법, not 월녀검법');
  if(!CHARS.geumhwa?.skills?.includes('geumhwaamgi'))errs.push('character/geumhwa: 금화암기 missing');
  if(!CHARS.ichusu?.skills?.includes('baihong'))errs.push('character/ichusu: 백홍장력 missing');
  if(CHARS.scs?.skills?.includes('wolnyeo')||!CHARS.scs?.skills?.includes('geumjeong'))errs.push('character/scs: must use 금정면장 계통, not 월녀검법');
}

console.log(`챕터 ${CHAPTERS.length}개 · 캐릭터 ${Object.keys(CHARS).length}명 · 무공 ${Object.keys(SKILLS).length}종 · 인연 ${SUPPORTS.pairs.length}쌍 검사`);
console.log(`도전 모드 천하논검 ${LUNJIAN_ROUNDS.length}관 · 전투 수수께끼 ${TRIALS.length}제 검사`);
console.log(`원작 기반 내공·특성 ${Object.keys(INTERNALS).length}종 · 핵심 협객 ${Object.keys(HERO_INTERNALS).length}명 검사`);
console.log(`R19~R20 주요 적 무학·파훼 ${Object.keys(ENEMY_MARTIALS).length}종 · 예고 행동 8종 검사`);
console.log(`특수전 ${specialTotal}개 (${Object.entries(specialCounts).map(([id,n])=>`${id} ${n}`).join(' · ')}) · 반실사 초상 ${portraitIds.length}명 · 감정 원화 ${expressionCount}장 검사`);
console.log(`캠페인 완주 경로 ${flowStats.join(' · ')}`);
if (errs.length) { console.error('ERRORS:'); errs.forEach(e => console.error(' -', e)); process.exit(1); }
console.log('DATA VALIDATION OK');
