import { TS, TILE, SKILLS, CHARS, CHAPTERS, ENDING, ENEMY_IDS, TYPE_NAME, triangle } from './data.js';
import { buildPortraitDefs, ptSVG, tileSVG, unitSVG, titleArtSVG } from './gfx.js';
import { SFX, BGM, toggleSnd, sndOn } from './sfx.js';
import ITEMS from './data/items.json';
import HWASAN from './data/stages_hwasan.json';
import SAJO from './data/stages_sajo.json';
import SINJO from './data/stages_sinjo.json';
import UICHEON from './data/stages_uicheon.json';
import CHUNRYONG from './data/stages_chunryong.json';
import HOOILDAM from './data/stages_hooildam.json';
import JINFINAL from './data/stages_jinfinal.json';
import WOLNYEO from './data/stages_wolnyeo.json';
import DOKGO from './data/stages_dokgo.json';
import HWALSA from './data/stages_hwalsa.json';
import PUNGREUNG from './data/stages_pungreung.json';
import SUPPORTS from './data/supports.json';

/* ── 인연(지원) 시스템 ── */
function pairKey(a,b){ return a<b ? a+'_'+b : b+'_'+a; }
const SUPPORT_MAP = {};
for(const p of SUPPORTS.pairs) SUPPORT_MAP[pairKey(p.a,p.b)] = p;
const RANK_NAME = ['—','C','B','A'];
function bondRank(cidA,cidB){
  if(!V2||!V2.supports) return 0;
  return V2.supports[pairKey(cidA,cidB)]||0;
}
/* 유닛 u 기준, 인접 아군 중 최고 인연 랭크(0~3) */
function adjBond(u){
  if(!B||!V2) return 0;
  let best=0;
  for(const o of B.units){
    if(o.alive&&o!==u&&o.team===u.team&&dist(o,u)===1){
      const r=bondRank(u.cid,o.cid);
      if(r>best) best=r;
    }
  }
  return best;
}

/* ============================================================
   전투 엔진
   ============================================================ */

const G = { chapterIdx:0, roster:{}, party:[], snapshot:null, extraSkills:{}, deploy:null };
let B = null;       // 현재 전투 상태
let ENDLESS = null; // 영웅집결 무한 모드 상태 {wave, ch}
let uidSeq = 0;

/* ── 설정(난이도·속도) ── */
const DIFFS = {
  story: { name:'이야기', enemy:0.85, exp:1.3, gold:1.2, desc:'적 능력 -15% · 경험치 +30% · 자금 +20% — 편하게 이야기를 감상' },
  std:   { name:'표준',   enemy:1.0,  exp:1.0, gold:1.0, desc:'균형 잡힌 기본 난이도' },
  hero:  { name:'협객',   enemy:1.15, exp:0.9, gold:0.7, desc:'적 능력 +15% · 경험치 -10% · 자금 -30% — 도전적인 강호' },
};
const SPEEDS = [1, 1.5, 2];
function loadSettings(){
  try{ const s=JSON.parse(localStorage.getItem('kimyong_settings')||'null'); if(s) return Object.assign({diff:'std',speed:1,fastEnemy:false},s); }catch(e){}
  return { diff:'std', speed:1, fastEnemy:false };
}
let SETTINGS = loadSettings();
function saveSettings(){ try{ localStorage.setItem('kimyong_settings', JSON.stringify(SETTINGS)); }catch(e){} }
/* 현재 전투의 난이도(세이브에 고정) */
function curDiff(){
  const id = (B&&B.diff) || (V2&&V2.diff) || (ENDLESS&&ENDLESS.diff) || (G&&G.diff) || 'std';
  return DIFFS[id]||DIFFS.std;
}
/* 연출 속도: 적 페이즈 스킵 시 가속 */
function effSpeed(){
  let s=SETTINGS.speed||1;
  if(B&&B.phase==='E'&&SETTINGS.fastEnemy) s=Math.max(s,3);
  return s;
}
const aSleep = ms => sleep(ms/effSpeed());

/* ── 무공 숙련도 (전 모드 공유, 스킬별 사용 횟수 누적) ── */
const MASTERY_STEPS = [0, 8, 20, 40, 70]; // 숙련 단계(0~4) 진입 누적 사용 횟수
let SKILL_USE = (()=>{ try{ return JSON.parse(localStorage.getItem('kimyong_mastery')||'{}')||{}; }catch(e){ return {}; } })();
function masteryTier(sid){
  const n=SKILL_USE[sid]||0;
  let t=0; for(let i=MASTERY_STEPS.length-1;i>=0;i--){ if(n>=MASTERY_STEPS[i]){ t=i; break; } }
  return t;
}
function masteryLabel(sid){ const t=masteryTier(sid); return t?('숙련 '+['','★','★★','★★★','極'][t]):''; }
/* 숙련 보정: 위력 배수 +0.04/단계, 명중 +2/단계, 기 소모 -1/2단계 */
function masteryMultBonus(sid){ return masteryTier(sid)*0.04; }
function masteryHitBonus(sid){ return masteryTier(sid)*2; }
function masteryCost(sid){ const sk=SKILLS[sid]; return Math.max(1, (sk.cost||0) - Math.floor(masteryTier(sid)/2)); }
function bumpMastery(sid){
  const before=masteryTier(sid);
  SKILL_USE[sid]=(SKILL_USE[sid]||0)+1;
  try{ localStorage.setItem('kimyong_mastery', JSON.stringify(SKILL_USE)); }catch(e){}
  const after=masteryTier(sid);
  if(after>=MASTERY_STEPS.length-1 && before<MASTERY_STEPS.length-1) unlockAchv('mastery_max');
  return after>before ? after : 0; // 상승한 새 단계(없으면 0)
}

/* ── 전적 통계 ── */
let STATS = (()=>{ try{ return Object.assign({wins:0,kills:0,bosses:0,crits:0,camps:{}}, JSON.parse(localStorage.getItem('kimyong_stats')||'{}')); }catch(e){ return {wins:0,kills:0,bosses:0,crits:0,camps:{}}; } })();
function saveStats(){ try{ localStorage.setItem('kimyong_stats', JSON.stringify(STATS)); }catch(e){} }

/* ── 업적 시스템 ── */
const ACHV = [
  {id:'first_win', name:'첫 승리', desc:'전투에서 처음 승리한다'},
  {id:'flawless', name:'무결의 진', desc:'아군을 한 명도 잃지 않고 승리'},
  {id:'swift', name:'전광석화', desc:'3턴 이내에 전투를 끝낸다'},
  {id:'treasure', name:'보물 사냥꾼', desc:'한 전투의 모든 보물을 회수'},
  {id:'kills50', name:'백전의 협객', desc:'적을 누적 50명 격파'},
  {id:'kills200', name:'강호의 전설', desc:'적을 누적 200명 격파'},
  {id:'boss10', name:'거두 사냥', desc:'보스를 누적 10명 격파'},
  {id:'crit50', name:'필살의 달인', desc:'필살을 누적 50회 성공'},
  {id:'mastery_max', name:'무공 극의', desc:'어떤 무공이든 숙련 極에 도달'},
  {id:'bond_max', name:'생사지교', desc:'어떤 인연이든 A랭크에 도달'},
  {id:'promote', name:'환골탈태', desc:'협객을 처음 승급시킨다'},
  {id:'endless10', name:'십중포위', desc:'무한 모드 10파 격퇴'},
  {id:'endless20', name:'불굴의 아레나', desc:'무한 모드 20파 격퇴'},
  {id:'clear_sajo', name:'사조영웅전 완주', desc:'제1권을 완주'},
  {id:'clear_sinjo', name:'신조협려 완주', desc:'제2권을 완주'},
  {id:'clear_uicheon', name:'의천도룡기 완주', desc:'제3권을 완주'},
  {id:'clear_chunryong', name:'천룡팔부 완주', desc:'천룡팔부를 완주'},
  {id:'clear_hwasan', name:'화산논검 완주', desc:'외전Ⅰ을 완주'},
  {id:'clear_hooildam', name:'강호 후일담 완주', desc:'외전Ⅱ를 완주'},
  {id:'clear_side', name:'해금 외전 정복', desc:'해금 외전 4종을 모두 완주'},
  {id:'end_if', name:'초원의 약속', desc:'천룡팔부 — 아주 생존 IF 엔딩 달성'},
  {id:'clear_jinfinal', name:'영웅집결 제패', desc:'진최종전을 완주'},
  {id:'ng_plus', name:'회귀의 협객', desc:'회차(계승) 플레이를 시작'},
  {id:'all_camps', name:'천하제일', desc:'모든 캠페인을 완주'},
];
let ACHV_DONE = (()=>{ try{ return JSON.parse(localStorage.getItem('kimyong_achv')||'{}')||{}; }catch(e){ return {}; } })();
function unlockAchv(id){
  if(ACHV_DONE[id]) return;
  if(!ACHV.some(a=>a.id===id)) return;
  ACHV_DONE[id]=1;
  try{ localStorage.setItem('kimyong_achv', JSON.stringify(ACHV_DONE)); }catch(e){}
  const a=ACHV.find(x=>x.id===id);
  SFX.play('levelup');
  achvToast(a.name);
}
function achvToast(name){
  const el=document.createElement('div');
  el.className='achv-toast';
  el.innerHTML=`<b>🏅 업적 달성</b><br>${name}`;
  document.body.appendChild(el);
  setTimeout(()=>el.classList.add('show'),20);
  setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(),400); },2600);
}
/* 캠페인 완주 시 업적·통계 반영 */
function recordCampaignClear(camp, endId){
  STATS.camps[camp]=STATS.camps[camp]||{};
  STATS.camps[camp].cleared=1;
  STATS.camps[camp].end=endId;
  saveStats();
  const map={sajo:'clear_sajo',sinjo:'clear_sinjo',uicheon:'clear_uicheon',chunryong:'clear_chunryong',hwasan:'clear_hwasan',hooildam:'clear_hooildam',jinfinal:'clear_jinfinal'};
  if(map[camp]) unlockAchv(map[camp]);
  if(String(endId).indexOf('end_if')>=0) unlockAchv('end_if');
  if(['wolnyeo','dokgo','hwalsa','pungreung'].every(c=>STATS.camps[c]&&STATS.camps[c].cleared)) unlockAchv('clear_side');
  const allC=['sajo','sinjo','uicheon','chunryong','hwasan','hooildam','wolnyeo','dokgo','hwalsa','pungreung','jinfinal'];
  if(allC.every(c=>STATS.camps[c]&&STATS.camps[c].cleared)) unlockAchv('all_camps');
}
/* 전투 승리 시 업적 반영 */
function recordBattleWin(){
  STATS.wins++; saveStats();
  unlockAchv('first_win');
  if(B&&!B.allyLost) unlockAchv('flawless');
  if(B&&B.turn<=3) unlockAchv('swift');
  if(B&&B.treasures&&B.treasures.length&&B.treasures.every(t=>t.taken)) unlockAchv('treasure');
}

/* 현재 챕터(스토리) 또는 현재 웨이브(무한 모드) 정의 반환 */
function curCh(){ return ENDLESS ? ENDLESS.ch : (V2 && V2.curBattle ? V2.curBattle : CHAPTERS[G.chapterIdx]); }

/* 현재 맥락의 BGM 테마 (캠페인별 분위기) */
const BGM_THEME = { sajo:'heroic', sinjo:'heroic', uicheon:'heroic', chunryong:'chunryong',
  hwasan:'hwasan', hwalsa:'hwasan', wolnyeo:'heroic', dokgo:'gomyo', pungreung:'gomyo',
  hooildam:'heroic', jinfinal:'jinfinal' };
function bgmTheme(){
  if(V2&&V2.camp) return BGM_THEME[V2.camp]||'default';
  if(ENDLESS) return 'jinfinal';
  return 'default';
}
function startBGM(mood){ BGM.start(mood, bgmTheme()); }

const app = () => document.getElementById('app');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const deepClone = o => JSON.parse(JSON.stringify(o));
const dist = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

function statObj(base){
  return {hp:base[0],str:base[1],int:base[2],def:base[3],res:base[4],spd:base[5],skl:base[6],mov:base[7],ki:base[8]};
}
function initRosterChar(cid){
  if(G.roster[cid]) return;
  const c=CHARS[cid];
  G.roster[cid]={cid, lvl:1, exp:0, stats:statObj(c.base)};
  G.party.push(cid);
}

/* ── 전투 유닛 생성 ── */
function mkPlayerUnit(cid, x, y){
  const r=G.roster[cid], c=CHARS[cid];
  const extra=(G.extraSkills&&G.extraSkills[cid]||[]).filter(s=>!c.skills.includes(s));
  const stats=deepClone(r.stats);
  let eqAtk=0, eqHit=0, eqCrit=0;
  const eqBonus={def:0,res:0,mov:0,hp:0}; /* 능력치 표시용 장비 보정 분리 */
  if(V2&&V2.equips&&V2.equips[cid]){
    for(const slot of ['w','a']){
      const it=V2.equips[cid][slot]?ITEMS[V2.equips[cid][slot]]:null;
      if(!it) continue;
      eqAtk+=it.atk||0; eqHit+=it.hit||0; eqCrit+=it.crit||0;
      stats.def+=it.def||0; stats.res+=it.res||0; stats.mov+=it.mov||0; stats.hp+=it.hp||0;
      eqBonus.def+=it.def||0; eqBonus.res+=it.res||0; eqBonus.mov+=it.mov||0; eqBonus.hp+=it.hp||0;
    }
  }
  const cls=(V2&&V2.promoted&&V2.promoted[cid])||c.cls;
  const isLd=(V2&&CAMPAIGNS[V2.camp]&&CAMPAIGNS[V2.camp].leader)?(cid===CAMPAIGNS[V2.camp].leader):!!c.leader;
  return {uid:'u'+(uidSeq++), cid, name:c.name, cls, type:c.type, range:c.range,
    skills:[...c.skills, ...extra], healer:!!c.healer, leader:isLd, team:'P',
    x, y, stats, maxhp:stats.hp, hp:stats.hp,
    maxki:stats.ki, ki:stats.ki, lvl:r.lvl, exp:r.exp, acted:false, alive:true, boss:false, poison:0,
    eqAtk, eqHit, eqCrit, eqBonus};
}
function mkEnemyUnit(def){
  const c=CHARS[def.cid], st=statObj(c.base);
  const dm=curDiff().enemy;
  if(def.boost) for(const k in st) st[k]=Math.round(st[k]*def.boost);
  if(dm!==1) for(const k of ['hp','str','int','def','res']) st[k]=Math.max(1,Math.round(st[k]*dm));
  return {uid:'u'+(uidSeq++), cid:def.cid, name:c.name, cls:c.cls, type:c.type, range:c.range,
    skills:c.skills, healer:false, leader:false, team:'E',
    x:def.x, y:def.y, stats:st, maxhp:st.hp, hp:st.hp, maxki:st.ki, ki:st.ki,
    lvl:curCh().no*3, exp:0, acted:false, alive:true,
    boss:!!def.boss, wait:def.wait||0, poison:0};
}

/* ── 그리드 헬퍼 ── */
const inb = (x,y) => B && x>=0 && y>=0 && x<B.w && y<B.h;
const tileChar = (x,y) => B.map[y][x];
const unitAt = (x,y) => B.units.find(u=>u.alive && u.x===x && u.y===y);
const players = () => B.units.filter(u=>u.team==='P'&&u.alive);
const foes    = () => B.units.filter(u=>u.team==='E'&&u.alive);

function moveRange(u){
  const res=new Map(); res.set(u.x+','+u.y,0);
  const pq=[[0,u.x,u.y]];
  while(pq.length){
    pq.sort((a,b)=>a[0]-b[0]);
    const [c,x,y]=pq.shift();
    if(c>(res.get(x+','+y)??Infinity)) continue;
    for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+d[0], ny=y+d[1];
      if(!inb(nx,ny)) continue;
      let cost=TILE[tileChar(nx,ny)].cost;
      if(cost>=99) continue;
      if(u.type==='경'&&cost>1) cost-=1; /* 경공 특성: 험지 이동비용 -1 */
      const occ=unitAt(nx,ny);
      if(occ && occ.team!==u.team) continue;
      const nc=c+cost;
      if(nc>u.stats.mov) continue;
      if(nc<(res.get(nx+','+ny)??Infinity)){ res.set(nx+','+ny,nc); pq.push([nc,nx,ny]); }
    }
  }
  return res;
}
function stoppable(u,x,y){ const o=unitAt(x,y); return !o || o===u; }

/* ── 전투 계산 ── */
function adjAllies(u){
  if(!B) return 0;
  return Math.min(3, B.units.filter(o=>o.alive&&o!==u&&o.team===u.team&&dist(o,u)===1).length);
}
function calcStrike(a,d,skillId){
  const sk=skillId?SKILLS[skillId]:null;
  const tri=triangle(a.type,d.type);
  const atk=a.type==='내'?a.stats.int:a.stats.str;
  const mit=a.type==='내'?d.stats.res:d.stats.def;
  const dT=TILE[tileChar(d.x,d.y)];
  const supA=adjAllies(a), supD=adjAllies(d); /* 협공: 인접 아군 보정 */
  const bA=adjBond(a), bD=adjBond(d);        /* 인연: 인접 인연 아군 보정 (랭크 비례) */
  /* 무공 숙련도 보정 (아군 시전 시) */
  const mst=(sk&&a.team==='P')?masteryTier(skillId):0;
  const mMult=(sk&&a.team==='P')?masteryMultBonus(skillId):0;
  const mHit=(sk&&a.team==='P')?masteryHitBonus(skillId):0;
  let dmg=Math.max(0, Math.round(atk*((sk&&sk.mult?sk.mult:1)+mMult)) + tri*2 + supA + bA + (a.eqAtk||0) - mit - dT.def);
  const wHit=(B&&B.weather)?(WEATHER_HIT[B.weather]||0):0;
  let hit=Math.max(10, Math.min(100, 82 + a.stats.skl*2 + tri*10 + (sk&&sk.hit?sk.hit:0) + mHit + supA*4 + bA*4 - supD*3 - bD*3 + (a.eqHit||0) - d.stats.spd*2 - dT.avoid + wHit));
  let crit=Math.max(0, 4 + a.stats.skl - d.stats.skl + bA*2 + (a.eqCrit||0));
  const dbl=!sk && (a.stats.spd>=d.stats.spd+4);
  return {dmg,hit,crit,dbl,tri,supA,supD,bA,bD,mst};
}
function canCounter(d,a){ return d.alive && d.range.includes(dist(a,d)); }

/* ── 연출 ── */
function fx(x,y,txt,cls){
  const layer=document.getElementById('fx'); if(!layer) return;
  const el=document.createElement('div');
  el.className='dmgpop '+(cls||'');
  el.style.left=(x*TS+TS/2)+'px'; el.style.top=(y*TS+2)+'px';
  el.textContent=txt;
  layer.appendChild(el);
  setTimeout(()=>el.remove(),950);
}
async function banner(txt, enemy){
  const b=document.getElementById('banner'); if(!b) return;
  SFX.play('phase');
  b.textContent=txt; b.className='show'+(enemy?' enemy':'');
  await aSleep(950); b.className='';
}
/* 유닛 이동 트윈: 현재 좌표로 렌더 후, 이전 좌표에서 미끄러져 오는 연출 */
async function animMove(u, ox, oy){
  renderBattle(true);
  if(ox===u.x&&oy===u.y) return;
  const g=document.getElementById('ug-'+u.uid);
  const steps=Math.max(Math.abs(ox-u.x),Math.abs(oy-u.y));
  const dur=Math.min(460, 80*steps+130);
  SFX.play('move');
  if(!g){ await aSleep(160); return; }
  g.style.transition='none';
  g.style.transform=`translate(${(ox-u.x)*TS}px,${(oy-u.y)*TS}px)`;
  g.getBoundingClientRect(); /* reflow 강제 */
  const adur=dur/effSpeed();
  g.style.transition=`transform ${adur}ms cubic-bezier(.3,.7,.4,1)`;
  g.style.transform='translate(0,0)';
  await sleep(adur+40);
}
/* 선택 유닛을 (nx,ny)로 트윈 이동시킨 뒤 후속 동작 실행 */
function moveSelTo(nx,ny,after){
  const u=B.sel, ox=u.x, oy=u.y;
  u.x=nx; u.y=ny; B.mode='menu'; B.busy=true; hideMenu();
  animMove(u,ox,oy).then(()=>{ if(!B||!B.sel) return; B.busy=false; renderBattle(); after(); });
}
/* 공격 런지(돌진) 모션 */
async function lunge(a,d){
  SFX.play('attack');
  const g=document.getElementById('ug-'+a.uid); if(!g){ await sleep(90); return; }
  const dx=d.x-a.x, dy=d.y-a.y, m=Math.max(1,Math.abs(dx),Math.abs(dy));
  g.style.transition='transform .09s ease-in';
  g.style.transform=`translate(${dx/m*12}px,${dy/m*12}px)`;
  await aSleep(100);
  if(g.isConnected){ g.style.transition='transform .16s ease-out'; g.style.transform='translate(0,0)'; }
}
/* 피격 섬광 */
function flashTile(x,y,cls){
  const layer=document.getElementById('fx'); if(!layer) return;
  const el=document.createElement('div');
  el.className='hitflash '+(cls||'');
  el.style.left=(x*TS+TS/2-24)+'px'; el.style.top=(y*TS+TS/2-26)+'px';
  layer.appendChild(el);
  setTimeout(()=>el.remove(),450);
}
function shakeMap(big){
  const m=document.getElementById('mapsizer'); if(!m) return;
  m.classList.add('shake'); if(big) m.classList.add('big');
  setTimeout(()=>{ m.classList.remove('shake'); m.classList.remove('big'); },big?420:380);
}
function log(msg,imp){
  if(!B) return;
  B.log.unshift({msg,imp});
  if(B.log.length>40) B.log.pop();
  const el=document.getElementById('log');
  if(el) el.innerHTML=B.log.map(l=>`<div class="${l.imp?'imp':''}">${l.msg}</div>`).join('');
}

/* ── 경험치/레벨 ── */
function grantExp(u, amt){
  if(u.team!=='P'||!u.alive) return;
  u.exp+=Math.round(amt*curDiff().exp);
  while(u.exp>=100){
    u.exp-=100; u.lvl++;
    const ups=rollLevel(u);
    fx(u.x,u.y,'LEVEL UP!','label'); SFX.play('levelup');
    log(`<b>레벨 업!</b> ${u.name} Lv.${u.lvl} — ${ups.join('·')} 상승`,true);
  }
}
function rollLevel(u){
  const names=['hp','str','int','def','res','spd','skl'];
  const kor={hp:'HP',str:'힘',int:'내공',def:'방어',res:'정신',spd:'속도',skl:'기술'};
  const g=CHARS[u.cid].grow, ups=[];
  names.forEach((n,i)=>{
    if(Math.random()*100 < g[i]){
      u.stats[n]++; ups.push(kor[n]);
      if(n==='hp'){u.maxhp++;u.hp++;}
    }
  });
  if(!ups.length){ u.stats.hp++; u.maxhp++; u.hp++; ups.push('HP'); }
  u.stats.ki++; u.maxki++;
  return ups;
}

/* ── 상태이상: 중독 ── */
function poisonTick(team){
  for(const u of B.units.filter(u=>u.alive&&u.team===team&&u.poison>0)){
    u.hp=Math.max(1,u.hp-2); u.poison--;
    fx(u.x,u.y,'-2','miss');
    log(`${u.name} — 중독 피해 2${u.poison?` (남은 ${u.poison}턴)`:' (해독됨)'}`);
  }
}

/* ── 타격 1회 ── */
async function strike(a,d,skillId,followup){
  const c=calcStrike(a,d,skillId);
  const sk=skillId?SKILLS[skillId]:null;
  if(sk&&!followup){
    a.ki-=(a.team==='P'?masteryCost(skillId):sk.cost);
    fx(a.x,a.y,sk.name,'label'); SFX.play('skill');
    if(a.team==='P'){ const up=bumpMastery(skillId); if(up){ fx(a.x,a.y-0.4,'숙련 상승!','label'); SFX.play('levelup'); log(`<b>${a.name}</b>의 ${sk.name} — 숙련 ${['','★','★★','★★★','極'][up]} 단계 도달!`,true); } }
    await aSleep(420);
  }
  const roll=Math.random()*100;
  await lunge(a,d);
  if(roll<c.hit){
    let dmg=c.dmg;
    const isCrit=Math.random()*100<c.crit;
    if(isCrit) dmg=Math.round(dmg*1.6);
    d.hp=Math.max(0,d.hp-dmg);
    if(isCrit&&a.team==='P'){ STATS.crits++; if(STATS.crits>=50) unlockAchv('crit50'); saveStats(); }
    SFX.play(isCrit?'crit':'hit');
    flashTile(d.x,d.y,isCrit?'crit':'');
    shakeMap(isCrit);
    fx(d.x,d.y,dmg,isCrit?'crit':'');
    if(isCrit) log(`${a.name}의 <b>필살!</b> ${d.name}에게 ${dmg} 피해`);
    else log(`${a.name} → ${d.name} ${dmg} 피해`);
    grantExp(a, 8 + (sk?2:0));
    if(sk&&sk.poison&&d.hp>0&&!d.poison){
      d.poison=3; fx(d.x,d.y,'중독!','label'); SFX.play('poison');
      log(`${d.name}이(가) <b>중독</b>되었다! (3턴간 지속 피해)`,true);
    }
    if(d.hp<=0){
      d.alive=false;
      SFX.play('kill');
      fx(d.x,d.y,'격파!','label');
      if(d.team==='E'){
        grantExp(a, 30 + Math.max(0,(d.lvl-a.lvl))*4 + (d.boss?40:0));
        log(`<b>${d.name} 격파!</b>`,true);
        if(a.team==='P'){ STATS.kills++; if(d.boss) STATS.bosses++;
          if(STATS.kills>=50) unlockAchv('kills50'); if(STATS.kills>=200) unlockAchv('kills200');
          if(STATS.bosses>=10) unlockAchv('boss10'); saveStats(); }
      }else{
        if(B) B.allyLost=true;
        log(`<b>${d.name}이(가) 부상으로 이탈했다…</b>`,true);
      }
    }
  }else{
    SFX.play('miss');
    const gd=document.getElementById('ug-'+d.uid);
    if(gd){ gd.style.transition='transform .1s ease-out'; gd.style.transform='translate(-7px,0)';
      setTimeout(()=>{ if(gd.isConnected){ gd.style.transition='transform .14s ease-in'; gd.style.transform='translate(0,0)'; } },110); }
    fx(d.x,d.y,'회피!','miss');
    log(`${a.name}의 공격, ${d.name}이(가) 회피`);
  }
  await aSleep(260); /* 런지 복귀·회피 모션이 끝난 뒤 렌더 */
  renderBattle(true);
  await aSleep(300);
}

/* ── 교전(공격+반격+추격) ── */
async function combat(a,d,skillId){
  B.busy=true;
  const pre=calcStrike(a,d,skillId);
  const skA=skillId?SKILLS[skillId]:null;
  await strike(a,d,skillId);
  if(checkEnd()) return;
  if(skA&&skA.dbl&&a.alive&&d.alive){ /* 좌우호박: 무공 2연격 */
    await strike(a,d,skillId,true);
    if(checkEnd()) return;
  }
  if(d.alive && canCounter(d,a)){
    await strike(d,a,null);
    if(checkEnd()) return;
  }
  if(a.alive && d.alive && pre.dbl){
    await strike(a,d,null);
    if(checkEnd()) return;
  }
  if(a.alive && d.alive && canCounter(d,a) && calcStrike(d,a,null).dbl){
    await strike(d,a,null);
    if(checkEnd()) return;
  }
  B.busy=false;
}

/* ── 치료 ── */
async function healAction(a,t,skillId){
  B.busy=true;
  const sid=skillId||a.skills[0];
  const sk=SKILLS[sid];
  a.ki-=(a.team==='P'?masteryCost(sid):sk.cost);
  const mstAmt=(a.team==='P')?masteryTier(sid):0;
  const amt=a.stats.int+sk.healPow+mstAmt;
  t.hp=Math.min(t.maxhp,t.hp+amt);
  fx(a.x,a.y,sk.name,'label'); SFX.play('skill');
  if(a.team==='P'){ const up=bumpMastery(sid); if(up){ fx(a.x,a.y-0.4,'숙련 상승!','label'); SFX.play('levelup'); log(`<b>${a.name}</b>의 ${sk.name} — 숙련 ${['','★','★★','★★★','極'][up]} 단계 도달!`,true); } }
  await aSleep(380);
  fx(t.x,t.y,'+'+amt,'heal'); SFX.play('heal');
  log(`${a.name}의 ${sk.name} — ${t.name} ${amt} 회복`);
  grantExp(a,14);
  renderBattle(true);
  await aSleep(450);
  B.busy=false;
}

/* ── 승패 판정 ── */
function checkEnd(){
  if(B.over) return true;
  const ch=curCh();
  const leaderDown=B.units.some(u=>u.leader&&!u.alive);
  if(leaderDown||players().length===0){
    B.over=true; B.busy=true;
    setTimeout(()=>showDefeat(),800);
    return true;
  }
  let win=false;
  const pendingReinf=(ch.reinforce||[]).some((r,i)=>!(B.reinfDone||[]).includes(i));
  if(ch.win.boss && !B.units.some(u=>u.team==='E'&&u.cid===ch.win.boss&&u.alive)) win=true;
  if(!win && foes().length===0 && !pendingReinf) win=true;
  if(win){
    B.over=true; B.busy=true;
    setTimeout(()=>showVictory(),800);
    return true;
  }
  return false;
}

/* ── 플레이어 조작 ── */
function clearSel(){
  if(B.sel && B.orig && !B.sel.acted){ B.sel.x=B.orig.x; B.sel.y=B.orig.y; }
  B.sel=null; B.orig=null; B.mode='idle'; B.mr=null; B.inspect=null;
  hideMenu(); renderBattle();
}
function selectUnit(u){
  SFX.play('select');
  B.sel=u; B.orig={x:u.x,y:u.y}; B.mode='move'; B.mr=moveRange(u); B.inspect=null;
  renderBattle();
}
function inspectEnemy(u){
  if(B.inspect===u){ B.inspect=null; B.mr=null; }
  else { B.inspect=u; B.mr=moveRange(u); B.sel=null; B.mode='idle'; }
  renderBattle();
}
function attackTiles(u,mr){
  const set=new Set();
  for(const k of mr.keys()){
    const [x,y]=k.split(',').map(Number);
    if(!stoppable(u,x,y)) continue;
    for(const r of u.range){
      for(let dx=-r;dx<=r;dx++){
        const dy=r-Math.abs(dx);
        for(const yy of (dy===0?[y]:[y-dy,y+dy])){
          const xx=x+dx;
          if(inb(xx,yy)) set.add(xx+','+yy);
        }
      }
    }
  }
  return set;
}
function pickAttackPos(u,target,mr){
  let best=null;
  for(const k of mr.keys()){
    const [x,y]=k.split(',').map(Number);
    if(!stoppable(u,x,y)) continue;
    const dd=Math.abs(target.x-x)+Math.abs(target.y-y);
    if(!u.range.includes(dd)) continue;
    const sc=TILE[tileChar(x,y)].avoid + TILE[tileChar(x,y)].def*10 - mr.get(k)*0.1;
    if(!best||sc>best.sc) best={x,y,sc};
  }
  return best;
}

function onTile(x,y){
  if(!B||B.busy||B.over||B.phase!=='P') return;
  const u=unitAt(x,y);
  B.tileSel={x,y};
  if(u) UCARD_HIDE=false; /* 유닛 클릭 → 팝업 카드 다시 표시 */
  if(B.mode==='idle'){
    if(u&&u.team==='P'&&!u.acted) selectUnit(u);
    else if(u&&u.team==='E') inspectEnemy(u);
    else { B.inspect=null; B.mr=null; renderBattle(); }
  }
  else if(B.mode==='move'){
    const k=x+','+y;
    if(u===B.sel){ openMenu(); return; }
    if(u&&u.team==='E'){
      const pos=pickAttackPos(B.sel,u,B.mr);
      if(pos){ moveSelTo(pos.x,pos.y,()=>openForecast(B.sel,u,null)); return; }
      clearSel(); inspectEnemy(u); return;
    }
    if(B.mr.has(k)&&stoppable(B.sel,x,y)){
      moveSelTo(x,y,openMenu);
    } else clearSel();
  }
  else if(B.mode==='target-attack'||B.mode==='target-skill'){
    const skill=B.mode==='target-skill'?B.sel.skills[B.skillIdx]:null;
    if(u&&u.team==='E'&&B.targets.includes(u)) openForecast(B.sel,u,skill);
    else backToMenu();
  }
  else if(B.mode==='target-heal'){
    if(u&&u.team==='P'&&B.targets.includes(u)){
      const a=B.sel, sid=a.skills[B.skillIdx];
      hideMenu(); B.mode='idle';
      healAction(a,u,sid).then(()=>{ finishUnit(a); });
    } else backToMenu();
  }
  else if(B.mode==='menu'){ backToMenu(); }
}
function backToMenu(){ B.mode='menu'; B.targets=null; renderBattle(); openMenu(); }

function finishUnit(u){
  v2Pickup(u);
  u.acted=true; B.sel=null; B.orig=null; B.mode='idle'; B.mr=null; B.targets=null;
  hideMenu(); renderBattle();
  if(!B.over && players().every(p=>p.acted)) setTimeout(endPlayerPhase,400);
}

/* ── 액션 메뉴 ── */
function openMenu(){
  const u=B.sel; hideMenu();
  const enemiesNear=foes().filter(e=>u.range.includes(dist(u,e)));
  let html='';
  if(enemiesNear.length) html+=`<button class="btn" onclick="menuAct('attack')">공격</button>`;
  u.skills.forEach((sid,i)=>{
    const sk=SKILLS[sid];
    const cost=masteryCost(sid), ml=masteryLabel(sid);
    const mlTxt=ml?` <span style="color:#e8c96a;font-size:11px">${ml}</span>`:'';
    if(u.ki<cost) return;
    if(sk.heal){
      const hurt=players().filter(p=>p!==u&&u.range.includes(dist(u,p))&&p.hp<p.maxhp);
      if(hurt.length) html+=`<button class="btn" onclick="menuAct('heal',${i})">${sk.name} <span style="color:#6ab0ce;font-size:12px">기${cost}</span>${mlTxt}</button>`;
    }else if(enemiesNear.length){
      html+=`<button class="btn" onclick="menuAct('skill',${i})">${sk.name} <span style="color:#6ab0ce;font-size:12px">기${cost}</span>${mlTxt}</button>`;
    }
  });
  if(V2&&v2Usables().length){
    html+=`<button class="btn" onclick="menuAct('tool')">도구 <span style="color:#d9b36c;font-size:12px">${v2Usables().length}</span></button>`;
  }
  if(V2){
    html+=`<button class="btn" onclick="menuAct('equip')">장비</button>`;
  }
  html+=`<button class="btn" onclick="menuAct('wait')">대기</button>`;
  html+=`<button class="btn" onclick="menuAct('cancel')">취소</button>`;
  const m=document.createElement('div');
  m.id='amenu'; m.innerHTML=html;
  const sizer=document.getElementById('mapsizer')||document.getElementById('mapwrap');
  const sc=mapScale();
  const menuW=165, menuH=60+u.skills.length*38+80;
  let mx=((u.x+1)*TS+6)*sc, my=(u.y*TS-10)*sc;
  if(mx>B.w*TS*sc-menuW) mx=Math.max(2,u.x*TS*sc-menuW);
  my=Math.max(4,Math.min(my,Math.max(4,B.h*TS*sc-menuH)));
  m.style.left=mx+'px'; m.style.top=my+'px';
  sizer.appendChild(m);
}
function hideMenu(){ const m=document.getElementById('amenu'); if(m) m.remove(); }
function menuAct(act,idx){
  SFX.play('ui');
  const u=B.sel;
  if(act==='cancel'){ clearSel(); return; }
  if(act==='wait'){ hideMenu(); finishUnit(u); return; }
  hideMenu();
  if(act==='tool'){ openToolMenu(u); return; }
  if(act==='equip'){ openEquipModal(u); return; }
  if(act==='attack'){ B.mode='target-attack'; B.skillIdx=null; B.targets=foes().filter(e=>u.range.includes(dist(u,e))); }
  if(act==='skill'){ B.mode='target-skill'; B.skillIdx=idx; B.targets=foes().filter(e=>u.range.includes(dist(u,e))); }
  if(act==='heal'){ B.mode='target-heal'; B.skillIdx=idx; B.targets=players().filter(p=>p!==u&&u.range.includes(dist(u,p))&&p.hp<p.maxhp); }
  renderBattle();
}

/* ── 전투 예측 ── */
function openForecast(a,d,skillId){
  const my=calcStrike(a,d,skillId);
  const counter=canCounter(d,a)?calcStrike(d,a,null):null;
  const sk=skillId?SKILLS[skillId]:null;
  const triTxt = my.tri>0?'<span style="color:#8fce6a">유리 ▲</span>':(my.tri<0?'<span style="color:#e07a5a">불리 ▼</span>':'—');
  /* 예상 획득 경험치 (아군 시전 · 난이도 배율 반영) */
  let expTxt='';
  if(a.team==='P'&&d.team==='E'){
    const em=curDiff().exp;
    const hitExp=Math.round((8+(sk?2:0))*em);
    const killExp=Math.round((8+(sk?2:0) + 30 + Math.max(0,(d.lvl-a.lvl))*4 + (d.boss?40:0))*em);
    expTxt=`<span class="fc-exp">경험치 명중 +${hitExp} · 격파 +${killExp}</span>`;
  }
  const html=`
  <div class="modal-back" id="fc-modal">
    <div class="modal">
      <h3>전투 예측 ${sk?`— ${sk.name}`:''} ${expTxt}</h3>
      <div class="fc-grid">
        <div class="hd">${a.name}${my.supA?` <span style="font-size:11px;color:#8fce6a">협공+${my.supA}</span>`:''}${my.bA?` <span style="font-size:11px;color:#e8a0c0">인연 ${RANK_NAME[my.bA]}</span>`:''}</div><div class="lbl">상성 ${triTxt}</div><div class="hd">${d.name}${my.supD?` <span style="font-size:11px;color:#8fce6a">협공+${my.supD}</span>`:''}${my.bD?` <span style="font-size:11px;color:#e8a0c0">인연 ${RANK_NAME[my.bD]}</span>`:''}</div>
        <div class="val">${a.hp} / ${a.maxhp}</div><div class="lbl">HP</div><div class="val">${d.hp} / ${d.maxhp}</div>
        <div class="val">${my.dmg}${my.dbl?' ×2':''}</div><div class="lbl">위력</div><div class="val">${counter?`${counter.dmg}${counter.dbl?' ×2':''}`:'반격 불가'}</div>
        <div class="val">${my.hit}%</div><div class="lbl">명중</div><div class="val">${counter?counter.hit+'%':'—'}</div>
        <div class="val">${my.crit}%</div><div class="lbl">필살</div><div class="val">${counter?counter.crit+'%':'—'}</div>
      </div>
      <div class="btnrow">
        <button class="btn" onclick="confirmAttack()">공격 개시</button>
        <button class="btn" onclick="cancelForecast()">취소</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  B.pending={a,d,skillId};
}
function cancelForecast(){
  const m=document.getElementById('fc-modal'); if(m) m.remove();
  B.pending=null; backToMenu();
}
function confirmAttack(){
  SFX.play('ui');
  const m=document.getElementById('fc-modal'); if(m) m.remove();
  const p=B.pending; B.pending=null;
  hideMenu(); B.mode='idle'; B.targets=null;
  combat(p.a,p.d,p.skillId).then(()=>{ if(!B.over) finishUnit(p.a); });
}

/* ── 턴 진행 ── */
async function startPlayerPhase(first){
  if(B.over) return;
  if(!first) B.turn++;
  const ch=curCh();
  /* 방어전: 규정 턴을 버티면 승리 */
  if(ch.win.type==='survive' && B.turn>ch.win.turns){
    B.over=true; B.busy=true;
    renderBattle();
    await banner('방어 성공!');
    if(!B) return;
    setTimeout(()=>showVictory(),500);
    return;
  }
  B.phase='P';
  for(const u of B.units.filter(u=>u.alive)) u.acted=false;
  for(const p of players()){
    p.ki=Math.min(p.maxki,p.ki+4);
    const t=TILE[tileChar(p.x,p.y)];
    if(t.heal&&p.hp<p.maxhp){
      const amt=Math.ceil(p.maxhp*t.heal);
      p.hp=Math.min(p.maxhp,p.hp+amt);
      fx(p.x,p.y,'+'+amt,'heal');
    }
  }
  poisonTick('P');
  renderBattle();
  await banner(`아군 페이즈 — ${B.turn}턴`);
  if(!B) return; /* 배너 대기 중 타이틀 이탈 가드 */
  B.busy=false;
}
function endPlayerPhase(){
  if(!B||B.over||B.phase!=='P'||B.busy) return;
  clearSelHard();
  enemyPhase();
}
function clearSelHard(){ B.sel=null; B.orig=null; B.mode='idle'; B.mr=null; B.targets=null; B.inspect=null; hideMenu(); }

async function enemyPhase(){
  B.phase='E'; B.busy=true;
  renderBattle();
  await banner('적군 페이즈',true);
  if(!B) return; /* 배너 대기 중 타이틀 이탈 가드 */
  /* 증원군 등장 */
  const ch=curCh();
  if(ch.reinforce){
    for(let i=0;i<ch.reinforce.length;i++){
      const r=ch.reinforce[i];
      if(B.reinfDone.includes(i)||B.turn<r.turn) continue;
      B.reinfDone.push(i);
      let n=0;
      for(const d of r.units){ if(inb(d.x,d.y)&&!unitAt(d.x,d.y)){ B.units.push(mkEnemyUnit(d)); n++; } }
      if(n){
        renderBattle(true);
        log(`<b>${r.msg||'적 증원 출현!'}</b> (${n}명)`,true);
        await banner(r.msg||'적 증원 출현!',true);
        if(!B) return;
      }
    }
  }
  poisonTick('E');
  for(const e of foes()) e.ki=Math.min(e.maxki,e.ki+4);
  const list=B.units.filter(u=>u.team==='E');
  for(const u of list){
    if(!B||B.over) return;
    if(!u.alive) continue;
    if(u.wait){
      const near=players().some(p=>dist(p,u)<=u.wait);
      if(!near && u.hp===u.maxhp) continue;
      u.wait=0;
    }
    focusUnit(u); /* 행동할 적에게 화면 이동 */
    if(!(SETTINGS.fastEnemy&&SETTINGS.speed>=2)) await aSleep(160);
    const mr=moveRange(u);
    let best=null;
    for(const k of mr.keys()){
      const [x,y]=k.split(',').map(Number);
      if(!stoppable(u,x,y)) continue;
      for(const p of players()){
        const dd=Math.abs(p.x-x)+Math.abs(p.y-y);
        if(!u.range.includes(dd)) continue;
        const sid=u.skills.find(s=>!SKILLS[s].heal&&u.ki>=SKILLS[s].cost)||null;
        const pv=calcStrike(u,p,sid);
        let score=pv.dmg*(pv.hit/100)+(pv.dmg>=p.hp?60:0)+TILE[tileChar(x,y)].avoid*0.2+(p.leader?6:0);
        if(p.range.includes(dd)){
          const c=calcStrike(p,u,null);
          score-=c.dmg*(c.hit/100)*0.5;
        }
        if(!best||score>best.score) best={x,y,p,score,sid};
      }
    }
    if(best){
      if(best.x!==u.x||best.y!==u.y){ const ox=u.x,oy=u.y; u.x=best.x; u.y=best.y; await animMove(u,ox,oy); }
      await combat(u,best.p,best.sid);
      if(B.over) return;
    }else{
      let tgt=null;
      for(const p of players()) if(!tgt||dist(p,u)<dist(tgt,u)) tgt=p;
      if(tgt){
        let bt=null;
        for(const k of mr.keys()){
          const [x,y]=k.split(',').map(Number);
          if(!stoppable(u,x,y)) continue;
          const dd=Math.abs(tgt.x-x)+Math.abs(tgt.y-y);
          if(!bt||dd<bt.dd) bt={x,y,dd};
        }
        if(bt&&(bt.x!==u.x||bt.y!==u.y)){ const ox=u.x,oy=u.y; u.x=bt.x; u.y=bt.y; await animMove(u,ox,oy); }
      }
    }
  }
  if(B&&!B.over) startPlayerPhase(false);
}

/* ── 전투 시작 ── */
function startBattle(){
  const ch=curCh();
  const W=ch.map[0].length;
  const map=ch.map.map(r=>{
    let s=r;
    while(s.length<W) s+='.';
    return s.slice(0,W);
  });
  B={
    map, w:W, h:map.length,
    units:[], turn:1, phase:'P', mode:'idle',
    sel:null, orig:null, mr:null, targets:null, inspect:null, tileSel:null,
    busy:true, over:false, log:[], pending:null, reinfDone:[], skillIdx:null,
    diff:(V2&&V2.diff)||(ENDLESS&&ENDLESS.diff)||(G&&G.diff)||'std',
    weather:pickWeather(),
  };
  const cap=Math.min(ch.spawns.length,(ch.deploy&&ch.deploy.cap)||12);
  const lineup=(G.deploy&&G.deploy.length?G.deploy:G.party).filter(cid=>G.roster[cid]).slice(0,cap);
  lineup.forEach((cid,i)=>{
    const [x,y]=ch.spawns[i];
    B.units.push(mkPlayerUnit(cid,x,y));
  });
  B.treasures=deepClone(ch.treasures||[]);
  B.loot={gold:0,items:[]};
  if(V2&&V2.curBattle){ V2.deploy=G.deploy.slice(); v2Save(); }
  for(const def of ch.enemies) B.units.push(mkEnemyUnit(def));
  startBGM('battle');
  renderScreenBattle();
  log(`<b>${ch.title}</b> — 승리 조건: ${ch.win.text}`,true);
  startPlayerPhase(true);
}

/* ============================================================
   렌더링 · 화면 흐름
   ============================================================ */

/* ── 맵 스케일링 (모바일 자동 맞춤) ── */
let MAPZOOM=0;      // 0=자동 맞춤, 1.5/2 = 확대 배율
let CURSCALE=1;     // 현재 적용 스케일
function mapScale(){ return CURSCALE; }
function fitMap(){
  if(!B) return;
  const wrap=document.getElementById('mapwrap'), sizer=document.getElementById('mapsizer');
  if(!wrap||!sizer) return;
  const mw=B.w*TS, mh=B.h*TS;
  const appEl=document.getElementById('app');
  const avail=Math.max(260,(appEl?appEl.clientWidth:window.innerWidth)-4);
  const fit=Math.min(1, avail/mw);
  let sc;
  if(MAPZOOM===0){
    /* 전체 화면 채우기: 가로·세로에 맞춰 확대(최대 1.45배)·축소 */
    const availH=Math.max(300, window.innerHeight-84);
    sc=Math.min(avail/mw, availH/mh, 1.45);
    if(sc<0.6) sc=Math.min(1, 34/TS); /* 세로 화면: 타일이 너무 작아지면 가로 스크롤 방식으로 전환 */
  }else sc=Math.min(2.4, fit*MAPZOOM);
  CURSCALE=sc;
  wrap.style.transform=`scale(${sc})`;
  sizer.style.width=(mw*sc)+'px';
  sizer.style.height=(mh*sc)+'px';
}
const ZOOM_CYCLE=[0,1.25,1.5,2];
function cycleZoom(){
  const i=ZOOM_CYCLE.indexOf(MAPZOOM);
  MAPZOOM = ZOOM_CYCLE[(i+1)%ZOOM_CYCLE.length];
  const z=document.getElementById('tb-zoom');
  if(z) z.textContent = MAPZOOM===0 ? '자동' : ('×'+MAPZOOM);
  fitMap();
}
function uiCancel(){
  if(!B||B.busy) return;
  if(B.mode!=='idle') clearSel();
  else if(B.inspect){ B.inspect=null; B.mr=null; renderBattle(); }
}
/* 유닛을 화면 중앙으로 스크롤 (적 턴 카메라 추적) */
function focusUnit(u){
  const ms=document.getElementById('mapscroll'); if(!ms||!u) return;
  const sc=CURSCALE||1;
  const cx=(u.x+0.5)*TS*sc, cy=(u.y+0.5)*TS*sc;
  const tl=Math.max(0, cx-ms.clientWidth/2), tt=Math.max(0, cy-ms.clientHeight/2);
  if(Math.abs(ms.scrollLeft-tl)<8 && Math.abs(ms.scrollTop-tt)<8) return; // 이미 보임
  try{ ms.scrollTo({left:tl, top:tt, behavior:'smooth'}); }
  catch(e){ ms.scrollLeft=tl; ms.scrollTop=tt; }
}
window.addEventListener('resize',()=>{ if(B) fitMap(); });

/* ── 전장 날씨/시간 연출 ── */
const WEATHER_NAME={clear:'맑음',snow:'설한(雪寒)',rain:'우천(雨天)',fog:'운무(雲霧)',night:'야전(夜戰)'};
const WEATHER_HIT={clear:0,snow:-3,rain:-3,fog:-6,night:0}; /* 양측 공통 명중 보정 */
/* 스테이지 데이터의 weather 우선, 없으면 캠페인·시드로 자동 배정 */
function pickWeather(){
  const ch=curCh();
  if(ch&&ch.weather) return ch.weather;
  const camp=(V2&&V2.camp)||'';
  const seed=strSeed((camp||'x')+'_'+((V2&&V2.stageId)||G.chapterIdx||0));
  if(camp==='hwasan'||camp==='hwalsa'||camp==='dokgo') return (seed%3===0)?'snow':(seed%3===1?'fog':'clear');
  if(camp==='pungreung') return (seed%2===0)?'rain':'night';
  if(camp==='chunryong') return (seed%3===0)?'snow':(seed%3===1?'night':'clear');
  if(camp==='jinfinal') return 'night';
  return (seed%5===0)?'fog':(seed%5===1?'rain':'clear');
}
function renderWeather(){
  const el=document.getElementById('weather'); if(!el||!B) return;
  const w=B.weather||'clear';
  el.className='w-'+w;
  if(w==='clear'){ el.innerHTML=''; return; }
  if(el.dataset.w===w) return; /* 이미 그려짐 */
  el.dataset.w=w;
  let s='';
  if(w==='snow'){
    for(let i=0;i<50;i++){ const x=(i*37)%100, d=6+((i*13)%7), dl=-(i*0.4)%6, sz=2+((i*7)%3); s+=`<span class="flake" style="left:${x}%;width:${sz}px;height:${sz}px;animation-duration:${d}s;animation-delay:${dl}s"></span>`; }
  }else if(w==='rain'){
    for(let i=0;i<60;i++){ const x=(i*29)%100, d=0.5+((i*11)%4)/10, dl=-(i*0.15)%1.5; s+=`<span class="drop" style="left:${x}%;animation-duration:${d}s;animation-delay:${dl}s"></span>`; }
  }else if(w==='fog'){
    s='<span class="fogband f1"></span><span class="fogband f2"></span>';
  }
  el.innerHTML=s;
}
function weatherLine(){ const w=(B&&B.weather)||'clear'; const h=WEATHER_HIT[w]; return `날씨: <b>${WEATHER_NAME[w]}</b>${h?` <span style="color:#e0a84a">명중 ${h}</span>`:''}`; }

/* ── 전투 화면 골격 (전체 화면 + 오버레이 HUD) ── */
let UCARD_HIDE=false, INFO_OPEN=false;
function toggleInfoPop(){ INFO_OPEN=!INFO_OPEN; SFX.play('ui'); if(B) renderSide(); }
function hideUcard(){ UCARD_HIDE=true; if(B) renderSide(); }
function renderScreenBattle(){
  const mw=curCh().map[0].length*TS, mh=curCh().map.length*TS;
  UCARD_HIDE=false; INFO_OPEN=false;
  app().innerHTML=`
  <div id="battle" class="full">
    <div id="topbar">
      <span id="tb-info"></span>
      <span style="flex:1"></span>
      ${V2?`<button class="btn small" onclick="openInvModal()">행낭</button>`:''}
      <button class="btn small snd-btn" onclick="sndToggleUI()">${sndOn()?'♪':'∅'}</button>
      <button class="btn small" onclick="showSettings()">⚙</button>
      <button class="btn small" id="tb-cancel" onclick="uiCancel()">취소</button>
      <button class="btn small" onclick="cycleZoom()">배율 <span id="tb-zoom">${MAPZOOM===0?'자동':'×'+MAPZOOM}</span></button>
      <button class="btn small" id="tb-detail" onclick="toggleInfoPop()">정보</button>
      <button class="btn small" id="tb-end" onclick="endPlayerPhase()">턴 종료</button>
    </div>
    <div id="battlebody">
      <div id="mapscroll"><div id="mapsizer">
        <div id="mapwrap" style="width:${mw}px;height:${mh}px">
          <svg id="mapsvg" width="${mw}" height="${mh}"></svg>
          <div id="weather"></div>
          <div id="fx"></div>
          <div id="banner"></div>
        </div>
      </div></div>
      <div id="minimap" title="미니맵 — 클릭하면 그 위치로 이동"></div>
      <div id="ucard-pop" class="hidden"></div>
      <div id="info-pop" class="hidden"></div>
    </div>
  </div>`;
  const wrap=document.getElementById('mapwrap');
  wrap.addEventListener('click',e=>{
    if(e.target.closest('#amenu')) return;
    const svg=document.getElementById('mapsvg');
    const r=svg.getBoundingClientRect();
    const x=Math.floor((e.clientX-r.left)/r.width*B.w), y=Math.floor((e.clientY-r.top)/r.height*B.h);
    if(inb(x,y)) onTile(x,y);
  });
  wrap.addEventListener('contextmenu',e=>{
    e.preventDefault();
    uiCancel();
  });
  const ms=document.getElementById('mapscroll');
  ms.addEventListener('scroll',()=>renderMinimap());
  const mm=document.getElementById('minimap');
  mm.addEventListener('click',e=>{
    if(!B) return;
    const r=mm.getBoundingClientRect();
    const fx=(e.clientX-r.left)/r.width, fy=(e.clientY-r.top)/r.height;
    ms.scrollLeft=fx*B.w*TS*CURSCALE-ms.clientWidth/2;
    ms.scrollTop=fy*B.h*TS*CURSCALE-ms.clientHeight/2;
  });
  fitMap();
  renderBattle();
}

/* ── 미니맵 ── */
function renderMinimap(){
  const mm=document.getElementById('minimap'); if(!mm||!B) return;
  const t2=Math.max(3,Math.min(7,Math.floor(150/B.w)));
  const w=B.w*t2, h=B.h*t2;
  let s=`<svg width="${w}" height="${h}" style="display:block">`;
  for(let y=0;y<B.h;y++) for(let x=0;x<B.w;x++)
    s+=`<rect x="${x*t2}" y="${y*t2}" width="${t2}" height="${t2}" fill="${TILE[tileChar(x,y)].color}"/>`;
  for(const t of (B.treasures||[])) if(!t.taken)
    s+=`<rect x="${t.x*t2}" y="${t.y*t2}" width="${t2}" height="${t2}" fill="#ffd94a" stroke="#8a6a10" stroke-width=".6"/>`;
  for(const u of B.units) if(u.alive)
    s+=`<circle cx="${u.x*t2+t2/2}" cy="${u.y*t2+t2/2}" r="${t2*0.48}" fill="${u.team==='P'?'#4a9ae0':(u.boss?'#ffd94a':'#e05a44')}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/>`;
  const ms=document.getElementById('mapscroll'), sc=CURSCALE||1;
  if(ms){
    const vx=ms.scrollLeft/sc/TS*t2, vw=Math.min(w,ms.clientWidth/sc/TS*t2);
    const vy=ms.scrollTop/sc/TS*t2, vh=Math.min(h,ms.clientHeight/sc/TS*t2);
    if(vw<w-1||vh<h-1) s+=`<rect x="${vx}" y="${vy}" width="${Math.max(6,vw)}" height="${Math.max(6,vh)}" fill="none" stroke="#f0d49a" stroke-width="1.6"/>`;
  }
  s+='</svg>';
  mm.innerHTML=s;
}

/* ── 전투 렌더 (svg + 사이드) ── */
function renderBattle(light){
  if(!B) return;
  const svg=document.getElementById('mapsvg');
  if(!svg) return;
  let s='';
  for(let y=0;y<B.h;y++) for(let x=0;x<B.w;x++) s+=tileSVG(tileChar(x,y),x,y);

  /* 보물 궤짝 */
  for(const t of (B.treasures||[])){
    if(t.taken) continue;
    const px=t.x*TS, py=t.y*TS;
    s+=`<g><ellipse cx="${px+TS/2}" cy="${py+TS-12}" rx="14" ry="4" fill="rgba(0,0,0,.25)"/>
      <rect x="${px+12}" y="${py+18}" width="${TS-24}" height="${TS-28}" rx="3" fill="#8a5a28" stroke="#3a2a12" stroke-width="1.5"/>
      <rect x="${px+12}" y="${py+25}" width="${TS-24}" height="4" fill="#d9b36c"/>
      <circle cx="${px+TS/2}" cy="${py+27}" r="3.2" fill="#f0d49a" stroke="#3a2a12"/></g>`;
  }

  /* 하이라이트 */
  const hl=[];
  if(B.mode==='move'&&B.mr&&B.sel){
    const atk=attackTiles(B.sel,B.mr);
    for(const k of atk){ if(!B.mr.has(k)) hl.push([k,'rgba(200,70,50,.4)']); }
    for(const k of B.mr.keys()){
      const [x,y]=k.split(',').map(Number);
      if(stoppable(B.sel,x,y)) hl.push([k,'rgba(70,130,200,.45)']);
    }
  }
  if(B.inspect&&B.mr){
    const atk=attackTiles(B.inspect,B.mr);
    for(const k of atk) hl.push([k,'rgba(220,140,40,.28)']);
    for(const k of B.mr.keys()) hl.push([k,'rgba(220,140,40,.42)']);
  }
  if(B.targets){
    const col=B.mode==='target-heal'?'rgba(90,190,90,.5)':'rgba(220,60,40,.5)';
    for(const t of B.targets) hl.push([t.x+','+t.y,col]);
  }
  for(const [k,c] of hl){
    const [x,y]=k.split(',').map(Number);
    s+=`<rect x="${x*TS+2}" y="${y*TS+2}" width="${TS-4}" height="${TS-4}" rx="6" fill="${c}" stroke="rgba(255,255,255,.25)"/>`;
  }
  if(B.tileSel&&!B.busy){
    s+=`<rect x="${B.tileSel.x*TS+1.5}" y="${B.tileSel.y*TS+1.5}" width="${TS-3}" height="${TS-3}" rx="4" fill="none" stroke="#f0d49a" stroke-width="2"/>`;
  }
  /* 유닛 (선택 유닛은 맨 위에) */
  for(const u of B.units.filter(u=>u.alive&&u!==B.sel)) s+=unitSVG(u);
  if(B.sel&&B.sel.alive) s+=unitSVG(B.sel,true);
  svg.innerHTML=s;
  renderWeather();
  renderSide();
}

function statRow(lbl,val,eq){
  /* eq(장비 보정)가 있으면 기본치 + 보정 형식으로 표시 */
  if(eq){ const base=val-eq; return `<div>${lbl} <b>${base}</b><span style="color:#8fce6a"> +${eq}</span></div>`; }
  return `<div>${lbl} <b>${val}</b></div>`;
}
/* 숙련도 진행도 텍스트: 12/20 형태 (극이면 極) */
function masteryProgress(sid){
  const t=masteryTier(sid), uses=SKILL_USE[sid]||0;
  if(t>=MASTERY_STEPS.length-1) return `숙련 極 ${uses}회`;
  return `숙련 ${uses}/${MASTERY_STEPS[t+1]}`;
}
function terrLine(){
  if(!B.tileSel) return '';
  const T=TILE[tileChar(B.tileSel.x,B.tileSel.y)];
  return `지형: <b>${T.name}</b> — 회피 +${T.avoid} · 방어 +${T.def}${T.heal?' · 매턴 HP 회복':''}`;
}
function ucardHTML(u){
  const hpPct=Math.round(u.hp/u.maxhp*100), kiPct=Math.round(u.ki/u.maxki*100);
  return `
  <button class="pop-x" onclick="hideUcard()">×</button>
  <div class="uc-head">
    <div class="uc-pt ${u.team==='E'?'enemy':''}">${ptSVG(u.cid)}</div>
    <div style="flex:1">
      <div class="uc-name">${u.name}${u.boss?' ★':''}<span class="typebadge type-${u.type}">${TYPE_NAME[u.type]}</span></div>
      <div class="uc-sub">${u.cls} · Lv.${u.lvl}${u.team==='P'?` · EXP ${u.exp}`:''}${u.poison?` · <span style="color:#c07ae0">☠ 중독 ${u.poison}턴</span>`:''}</div>
      <div class="bar hp ${hpPct<=35?'low':''}"><i style="width:${hpPct}%"></i></div>
      <div class="uc-sub" style="display:flex;justify-content:space-between"><span>HP ${u.hp}/${u.maxhp}</span><span>기 ${u.ki}/${u.maxki}</span></div>
      <div class="bar ki"><i style="width:${kiPct}%"></i></div>
    </div>
  </div>
  <div class="uc-stats">
    ${statRow('힘',u.stats.str)}${statRow('내공',u.stats.int)}${statRow('기술',u.stats.skl)}
    ${statRow('방어',u.stats.def,u.eqBonus&&u.eqBonus.def)}${statRow('정신',u.stats.res,u.eqBonus&&u.eqBonus.res)}${statRow('속도',u.stats.spd)}
    ${statRow('이동',u.stats.mov,u.eqBonus&&u.eqBonus.mov)}${statRow('사거리',u.range.join('·'))}<div></div>
  </div>
  ${(u.eqAtk||u.eqHit||u.eqCrit)?`<div class="uc-sub" style="color:#8fce6a;margin-top:2px">병기 보정: ${[u.eqAtk?`공격 +${u.eqAtk}`:'',u.eqHit?`명중 +${u.eqHit}`:'',u.eqCrit?`필살 +${u.eqCrit}`:''].filter(Boolean).join(' · ')}</div>`:''}
  ${u.skills.map(sid=>{const sk=SKILLS[sid];const ml=u.team==='P'?masteryLabel(sid):'';const cost=u.team==='P'?masteryCost(sid):sk.cost;const mp=u.team==='P'?masteryProgress(sid):'';return `<div class="uc-skill">◆ ${sk.name}${ml?` <span style="color:#e8c96a">${ml}</span>`:''} — ${sk.desc} (기 ${cost})${mp?` <span style="color:#c9a86a">(${mp})</span>`:''}</div>`;}).join('')}
  <div class="uc-sub" style="margin-top:6px">${terrLine()}</div>`;
}
function infoHTML(ch){
  const surviveTxt = ch.win.type==='survive' ? `<div class="row"><span>남은 방어</span><b>${Math.max(0,ch.win.turns-B.turn+1)}턴</b></div>` : '';
  return `
  <button class="pop-x" onclick="toggleInfoPop()">×</button>
  <div class="ch-t">${ch.title}</div>
  <div class="row"><span>턴</span><b>${B.turn}</b></div>
  <div class="row"><span>페이즈</span><b>${B.phase==='P'?'아군':'적군'}</b></div>
  <div class="row"><span>승리</span><b>${ch.win.text}</b></div>
  ${surviveTxt}
  <div class="row"><span>패배</span><b>${ch.lose}</b></div>
  <div class="row"><span>병력</span><b>아군 ${players().length} · 적 ${foes().length}</b></div>
  <div class="row"><span>${terrLine()||'타일 클릭 → 지형 정보'}</span></div>
  <div class="row"><span>${weatherLine()}</span></div>
  <div class="btnrow" style="margin:8px 0 6px">
    <button class="btn small" onclick="showHelp()">도움말</button>
    <button class="btn small danger" onclick="confirmToTitle()">타이틀로</button>
  </div>
  <div id="log">${B.log.map(l=>`<div class="${l.imp?'imp':''}">${l.msg}</div>`).join('')}</div>`;
}
function renderSide(){
  if(!B) return;
  const ch=curCh();
  /* 상단 바 */
  const surviveTop = ch.win.type==='survive' ? ` · 방어 ${Math.max(0,ch.win.turns-B.turn+1)}턴` : '';
  const tbi=document.getElementById('tb-info');
  if(tbi) tbi.innerHTML=`${B.turn}턴 · ${B.phase==='P'?'아군':'<span style="color:#e09080">적군</span>'}${surviveTop} · 적 ${foes().length}`;
  const te=document.getElementById('tb-end'); if(te) te.disabled=(B.phase!=='P'||B.busy);
  const tc=document.getElementById('tb-cancel'); if(tc) tc.disabled=(B.mode==='idle'&&!B.inspect);
  /* 팝업 배치: 선택/조작 중인 유닛의 반대쪽에 두어 명령 메뉴와 겹치지 않게 함 */
  const focusU=B.sel||B.inspect;
  const oppSide = focusU ? (focusU.x > (B.w-1)/2 ? 'left' : 'right') : 'right';
  /* 유닛 팝업 카드 (필요시만 표시) */
  const pop=document.getElementById('ucard-pop');
  if(pop){
    const u=B.sel||B.inspect||(B.tileSel?unitAt(B.tileSel.x,B.tileSel.y):null);
    if(u&&!UCARD_HIDE){ pop.className='panel pop '+oppSide; pop.innerHTML=ucardHTML(u); }
    else pop.className='hidden';
  }
  /* 정보 팝업 (버튼 토글) — 유닛 카드와 반대쪽·하단에 배치 */
  const ip=document.getElementById('info-pop');
  if(ip){
    if(INFO_OPEN){ ip.className='panel pop bottom '+(oppSide==='right'?'left':'right'); ip.innerHTML=infoHTML(ch); }
    else ip.className='hidden';
  }
  renderMinimap();
}

/* ── 대화 화면 (무드 4종: 새벽/낮/황혼/밤 — 스테이지 시드로 결정) ── */
function strSeed(str){ let h=0; for(let i=0;i<str.length;i++){ h=(h*31+str.charCodeAt(i))|0; } return Math.abs(h); }
function dlgSeed(){
  if(V2) return strSeed(V2.camp+'_'+V2.stageId);
  if(ENDLESS) return strSeed('endless'+(ENDLESS.wave||0));
  return strSeed('classic'+G.chapterIdx);
}
const DLG_MOODS=[
  { /* 새벽 */ sky:['#3a3a55','#6a5a68','#c89a78'], sun:{c:'#f0d8b0',op:.55,r:40,y:150}, m1:'#4a4460', m2:'#332e48', fg:'#1e1a2c', mist:'#c8a888', stars:0 },
  { /* 낮 */   sky:['#5878a8','#7a98b8','#b8c8b8'], sun:{c:'#f8f0d0',op:.9,r:44,y:95},  m1:'#5a6a58', m2:'#42503f', fg:'#2a3424', mist:'#d8e0d8', stars:0 },
  { /* 황혼 */ sky:['#2a2440','#4a3a50','#8a6248'], sun:{c:'#f0e0b8',op:.75,r:55,y:110}, m1:'#332a44', m2:'#241e30', fg:'#171220', mist:'#a88868', stars:0 },
  { /* 밤 */   sky:['#141828','#1e2438','#2a3448'], sun:{c:'#e8e8d8',op:.85,r:36,y:100}, m1:'#1c2234', m2:'#141a28', fg:'#0c101c', mist:'#485878', stars:26 },
];
function dlgBgSVG(){
  const seed=dlgSeed();
  const M=DLG_MOODS[seed%4];
  let stars='';
  for(let i=0;i<M.stars;i++){
    const sx=(seed*7+i*137)%1000, sy=((seed*13+i*211)%230)+10, sr=((i*29)%10)/10*0.9+0.5;
    stars+=`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="#e8ecf8" opacity="${0.4+((i*17)%6)/10}"/>`;
  }
  return `<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
  <defs><linearGradient id="dsky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${M.sky[0]}"/><stop offset=".6" stop-color="${M.sky[1]}"/><stop offset="1" stop-color="${M.sky[2]}"/>
  </linearGradient>
  <radialGradient id="dglow" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="${M.sun.c}" stop-opacity=".5"/><stop offset="1" stop-color="${M.sun.c}" stop-opacity="0"/>
  </radialGradient></defs>
  <rect width="1000" height="600" fill="url(#dsky)"/>
  ${stars}
  <circle cx="780" cy="${M.sun.y}" r="${M.sun.r*2.4}" fill="url(#dglow)"/>
  <circle cx="780" cy="${M.sun.y}" r="${M.sun.r}" fill="${M.sun.c}" opacity="${M.sun.op}"/>
  ${M.stars?`<circle cx="765" cy="${M.sun.y-8}" r="${M.sun.r*0.82}" fill="${M.sky[0]}" opacity=".55"/>`:''}
  <path d="M0,430 L160,300 L300,410 L430,280 L580,440 L1000,420 L1000,600 L0,600 Z" fill="${M.m1}" opacity=".9"/>
  <rect x="0" y="405" width="1000" height="42" fill="${M.mist}" opacity=".14"/>
  <path d="M300,470 L520,340 L700,460 L850,380 L1000,470 L1000,600 L300,600 Z" fill="${M.m2}"/>
  <path d="M0,500 Q500,470 1000,505 L1000,600 L0,600 Z" fill="${M.fg}"/>
  <g stroke="${M.fg}" stroke-width="3" opacity=".8">
    <path d="M120,470 q0,-45 6,-60 M126,410 q-14,10 -24,8 M126,410 q12,8 22,6" fill="none"/>
    <ellipse cx="126" cy="398" rx="16" ry="10" fill="#243020" stroke="none"/>
  </g>
  </svg>`;
}
/* ── 이벤트 컷신 (프리셋 배경 + 카메라 팬 + 캡션) ── */
function cutBgSVG(bg){
  const B0='0 0 1000 560';
  if(bg==='siege'){ return `<svg viewBox="${B0}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
    <defs><linearGradient id="cs1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2438"/><stop offset=".6" stop-color="#6a3a30"/><stop offset="1" stop-color="#2a1a18"/></linearGradient></defs>
    <rect width="1000" height="560" fill="url(#cs1)"/>
    <circle cx="180" cy="120" r="60" fill="#f0c060" opacity=".5"/>
    <rect x="0" y="360" width="1000" height="200" fill="#241418"/>
    <g fill="#1a1012"><rect x="60" y="300" width="120" height="120"/><rect x="240" y="280" width="120" height="140"/><rect x="440" y="300" width="140" height="120"/><rect x="640" y="270" width="120" height="150"/><rect x="820" y="300" width="120" height="120"/></g>
    <g fill="#0e0808"><rect x="90" y="270" width="30" height="30"/><rect x="290" y="250" width="30" height="30"/><rect x="680" y="240" width="30" height="30"/></g>
    <g stroke="#e08040" stroke-width="3" opacity=".8"><path d="M120,300 q10,-40 -6,-70" fill="none"/><path d="M300,280 q14,-50 -4,-84" fill="none"/><path d="M700,270 q10,-46 -8,-78" fill="none"/></g>
    <g fill="#c05030" opacity=".7"><circle cx="120" cy="220" r="7"/><circle cx="300" cy="192" r="8"/><circle cx="700" cy="188" r="7"/></g>
  </svg>`; }
  if(bg==='duel'){ return `<svg viewBox="${B0}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
    <defs><radialGradient id="cs2" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#4a4260"/><stop offset="1" stop-color="#161020"/></radialGradient></defs>
    <rect width="1000" height="560" fill="url(#cs2)"/>
    <circle cx="500" cy="200" r="120" fill="#f0e0b8" opacity=".14"/>
    <path d="M0,430 Q500,400 1000,430 L1000,560 L0,560 Z" fill="#100c18"/>
    <g fill="#0a0710"><path d="M360,430 q-20,-90 6,-150 q10,-20 18,2 q16,60 -4,148 Z"/><path d="M356,300 l-40,26 M382,300 l44,24"/><path d="M360,410 l-30,40 M378,410 l28,44"/></g>
    <g fill="#0a0710"><path d="M640,430 q22,-90 -4,-152 q-10,-20 -20,2 q-16,62 4,150 Z"/></g>
    <path d="M384,320 L470,250" stroke="#e8e0c0" stroke-width="4" stroke-linecap="round"/>
    <path d="M616,320 L530,250" stroke="#e8e0c0" stroke-width="4" stroke-linecap="round"/>
    <circle cx="500" cy="250" r="10" fill="#fff" opacity=".8"/>
  </svg>`; }
  if(bg==='throne'){ return `<svg viewBox="${B0}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
    <defs><linearGradient id="cs3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1c30"/><stop offset="1" stop-color="#160e18"/></linearGradient></defs>
    <rect width="1000" height="560" fill="url(#cs3)"/>
    <g fill="#3a2a3e"><rect x="120" y="120" width="40" height="400"/><rect x="300" y="120" width="40" height="400"/><rect x="660" y="120" width="40" height="400"/><rect x="840" y="120" width="40" height="400"/></g>
    <g fill="#241a28"><rect x="112" y="110" width="56" height="20"/><rect x="292" y="110" width="56" height="20"/><rect x="652" y="110" width="56" height="20"/><rect x="832" y="110" width="56" height="20"/></g>
    <path d="M430,520 L430,300 Q500,250 570,300 L570,520 Z" fill="#5a3a2e"/>
    <path d="M448,300 Q500,262 552,300 L552,340 Q500,312 448,340 Z" fill="#7a5038"/>
    <circle cx="500" cy="230" r="26" fill="#f0d060" opacity=".85"/>
    <g stroke="#c8a040" stroke-width="2" opacity=".6"><path d="M500,150 L500,110 M470,200 L440,170 M530,200 L560,170"/></g>
  </svg>`; }
  if(bg==='snow'){ return `<svg viewBox="${B0}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
    <defs><linearGradient id="cs4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4560"/><stop offset=".6" stop-color="#8a97a8"/><stop offset="1" stop-color="#c8d0da"/></linearGradient></defs>
    <rect width="1000" height="560" fill="url(#cs4)"/>
    <path d="M0,380 L200,220 L340,340 L480,200 L640,360 L820,240 L1000,360 L1000,560 L0,560 Z" fill="#6a7688"/>
    <path d="M200,220 L260,300 L150,320 Z M480,200 L540,270 L430,300 Z M820,240 L880,310 L770,330 Z" fill="#eef2f6"/>
    <path d="M0,440 Q500,410 1000,445 L1000,560 L0,560 Z" fill="#dde4ec"/>
    <g fill="#5a6678"><path d="M300,440 q0,-30 4,-40 M304,400 q-10,6 -18,4 M304,400 q10,6 18,4"/></g>
  </svg>`; }
  /* peak (기본) */
  return `<svg viewBox="${B0}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
    <defs><linearGradient id="cs5" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2438"/><stop offset=".55" stop-color="#3a3450"/><stop offset="1" stop-color="#8a5a48"/></linearGradient></defs>
    <rect width="1000" height="560" fill="url(#cs5)"/>
    <circle cx="760" cy="120" r="54" fill="#f0e0b8" opacity=".9"/>
    <path d="M0,420 L160,220 L300,380 L460,180 L640,420 L1000,380 L1000,560 L0,560 Z" fill="#2a2438"/>
    <path d="M380,440 L560,240 L760,420 L1000,320 L1000,560 L380,560 Z" fill="#1a1626"/>
    <path d="M0,470 Q500,440 1000,475 L1000,560 L0,560 Z" fill="#120e1c"/>
  </svg>`;
}
let CUT=null;
function showCutscene(cut, done){
  startBGM('calm');
  CUT={lines:cut.lines||[], idx:0, done};
  app().innerHTML=`<div id="cut-screen">
    <div id="cut-bg" class="ken">${cutBgSVG(cut.bg)}</div>
    <div id="cut-vignette"></div>
    <div id="cut-cap"><div id="cut-text"></div><div id="cut-hint">클릭하여 진행 ▼</div></div>
  </div>`;
  const scr=document.getElementById('cut-screen');
  scr.addEventListener('click',advanceCut);
  showCutLine();
}
function showCutLine(){
  const t=document.getElementById('cut-text'); if(!t) return;
  t.classList.remove('cin'); void t.offsetWidth; t.classList.add('cin');
  t.textContent=CUT.lines[CUT.idx]||'';
}
function advanceCut(){
  SFX.play('ui');
  CUT.idx++;
  if(CUT.idx>=CUT.lines.length){ const d=CUT.done; CUT=null; d(); return; }
  showCutLine();
}

let DLG=null;
function showDialogue(lines, done, titleCard){
  startBGM('calm');
  DLG={lines, idx:-1, done, titleCard, lastL:null, lastR:null};
  app().innerHTML=`<div id="dlg-screen">
    <div id="dlg-bg">${dlgBgSVG()}</div>
    <div id="dlg-ptL"></div><div id="dlg-ptR"></div>
    <div id="dlg-box"><div id="dlg-name"></div><div id="dlg-text"></div></div>
    <div id="dlg-hint">클릭하여 진행 ▼</div>
    ${titleCard?`<div class="dlg-title-card" id="dlg-tc"><h2>${titleCard}</h2><p>클릭하여 시작</p></div>`:''}
  </div>`;
  const scr=document.getElementById('dlg-screen');
  scr.addEventListener('click',advanceDlg);
  if(!titleCard) advanceDlg();
}
function advanceDlg(){
  SFX.play('ui');
  const tc=document.getElementById('dlg-tc');
  if(tc){ tc.remove(); if(DLG.idx===-1){ DLG.idx=0; showDlgLine(); } return; }
  DLG.idx++;
  if(DLG.idx>=DLG.lines.length){ const d=DLG.done; DLG=null; d(); return; }
  showDlgLine();
}
function showDlgLine(){
  const L=DLG.lines[DLG.idx];
  const nameEl=document.getElementById('dlg-name'), textEl=document.getElementById('dlg-text');
  if(textEl){ textEl.classList.remove('linefade'); void textEl.offsetWidth; textEl.classList.add('linefade'); }
  const pL=document.getElementById('dlg-ptL'), pR=document.getElementById('dlg-ptR');
  if(L.s===null){
    nameEl.textContent='— 나레이션 —'; nameEl.className='';
    textEl.innerHTML=`<i style="color:#cfc2a8">${L.t}</i>`;
  }else{
    const c=CHARS[L.s];
    const isEnemy=ENEMY_IDS.has(L.s);
    nameEl.textContent=c.name+' 「'+c.cls+'」'; nameEl.className=isEnemy?'enemy':'';
    textEl.textContent=L.t;
    if(L.side==='L'){ DLG.lastL=L.s; } else { DLG.lastR=L.s; }
  }
  pL.innerHTML=DLG.lastL?`<div class="dlg-pt L ${L.s!==DLG.lastL||L.s===null?'dimmed':''}">${ptSVG(DLG.lastL)}</div>`:'';
  pR.innerHTML=DLG.lastR?`<div class="dlg-pt R ${L.s!==DLG.lastR||L.s===null?'dimmed':''}">${ptSVG(DLG.lastR)}</div>`:'';
}

/* ── 챕터 진행 ── */
function startChapter(idx, skipPre){
  ENDLESS=null; V2=null;
  G.chapterIdx=idx;
  const ch=CHAPTERS[idx];
  for(const cid of ch.joins) initRosterChar(cid);
  G.snapshot=deepClone({roster:G.roster, party:G.party, extra:G.extraSkills});
  const go=()=>{ if(idx===0) startBattle(); else showDeploy(); };
  if(skipPre) go();
  else showDialogue(ch.pre, go, ch.title);
}

/* ── 출전 준비 화면 ── */
function deployPool(ch){
  return (ch.deploy&&ch.deploy.only)?G.party.filter(c=>ch.deploy.only.includes(c)):G.party;
}
function showDeploy(){
  const ch=curCh();
  const cap=Math.min(ch.spawns.length,(ch.deploy&&ch.deploy.cap)||12);
  const pool=deployPool(ch);
  if(!G.deploy) G.deploy=[];
  G.deploy=G.deploy.filter(cid=>pool.includes(cid));
  for(const cid of pool){ if(G.deploy.length<cap&&!G.deploy.includes(cid)) G.deploy.push(cid); }
  const forced=[...((ch.deploy&&ch.deploy.forced)||[])];
  const leader=partyLeader();
  if(leader&&pool.includes(leader)&&!forced.includes(leader)) forced.unshift(leader);
  for(const cid of forced.reverse()){
    if(!pool.includes(cid)) continue;
    const i=G.deploy.indexOf(cid); if(i>=0) G.deploy.splice(i,1);
    G.deploy.unshift(cid);
  }
  G.deploy=G.deploy.slice(0,cap);
  renderDeploy(cap);
}
function renderDeploy(cap){
  const ch=curCh();
  app().innerHTML=`<div id="deploy">
    <h2>${ch.title} — 출전 준비</h2>
    <div class="dep-sub">출전할 협객을 선택하세요 (<b id="dep-n">${G.deploy.length}</b>/${cap}명)${(()=>{
      const forcedIds=[...new Set([partyLeader(),...((ch.deploy&&ch.deploy.forced)||[])])].filter(c=>c&&G.party.includes(c));
      return forcedIds.length?` · ★필수 출전: ${forcedIds.map(c=>CHARS[c].name).join('·')}`:'';
    })()} · 승리 조건: ${ch.win.text}</div>
    <div class="dep-grid">${deployPool(ch).map(cid=>{
      const r=G.roster[cid], c=CHARS[cid], on=G.deploy.includes(cid), lock=!!c.leader||!!(ch.deploy&&ch.deploy.forced&&ch.deploy.forced.includes(cid));
      return `<div class="dep-card ${on?'on':'off'} ${lock?'lock':''}" onclick="toggleDeploy('${cid}',${cap})">
        <div class="pt">${ptSVG(cid)}</div>
        <div class="dep-name">${c.name}${lock?' ★':''}</div>
        <div class="dep-info">Lv.${r.lvl} · ${TYPE_NAME[c.type]}</div>
      </div>`;}).join('')}</div>
    <div style="text-align:center">
      <button class="btn" onclick="startBattle()">출 전 !</button>
      ${V2?`<button class="btn small" style="margin-left:8px" onclick="campFromDeploy()">거점 (장비·승급·상점)</button>`:''}
      <button class="btn small" style="margin-left:8px" onclick="showHelp()">도움말</button>
    </div>
  </div>`;
}
function toggleDeploy(cid,cap){
  if(cid===partyLeader()) return;
  const chD=curCh();
  if(chD.deploy&&chD.deploy.forced&&chD.deploy.forced.includes(cid)) return;
  const i=G.deploy.indexOf(cid);
  if(i>=0) G.deploy.splice(i,1);
  else{ if(G.deploy.length>=cap) return; G.deploy.push(cid); }
  renderDeploy(cap);
}
function applyRoster(){
  for(const u of B.units.filter(u=>u.team==='P')){
    const r=G.roster[u.cid];
    r.lvl=u.lvl; r.exp=u.exp; r.stats=deepClone(u.stats);
  }
}
/* 낙관(도장) 장식 */
function sealSVG(ch,color){
  return `<svg class="seal" viewBox="0 0 64 64" width="60" height="60" aria-hidden="true">
    <rect x="5" y="5" width="54" height="54" rx="7" fill="none" stroke="${color}" stroke-width="3.2" transform="rotate(-5 32 32)"/>
    <text x="32" y="45" text-anchor="middle" font-size="34" font-weight="900" fill="${color}" transform="rotate(-5 32 32)">${ch}</text>
  </svg>`;
}
function showVictory(){
  const ch=curCh();
  applyRoster();
  SFX.play('victory'); startBGM('calm');
  recordBattleWin();
  /* v2 캠페인: 스테이지 클리어 */
  if(V2&&V2.curBattle){
    const n=curNode();
    if(n.judge&&B){ /* 특정 유닛 생존 여부 → 플래그 */
      const ju=B.units.find(u=>u.team==='P'&&u.cid===n.judge.unit);
      if(ju&&ju.alive) V2.flags[n.judge.set]=1;
    }
    const loot=(B&&B.loot)||{gold:0,items:[]};
    const gm=curDiff().gold;
    V2.gold += Math.round(((n.goldReward||0) + (loot.gold||0))*gm);
    for(const id of (loot.items||[])) V2.inv[id]=(V2.inv[id]||0)+1;
    for(const id of (n.rewardItems||[])) V2.inv[id]=(V2.inv[id]||0)+1;
    if(!V2.cleared.includes(V2.stageId)) V2.cleared.push(V2.stageId);
    V2.curBattle=null;
    v2Save();
    const lootTxt=[
      n.goldReward?`보수 ${n.goldReward}냥`:'',
      loot.gold?`보물 ${loot.gold}냥`:'',
      ...(loot.items||[]).map(id=>ITEMS[id].name),
      ...(n.rewardItems||[]).map(id=>`전리품 ${ITEMS[id].name}`)
    ].filter(Boolean).join(' · ');
    app().innerHTML=`<div class="result-screen">
      ${sealSVG('勝','#c0392e')}<h2 style="color:#ffd94a">勝 利</h2>
      <p>${n.title} — 클리어!${lootTxt?`<br>획득: <b style="color:var(--gold2)">${lootTxt}</b>`:''}<br>소지금 ${V2.gold}냥</p>
      <button class="btn" onclick="v2AfterBattle()">계속</button>
    </div>`;
    return;
  }
  /* 무한 모드: 웨이브 클리어 */
  if(ENDLESS){
    const w=ENDLESS.wave;
    setBestWave(w);
    if(w>=10) unlockAchv('endless10');
    if(w>=20) unlockAchv('endless20');
    app().innerHTML=`<div class="result-screen">
      <h2 style="color:#ffd94a">제${w}파 격퇴!</h2>
      <p>영웅들은 호흡을 가다듬는다. 다음 파도는 더욱 거세진다…<br>
      역대 최고 기록: <b style="color:var(--gold2)">${bestWave()}파</b></p>
      <button class="btn" onclick="nextWave(${w+1})">제${w+1}파, 온다!</button>
      <button class="btn danger" onclick="toTitle()">여기서 멈춘다 (기록 저장됨)</button>
    </div>`;
    return;
  }
  /* 무공 습득 */
  let learnMsg='';
  if(ch.learn){
    for(const l of ch.learn){
      G.extraSkills[l.cid]=G.extraSkills[l.cid]||[];
      if(!G.extraSkills[l.cid].includes(l.skill)&&!CHARS[l.cid].skills.includes(l.skill)){
        G.extraSkills[l.cid].push(l.skill);
        learnMsg+=`<br><b style="color:var(--gold2)">${CHARS[l.cid].name}</b>이(가) 신규 무공 <b style="color:var(--gold2)">${SKILLS[l.skill].name}</b>을(를) 익혔다!`;
      }
    }
  }
  const next=G.chapterIdx+1;
  saveGame(next);
  app().innerHTML=`<div class="result-screen">
    ${sealSVG('勝','#c0392e')}<h2 style="color:#ffd94a">勝 利</h2>
    <p>${ch.title} — 클리어!${learnMsg}<br>부상당한 동료들도 무사히 회복했습니다.</p>
    <button class="btn" onclick="afterVictory(${next})">계속</button>
  </div>`;
}
function afterVictory(next){
  const ch=curCh();
  showDialogue(ch.post, ()=>{
    if(next>=CHAPTERS.length) showEnding();
    else startChapter(next);
  });
}
function showDefeat(){
  SFX.play('defeat'); startBGM('calm');
  if(V2&&V2.curBattle){
    V2.curBattle=null;
    app().innerHTML=`<div class="result-screen">
      ${sealSVG('敗','#6a7488')}<h2 style="color:#e07a5a">敗 北</h2>
      <p>${curNode().title} — 패배… 부대를 정비해 다시 도전하자.<br>(도구 소모는 유지되고, 경험치·전리품은 무효가 됩니다)</p>
      <button class="btn" onclick="v2Enter()">재도전</button>
      <button class="btn small" onclick="showRouteMap()">루트 맵</button>
      <button class="btn danger" onclick="toTitle()">타이틀로</button>
    </div>`;
    return;
  }
  if(ENDLESS){
    const w=ENDLESS.wave;
    setBestWave(w-1);
    app().innerHTML=`<div class="result-screen">
      ${sealSVG('敗','#6a7488')}<h2 style="color:#e07a5a">敗 北</h2>
      <p>영웅들은 제${w}파의 파도에 삼켜졌다…<br>
      이번 도달: <b>${w-1}파 격퇴</b> · 역대 최고 기록: <b style="color:var(--gold2)">${bestWave()}파</b></p>
      <button class="btn" onclick="startEndless()">처음부터 재도전</button>
      <button class="btn danger" onclick="toTitle()">타이틀로</button>
    </div>`;
    return;
  }
  app().innerHTML=`<div class="result-screen">
    ${sealSVG('敗','#6a7488')}<h2 style="color:#e07a5a">敗 北</h2>
    <p>곽정이 쓰러졌다… 강호의 이야기는 여기서 끝나지 않는다.</p>
    <button class="btn" onclick="retryChapter()">이 챕터 재도전</button>
    <button class="btn danger" onclick="toTitle()">타이틀로</button>
  </div>`;
}
function retryChapter(){
  const s=deepClone(G.snapshot);
  G.roster=s.roster; G.party=s.party; G.extraSkills=s.extra||{};
  startChapter(G.chapterIdx, true);
}
function showEnding(){
  SFX.play('victory'); startBGM('calm');
  app().innerHTML=`<div class="result-screen">
    ${sealSVG('終','#d9b36c')}<h2>終 幕</h2>
    <p>${ENDING.join('<br>')}</p>
    <button class="btn" onclick="toTitle()">타이틀로</button>
  </div>`;
}

/* ── 저장/불러오기 ── */
const SAVE_KEY='kimyong_srpg_save_v1';
const LASTPLAY_KEY='kimyong_lastplay';
function markPlay(kind,camp){ try{ localStorage.setItem(LASTPLAY_KEY, JSON.stringify({k:kind, c:camp||null, t:Date.now()})); }catch(e){} }
function lastPlay(){ try{ return JSON.parse(localStorage.getItem(LASTPLAY_KEY)||'null'); }catch(e){ return null; } }
function saveGame(nextCh){
  try{
    const prev=loadGame();
    const ch=Math.max(nextCh, prev?(prev.ch||0):0); /* 회상 재도전 시 진행도 후퇴 방지 */
    localStorage.setItem(SAVE_KEY, JSON.stringify({ch, roster:G.roster, party:G.party, extra:G.extraSkills, deploy:G.deploy, diff:G.diff||'std'}));
    markPlay('classic');
  }catch(e){}
}
/* ── 통합 세이브 허브 (클래식 v1 + 캠페인 v2 + 무한 모드) ── */
function saveHubResume(){
  const lp=lastPlay();
  const m=document.getElementById('hub-modal'); if(m) m.remove();
  if(!lp){ continueGame(); return; }
  if(lp.k==='classic') continueGame();
  else if(lp.k==='v2'&&lp.c&&v2LoadSave(lp.c)) startCampaignV2(lp.c,true);
  else if(lp.k==='endless') startEndless();
  else continueGame();
}
function hubContinue(kind,camp){
  const m=document.getElementById('hub-modal'); if(m) m.remove();
  if(kind==='classic') continueGame();
  else if(kind==='v2') startCampaignV2(camp,true);
  else if(kind==='endless') startEndless();
}
function showSaveHub(){
  SFX.play('ui');
  const lp=lastPlay();
  const lpName = lp ? (lp.k==='classic'?'클래식 (전 19장)':(lp.k==='v2'&&CAMPAIGNS[lp.c]?CAMPAIGNS[lp.c].name:'영웅집결 무한 모드')) : null;
  const rows=[];
  const cs=loadGame();
  if(cs){
    const prog = cs.ch>=CHAPTERS.length ? '전 장 클리어' : `${Math.min(cs.ch+1,CHAPTERS.length)}장 진행 중`;
    rows.push(`<tr><td style="text-align:left"><b>클래식</b> — 전 19장 + 크로스오버<div class="hub-sub">${prog}</div></td>
      <td><button class="btn small" onclick="hubContinue('classic')">이어하기</button></td></tr>`);
  }
  for(const id in CAMPAIGNS){
    const sv=v2LoadSave(id);
    if(!sv) continue;
    const done=sv.cleared&&sv.cleared.some(x=>String(x).startsWith('end'));
    rows.push(`<tr><td style="text-align:left"><b>${CAMPAIGNS[id].name}</b><div class="hub-sub">${done?'완주':'진행 '+(sv.cleared?sv.cleared.length:0)+'단계'} · ${sv.gold||0}냥</div></td>
      <td><button class="btn small" onclick="hubContinue('v2','${id}')">이어하기</button></td></tr>`);
  }
  if(bestWave()>0){
    rows.push(`<tr><td style="text-align:left"><b>영웅집결 무한 모드</b><div class="hub-sub">역대 최고 ${bestWave()}파</div></td>
      <td><button class="btn small" onclick="hubContinue('endless')">도전</button></td></tr>`);
  }
  const html=`<div class="modal-back" id="hub-modal" onclick="if(event.target===this)this.remove()">
    <div class="modal"><h3>이어하기 — 통합 기록</h3>
    ${lpName?`<div class="hub-last"><span>최근 플레이: <b>${lpName}</b></span><button class="btn small" onclick="saveHubResume()">바로 이어하기 ▶</button></div>`:''}
    ${rows.length?`<table class="camptable">${rows.join('')}</table>`:'<p style="color:var(--dim)">저장된 기록이 없습니다.</p>'}
    <div class="btnrow"><button class="btn" onclick="document.getElementById('hub-modal').remove()">닫기</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function loadGame(){
  try{
    const s=localStorage.getItem(SAVE_KEY);
    return s?JSON.parse(s):null;
  }catch(e){ return null; }
}
function loadState(s){
  G.roster=s.roster; G.party=s.party;
  G.extraSkills=s.extra||{}; G.deploy=s.deploy||null; G.diff=s.diff||'std';
}
function continueGame(){
  const s=loadGame();
  if(!s) return;
  loadState(s);
  if(s.ch>=CHAPTERS.length){ showChapterSelect(); return; }
  startChapter(s.ch);
}

/* ── 장 선택 (회상 모드) ── */
function showChapterSelect(){
  const s=loadGame(); if(!s) return;
  const maxCh=Math.min(s.ch, CHAPTERS.length-1);
  const html=`<div class="modal-back" id="cs-modal" onclick="if(event.target===this)this.remove()">
    <div class="modal"><h3>장 선택 (회상)</h3>
    <p style="font-size:13px;color:var(--dim);margin-bottom:8px">도달한 장까지, 현재 육성 상태 그대로 다시 도전할 수 있습니다.</p>
    ${CHAPTERS.map((c,i)=>`<div style="margin:4px 0"><button class="btn small" style="width:100%;text-align:left" ${i<=maxCh?'':'disabled'} onclick="jumpChapter(${i})">${c.title}${i<=maxCh?'':' 🔒'}</button></div>`).join('')}
    <div class="btnrow"><button class="btn" onclick="document.getElementById('cs-modal').remove()">닫기</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function jumpChapter(i){
  const m=document.getElementById('cs-modal'); if(m) m.remove();
  const s=loadGame(); if(!s) return;
  loadState(s);
  startChapter(i);
}

/* ── 영웅집결 무한 모드 ── */
const ENDLESS_KEY='kimyong_srpg_endless_best';
function bestWave(){ try{ return parseInt(localStorage.getItem(ENDLESS_KEY)||'0')||0; }catch(e){ return 0; } }
function setBestWave(w){ try{ if(w>bestWave()) localStorage.setItem(ENDLESS_KEY,String(w)); }catch(e){} }
function shuffleArr(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function rosterLevelUp(r){
  const names=['hp','str','int','def','res','spd','skl'];
  const c=CHARS[r.cid];
  const g=(c.grow&&c.grow.length)?c.grow:[60,40,40,40,40,40,40];
  r.lvl++;
  names.forEach((n,i)=>{ if(Math.random()*100<g[i]) r.stats[n]++; });
  r.stats.ki++;
}
/* 아레나로 쓸 챕터 인덱스 (초원·도화도·고묘·만안사·소림) */
const ARENAS=[0,4,7,11,17];
function makeEndlessWave(wave){
  const base=CHAPTERS[ARENAS[(wave-1)%ARENAS.length]];
  const minions=['dj','msa','gs','sab','sap','mgb','mgs','ydg','gdb','gds','ssj','myg'];
  const elites=['jhp','hth','yjo','plh','stc','yjs','gwd','hnp'];
  const bossPool=['mcp','ygang','ogg','oyb','imsu','grb','hbo','njg','sgon','myb','gmj','jcc','yyh'];
  const count=Math.min(11, 5+Math.floor(wave*0.8));
  const boost=Math.round((1+wave*0.05)*100)/100;
  /* 적 배치 후보: 우측 절반의 통행 가능 타일, 아군 스폰에서 3칸 이상 */
  let cells=[];
  const W=base.map[0].length;
  for(let y=0;y<base.map.length;y++)for(let x=Math.floor(W/2);x<W;x++){
    if(TILE[base.map[y][x]].cost<99) cells.push([x,y]);
  }
  cells=cells.filter(c=>base.spawns.every(s=>Math.abs(s[0]-c[0])+Math.abs(s[1]-c[1])>=3));
  shuffleArr(cells);
  const enemies=[];
  for(let i=0;i<count&&cells.length;i++){
    const pool=(wave>=3&&Math.random()<0.35)?elites:minions;
    const cid=pool[Math.floor(Math.random()*pool.length)];
    const [x,y]=cells.pop();
    enemies.push({cid,x,y,boost});
  }
  if(wave%3===0&&cells.length){ /* 3파마다 보스 출현 */
    const cid=bossPool[Math.floor(Math.random()*bossPool.length)];
    const [x,y]=cells.pop();
    enemies.push({cid,x,y,boss:true,boost:Math.round((boost+0.15)*100)/100});
  }
  return { no:4+wave, title:`영웅집결 — 제${wave}파`, joins:[], map:base.map, spawns:base.spawns,
    enemies, win:{type:'rout', text:`제${wave}파 전멸`}, lose:'곽정이 쓰러지면 패배', pre:[], post:[] };
}
function startEndless(){
  markPlay('endless');
  /* 전 영웅 집결: 스토리 진행과 무관하게 모든 아군을 Lv.10으로 소집 */
  ENDLESS=null; V2=null;
  G.chapterIdx=0; G.roster={}; G.party=[]; G.deploy=null;
  const allies=Object.keys(CHARS).filter(id=>!ENEMY_IDS.has(id)&&!CHARS[id].npc);
  for(const cid of allies) initRosterChar(cid);
  for(const cid of G.party){ const r=G.roster[cid]; for(let i=1;i<10;i++) rosterLevelUp(r); }
  G.extraSkills={gj:['jwauhobak'], jmk:['geongon']};
  nextWave(1);
}
function nextWave(w){
  ENDLESS={wave:w, ch:makeEndlessWave(w), diff:SETTINGS.diff};
  showDeploy();
}

/* ── 타이틀 ── */
function toTitle(){ B=null; ENDLESS=null; V2=null; showTitle(); }
function confirmToTitle(){ if(confirm('전투를 포기하고 타이틀로 돌아갈까요? (진행 상황은 챕터 시작 시점으로 돌아갑니다)')) toTitle(); }
function sndToggleUI(){
  const on=toggleSnd();
  if(on) SFX.play('select');
  document.querySelectorAll('.snd-btn').forEach(b=>{
    b.textContent=b.dataset.long?('사운드 '+(on?'♪ 켜짐':'꺼짐')):(on?'♪':'∅');
  });
}
/* ── 통합 설정 (난이도·연출 속도·사운드) ── */
function showSettings(){
  SFX.play('ui');
  const inBattle=!!B;
  const diffRows=Object.keys(DIFFS).map(id=>{
    const d=DIFFS[id], on=SETTINGS.diff===id;
    return `<button class="btn small setrow ${on?'on':''}" onclick="setDiff('${id}')">${d.name}${on?' ✓':''}<div class="set-sub">${d.desc}</div></button>`;
  }).join('');
  const spdRows=SPEEDS.map(s=>`<button class="btn small ${SETTINGS.speed===s?'on':''}" onclick="setSpeed(${s})">×${s}${SETTINGS.speed===s?' ✓':''}</button>`).join('');
  const html=`<div class="modal-back" id="set-modal" onclick="if(event.target===this)this.remove()">
    <div class="modal"><h3>설정</h3>
    <div class="set-sec"><div class="set-h">난이도 ${inBattle?'<span style="color:var(--dim);font-size:11px">(다음 전투/새 시작부터 적용)</span>':''}</div>
      <div class="set-col">${diffRows}</div></div>
    <div class="set-sec"><div class="set-h">전투 연출 속도</div>
      <div class="set-line">${spdRows}</div></div>
    <div class="set-sec"><div class="set-h">적 페이즈 빠르게</div>
      <div class="set-line">
        <button class="btn small ${SETTINGS.fastEnemy?'on':''}" onclick="toggleFastEnemy()">${SETTINGS.fastEnemy?'켜짐 ✓':'꺼짐'}</button>
        <span style="color:var(--dim);font-size:12px">적군 턴 연출을 가속합니다</span></div></div>
    <div class="set-sec"><div class="set-h">사운드</div>
      <div class="set-line"><button class="btn small snd-btn" data-long="1" onclick="sndToggleUI()">사운드 ${sndOn()?'♪ 켜짐':'꺼짐'}</button></div></div>
    <div class="set-sec"><div class="set-h">세이브 백업</div>
      <div class="set-line">
        <button class="btn small" onclick="exportSave()">내보내기</button>
        <button class="btn small" onclick="triggerImport()">가져오기</button>
        <span style="color:var(--dim);font-size:11.5px">전 기록을 파일로 저장·복원 (기기 이동)</span></div></div>
    <div class="set-sec"><div class="set-h">조작 안내</div>
      <div style="color:var(--dim);font-size:12px;line-height:1.7">방향키/WASD 커서 · Enter/Space 선택·확정 · Esc 취소 · Tab 다음 유닛 · E 턴 종료 · I 정보 · Z 배율<br>게임패드: 방향패드 이동 · A 확정 · B 취소 · Start 턴 종료 · Y 다음 유닛</div></div>
    <div class="btnrow"><button class="btn" onclick="document.getElementById('set-modal').remove()">닫기</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function setDiff(id){ SETTINGS.diff=id; saveSettings(); SFX.play('select');
  /* 현재 전투 중이 아니면 진행 중 세이브에도 즉시 반영 */
  const m=document.getElementById('set-modal'); if(m) m.remove(); showSettings(); }
function setSpeed(s){ SETTINGS.speed=s; saveSettings(); SFX.play('ui');
  const m=document.getElementById('set-modal'); if(m) m.remove(); showSettings(); }
function toggleFastEnemy(){ SETTINGS.fastEnemy=!SETTINGS.fastEnemy; saveSettings(); SFX.play('ui');
  const m=document.getElementById('set-modal'); if(m) m.remove(); showSettings(); }
function showTitle(){
  startBGM('calm');
  const hasSave=!!loadGame();
  const hasAny=hasSave || Object.keys(CAMPAIGNS).some(id=>v2LoadSave(id)) || bestWave()>0;
  app().innerHTML=`<div id="title-screen">
    ${titleArtSVG()}
    <div class="title-main">사조영웅전<span style="font-size:24px;color:var(--dim)"> ─ </span>강호의 별</div>
    <div class="title-sub">射鵰英雄傳 · 김용 무협 시뮬레이션 RPG</div>
    <div class="title-menu">
      <div><button class="btn" onclick="newGame()">새로운 협객행 (새 게임)</button></div>
      <div><button class="btn" onclick="showSaveHub()" ${hasAny?'':'disabled'}>이어하기 <span style="font-size:12px;color:var(--dim)">통합 기록</span></button></div>
      <div><button class="btn" onclick="showChapterSelect()" ${hasSave?'':'disabled'}>장 선택 (회상)</button></div>
      <div><button class="btn" onclick="showCampaignSelect()">신규 캠페인 <span style="font-size:12px;color:var(--gold2)">분기·아이템 (베타)</span></button></div>
      <div><button class="btn" onclick="startEndless()">영웅집결 무한 모드${bestWave()?` <span style="font-size:12px;color:var(--dim)">최고 ${bestWave()}파</span>`:''}</button></div>
      <div><button class="btn" onclick="showAchievements()">기록 · 업적 <span style="font-size:12px;color:var(--gold2)">${ACHV.filter(a=>ACHV_DONE[a.id]).length}/${ACHV.length}</span></button></div>
      <div><button class="btn" onclick="showHelp()">유파 안내 (도움말)</button></div>
      <div><button class="btn" onclick="showSettings()">설정 <span style="font-size:12px;color:var(--dim)">난이도 ${DIFFS[SETTINGS.diff].name} · ×${SETTINGS.speed}</span></button></div>
    </div>
    <div class="title-note">
      본 게임은 AI(Claude)가 제작한 김용(金庸) 원작 팬메이드 데모입니다.<br>
      전 19장: 사조영웅전 → 신조협려 → 의천도룡기 → 천룡팔부 + 영웅집결 무한 모드<br>
      PC · 모바일(터치) 지원 — 진행 상황은 챕터 클리어 시 자동 저장
    </div>
  </div>`;
}
function newGame(){
  G.chapterIdx=0; G.roster={}; G.party=[]; G.extraSkills={}; G.deploy=null; G.diff=SETTINGS.diff;
  startChapter(0);
}

/* ── 도움말 ── */
function showHelp(){
  const html=`
  <div class="modal-back" id="help-modal" onclick="if(event.target===this)this.remove()">
    <div class="modal">
      <h3>강호 지침 (도움말)</h3>
      <p style="font-size:13.5px;line-height:1.8;color:var(--dim)">
      아군 유닛 클릭 → 이동할 칸 클릭 → 행동 선택(공격/무공/치료/대기).<br>
      이동 중 <b style="color:var(--text)">적을 바로 클릭</b>하면 자동으로 접근해 공격합니다.<br>
      우클릭/취소로 행동을 무를 수 있습니다(행동 확정 전까지).</p>
      <table class="helptable">
        <tr><th colspan="3">무공 상성 (유리한 쪽 +피해 +명중)</th></tr>
        <tr><td><span class="typebadge type-외">외공</span> ▶ <span class="typebadge type-경">경공</span></td>
            <td><span class="typebadge type-경">경공</span> ▶ <span class="typebadge type-내">내공</span></td>
            <td><span class="typebadge type-내">내공</span> ▶ <span class="typebadge type-외">외공</span></td></tr>
      </table>
      <table class="helptable">
        <tr><th>지형</th><th>회피</th><th>방어</th><th>비고</th></tr>
        <tr><td>숲</td><td>+20</td><td>+1</td><td>이동비용 2</td></tr>
        <tr><td>산</td><td>+30</td><td>+2</td><td>이동비용 3</td></tr>
        <tr><td>가옥</td><td>+10</td><td>+2</td><td>매턴 HP 15% 회복</td></tr>
        <tr><td>물·담장</td><td>—</td><td>—</td><td>진입 불가</td></tr>
      </table>
      <p style="font-size:13.5px;line-height:1.8;color:var(--dim)">
      ◆ <b style="color:var(--text)">경공</b> 유닛은 험지(숲/산) 이동비용 -1<br>
      ◆ <b style="color:var(--text)">무공(스킬)</b>은 기(氣)를 소모하며, 기는 매턴 4씩 회복 — 무공을 여러 개 익힌 협객은 골라 쓸 수 있습니다<br>
      ◆ 속도가 4 이상 높으면 <b style="color:var(--text)">2회 공격</b> (무공 사용 시 제외) · <b style="color:var(--text)">좌우호박</b>은 무공 자체가 2연격<br>
      ◆ <b style="color:#c07ae0">중독</b>되면 3턴간 매턴 피해 (빙백은침·현명신장 등)<br>
      ◆ <b style="color:var(--text)">협공</b>: 인접(상하좌우)한 아군 1명당 명중 +4·피해 +1, 수비 측은 인접 아군 1명당 회피 +3 (최대 3명)<br>
      ◆ <b style="color:#e8a0c0">인연</b>: 신규 캠페인의 거점 <b style="color:var(--text)">지원 대화</b>로 두 협객의 인연을 C→B→A로 키우면, 전장에서 두 사람이 인접할 때 피해·명중·필살·회피가 랭크만큼 강해집니다 (★표시 인연은 최고 랭크에서 합격 각성)<br>
      ◆ 일부 전장에는 <b style="color:var(--text)">적 증원군</b>이 나타나고, <b style="color:var(--text)">방어전</b>은 규정 턴을 버티면 승리<br>
      ◆ 2장부터는 전투 전 <b style="color:var(--text)">출전 멤버</b>를 선택합니다<br>
      ◆ 쓰러진 아군은 <b style="color:var(--text)">부상 이탈</b> — 다음 챕터에 복귀 (곽정이 쓰러지면 패배)<br>
      ◆ <b style="color:var(--text)">모바일</b>: 유닛·타일을 탭해서 조작, 상단 <b style="color:var(--text)">취소</b> 버튼 = 우클릭, <b style="color:var(--text)">배율</b> 버튼으로 맵 확대<br>
      ◆ 진행 상황은 챕터 클리어 시 자동 저장 · 타이틀의 <b style="color:var(--text)">장 선택</b>에서 회상 재도전 가능<br>
      ◆ <b style="color:var(--gold2)">영웅집결 무한 모드</b>: 전 영웅 Lv.10으로 집결, 갈수록 강해지는 적의 파도에 도전 — 3파마다 보스 출현, 웨이브 간 성장 유지, 최고 기록 자동 저장</p>
      <div class="btnrow"><button class="btn" onclick="document.getElementById('help-modal').remove()">닫기</button></div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

/* ── 키보드 조작 (전투) ── */
function anyModalOpen(){ return !!document.querySelector('.modal-back'); }
function keyCursor(dx,dy){
  if(!B||B.busy||B.over||B.phase!=='P') return;
  const c=B.tileSel||(B.sel?{x:B.sel.x,y:B.sel.y}:{x:0,y:0});
  const nx=Math.max(0,Math.min(B.w-1,c.x+dx)), ny=Math.max(0,Math.min(B.h-1,c.y+dy));
  B.tileSel={x:nx,y:ny};
  focusUnit({x:nx,y:ny});
  renderBattle();
}
function keyConfirm(){
  if(!B||B.busy||B.over) return;
  const fc=document.getElementById('fc-modal'); if(fc){ confirmAttack(); return; }
  if(B.phase!=='P') return;
  const c=B.tileSel; if(c) onTile(c.x,c.y);
}
function keyCancel(){
  const fc=document.getElementById('fc-modal'); if(fc){ cancelForecast(); return; }
  const hm=document.querySelector('.modal-back'); if(hm&&hm.id!=='fc-modal'){ hm.remove(); return; }
  if(B&&!B.busy) uiCancel();
}
function keyNextUnit(){
  if(!B||B.busy||B.over||B.phase!=='P') return;
  const ps=players().filter(u=>!u.acted);
  if(!ps.length) return;
  const cur=B.tileSel?unitAt(B.tileSel.x,B.tileSel.y):null;
  let idx=cur?ps.indexOf(cur):-1;
  const u=ps[(idx+1)%ps.length];
  clearSel(); B.tileSel={x:u.x,y:u.y}; focusUnit(u); selectUnit(u);
}
document.addEventListener('keydown',e=>{
  /* 모달/입력 중이면 전투 조작키 무시 (Esc/Enter만 처리) */
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||'');
  if(typing) return;
  switch(e.key){
    case 'Escape': keyCancel(); e.preventDefault(); return;
    case 'Enter': keyConfirm(); e.preventDefault(); return;
    case 'ArrowUp': case 'w': case 'W': keyCursor(0,-1); e.preventDefault(); return;
    case 'ArrowDown': case 's': case 'S': keyCursor(0,1); e.preventDefault(); return;
    case 'ArrowLeft': case 'a': case 'A': keyCursor(-1,0); e.preventDefault(); return;
    case 'ArrowRight': case 'd': case 'D': keyCursor(1,0); e.preventDefault(); return;
    case ' ': keyConfirm(); e.preventDefault(); return;
    case 'Tab': keyNextUnit(); e.preventDefault(); return;
    case 'e': case 'E': if(B&&!B.busy&&B.phase==='P'){ endPlayerPhase(); e.preventDefault(); } return;
    case 'i': case 'I': if(B){ toggleInfoPop(); e.preventDefault(); } return;
    case 'z': case 'Z': if(B){ cycleZoom(); e.preventDefault(); } return;
  }
});

/* ── 게임패드 기본 조작 ── */
let GP_PREV={};
function gamepadPoll(){
  const pads=(navigator.getGamepads&&navigator.getGamepads())||[];
  const gp=[...pads].find(p=>p);
  if(gp&&B&&!B.busy&&!B.over){
    const b=gp.buttons, ax=gp.axes;
    const pressed=i=>b[i]&&b[i].pressed;
    const edge=(i)=>{ const p=pressed(i); const was=GP_PREV[i]; GP_PREV[i]=p; return p&&!was; };
    /* 방향: dpad(12~15) 또는 좌스틱 */
    if(edge(12)||(ax[1]<-0.6&&!GP_PREV.up)){ keyCursor(0,-1); }
    GP_PREV.up = ax[1]<-0.6;
    if(edge(13)||(ax[1]>0.6&&!GP_PREV.down)){ keyCursor(0,1); }
    GP_PREV.down = ax[1]>0.6;
    if(edge(14)||(ax[0]<-0.6&&!GP_PREV.left)){ keyCursor(-1,0); }
    GP_PREV.left = ax[0]<-0.6;
    if(edge(15)||(ax[0]>0.6&&!GP_PREV.right)){ keyCursor(1,0); }
    GP_PREV.right = ax[0]>0.6;
    if(edge(0)) keyConfirm();          /* A */
    if(edge(1)) keyCancel();           /* B */
    if(edge(9)&&B.phase==='P') endPlayerPhase(); /* Start */
    if(edge(3)) keyNextUnit();         /* Y */
  } else if(!B){ GP_PREV={}; }
  requestAnimationFrame(gamepadPoll);
}
requestAnimationFrame(gamepadPoll);

/* ── 세이브 백업 (내보내기/가져오기) ── */
function exportSave(){
  SFX.play('ui');
  const data={};
  for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.indexOf('kimyong')===0) data[k]=localStorage.getItem(k); }
  const payload={app:'kangho', v:1, ts:Date.now(), data};
  const blob=new Blob([JSON.stringify(payload,null,1)],{type:'application/json'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  const d=new Date();
  const pad=n=>String(n).padStart(2,'0');
  a.href=url; a.download=`강호의별_백업_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function triggerImport(){
  let inp=document.getElementById('save-import-file');
  if(!inp){ inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json'; inp.id='save-import-file'; inp.style.display='none';
    inp.addEventListener('change',()=>importSaveFile(inp)); document.body.appendChild(inp); }
  inp.value=''; inp.click();
}
function importSaveFile(input){
  const f=input.files&&input.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const obj=JSON.parse(rd.result);
      const d=obj&&obj.data?obj.data:obj;
      if(!d||typeof d!=='object') throw 0;
      let n=0;
      for(const k in d){ if(k.indexOf('kimyong')===0){ localStorage.setItem(k, d[k]); n++; } }
      if(!n) throw 0;
      alert(`${n}개 기록을 복원했습니다. 게임을 새로고침합니다.`);
      location.reload();
    }catch(e){ alert('가져오기 실패 — 올바른 백업 파일이 아닙니다.'); }
  };
  rd.readAsText(f);
}

/* 부팅은 main.js 의 boot() 에서 수행 */


/* ============================================================
   v2 캠페인 엔진 — 그래프·플래그·아이템·거점·승급·보물
   ============================================================ */
const CAMPAIGNS = { sajo: SAJO, sinjo: SINJO, uicheon: UICHEON, chunryong: CHUNRYONG, hwasan: HWASAN, hooildam: HOOILDAM, wolnyeo: WOLNYEO, dokgo: DOKGO, hwalsa: HWALSA, pungreung: PUNGREUNG, jinfinal: JINFINAL };
let V2 = null; // 진행 중 캠페인 상태
let CAMP_CTX = null; // 거점 화면 컨텍스트 {node, back}
let CAMP_TAB = 'unit';
const DEFAULT_SHOP = ['mokgeom','cheolgeom','gangcheol','yuyeopdo','panhwanpil','hosinbu','okpae','yeonwoogap','chilseongpae','gyeonggong','bihohye','ungdam','geumchang','sohwandan','haedok','byeokhahwan','jeongsimdan'];

const v2Key = id => 'kimyong_v2_' + id;
function partyLeader(){
  if(V2&&CAMPAIGNS[V2.camp]&&CAMPAIGNS[V2.camp].leader){
    const ld=CAMPAIGNS[V2.camp].leader;
    return G.party.includes(ld)?ld:null;
  }
  return G.party.find(cid=>CHARS[cid].leader)||null;
}
function v2New(campId){
  const C = CAMPAIGNS[campId];
  return { camp:campId, stageId:C.start, flags:{}, gold:C.gold||0, inv:{}, equips:{}, promoted:{},
           cleared:[], attempted:{}, roster:{}, party:[], extraSkills:{}, deploy:null,
           supports:{}, supportLock:{}, diff:SETTINGS.diff };
}
function v2Save(){
  markPlay('v2', V2&&V2.camp);
  if(!V2) return;
  try{ const {curBattle, ...st}=V2; localStorage.setItem(v2Key(V2.camp), JSON.stringify(st)); }catch(e){}
}
function v2LoadSave(campId){
  try{ const s=localStorage.getItem(v2Key(campId)); return s?JSON.parse(s):null; }catch(e){ return null; }
}
function v2Bind(){
  G.roster=V2.roster; G.party=V2.party; G.extraSkills=V2.extraSkills; G.deploy=V2.deploy;
}
function initRosterCharV2(cid){
  if(V2.roster[cid]){
    if(!V2.party.includes(cid)) V2.party.push(cid); /* 이탈했던 동료 복귀 */
    return;
  }
  V2.roster[cid]={cid, lvl:1, exp:0, stats:statObj(CHARS[cid].base)};
  V2.party.push(cid);
}
function startCampaignV2(campId, useSave, ngBonus){
  ENDLESS=null; B=null;
  const C=CAMPAIGNS[campId];
  const loaded=useSave&&v2LoadSave(campId);
  V2=loaded||v2New(campId);
  V2.attempted=V2.attempted||{};
  V2.supports=V2.supports||{}; V2.supportLock=V2.supportLock||{}; /* 구 세이브 호환 */
  if(!loaded&&C.inherit){ /* 전권 세이브에서 플래그·보너스 계승 */
    const src=v2LoadSave(C.inherit.from);
    if(src){
      for(const f of (C.inherit.flags||[])) if(src.flags&&src.flags[f]) V2.flags[f]=src.flags[f];
      if(src.cleared&&src.cleared.includes('end')){
        V2.gold+=(C.inherit.clearBonusGold||0);
        V2.flags.prevClear=1;
      }
    }
  }
  if(!V2.party.length){ for(const cid of C.party) initRosterCharV2(cid); }
  if(!loaded){
    if(C.startLvl){ for(const cid of V2.party){ const r=V2.roster[cid]; while(r.lvl<C.startLvl) rosterLevelUp(r); } }
    if(C.startInv) for(const k in C.startInv) V2.inv[k]=(V2.inv[k]||0)+C.startInv[k];
    if(C.startSkills) for(const k in C.startSkills) V2.extraSkills[k]=[...(C.startSkills[k]||[])];
    /* 회차(New Game+) 계승 보너스 */
    if(ngBonus){
      V2.ngPlus=true; unlockAchv('ng_plus');
      if(ngBonus==='gold') V2.gold += 2000;
      else if(ngBonus==='item'){ V2.inv.bogeom=(V2.inv.bogeom||0)+1; V2.inv.daehwandan=(V2.inv.daehwandan||0)+3; V2.inv.yeonwoogap=(V2.inv.yeonwoogap||0)+1; }
      else if(ngBonus==='bond'){ for(const p of SUPPORTS.pairs){ if(V2.party.includes(p.a)&&V2.party.includes(p.b)) V2.supports[pairKey(p.a,p.b)]=2; } }
    }
  }
  v2Bind();
  v2Save(); /* 시작 즉시 저장 → 통합 이어하기 허브에 노출 */
  showRouteMap();
}
function curNode(){ return V2?CAMPAIGNS[V2.camp].stages[V2.stageId]:null; }
function v2Lines(lines){
  return (lines||[]).filter(l=>{
    if(l.ifNot&&V2.flags[l.ifNot]) return false;
    if(('if' in l)&&l.if!==null&&l.if!==undefined&&!V2.flags[l.if]) return false;
    return true;
  });
}
function v2BattleDef(n){
  const battles=V2.cleared.filter(id=>{const st=CAMPAIGNS[V2.camp].stages[id];return st&&st.kind==='battle';}).length;
  return { no:battles+1, joins:[], title:n.title, map:n.map, spawns:n.spawns, enemies:n.enemies,
    reinforce:n.reinforce, win:n.win, lose:n.lose||'수령이 쓰러지면 패배', pre:[], post:[],
    treasures:n.treasures||[], goldReward:n.goldReward||0, deploy:n.deploy||null };
}
function v2Enter(){
  if(!V2) return;
  v2Save();
  const n=curNode();
  if(!n){ toTitle(); return; }
  (n.joins||[]).forEach(cid=>initRosterCharV2(cid));
  (n.leave||[]).forEach(cid=>{
    const i=V2.party.indexOf(cid); if(i>=0) V2.party.splice(i,1);
    if(V2.deploy){ const j=V2.deploy.indexOf(cid); if(j>=0) V2.deploy.splice(j,1); }
  });
  /* 첫 진입 시 컷신 → 대사 순으로 (재도전 시 생략) */
  const firstTime = !V2.attempted[V2.stageId] && !V2.cleared.includes(V2.stageId);
  const withCut = (after)=>{ if(firstTime && n.cut) showCutscene(n.cut, after); else after(); };
  if(n.kind==='talk'){
    const go=()=>v2Advance(n);
    if(V2.attempted[V2.stageId]) go();
    else { V2.attempted[V2.stageId]=1; withCut(()=>showDialogue(v2Lines(n.pre), go, n.title)); }
    return;
  }
  if(n.kind==='battle'){
    const dep=()=>v2Deploy(n);
    if(V2.attempted[V2.stageId]) dep();
    else { V2.attempted[V2.stageId]=1; withCut(()=>showDialogue(v2Lines(n.pre), dep, n.title)); }
  }else if(n.kind==='camp'){
    const go=()=>showCamp(n,'route');
    if(n.pre&&!V2.cleared.includes(V2.stageId)&&!V2.attempted[V2.stageId]){ V2.attempted[V2.stageId]=1; showDialogue(v2Lines(n.pre), go, n.title); }
    else go();
  }else if(n.kind==='choice'){
    showChoiceNode(n);
  }else if(n.kind==='end'){
    showV2End(n);
  }
}
function v2Deploy(n){
  V2.curBattle=v2BattleDef(n);
  G.deploy=V2.deploy;
  showDeploy();
}
function v2AfterBattle(){
  const n=curNode();
  const go=()=>v2Advance(n);
  if(n.post&&n.post.length) showDialogue(v2Lines(n.post), go);
  else go();
}
function v2Advance(n){
  let nx=n?n.next:null;
  if(n&&n.set) Object.assign(V2.flags,n.set); /* 노드 완료 시 플래그 */
  if(nx&&typeof nx==='object'&&nx.cond){ /* 플래그 조건/비교 분기 */
    let to=nx.else;
    for(const c of nx.cond){
      if(c.and){ if(c.and.every(f=>V2.flags[f])){ to=c.to; break; } }
      else if(c.gte){ if((V2.flags[c.gte[0]]||0)>=(V2.flags[c.gte[1]]||0)){ to=c.to; break; } }
      else if(c.if&&V2.flags[c.if]){ to=c.to; break; }
    }
    nx=to;
  }
  if(!nx){ toTitle(); return; }
  if(!V2.cleared.includes(V2.stageId)) V2.cleared.push(V2.stageId);
  V2.stageId=nx; v2Save(); v2Enter();
}
function showChoiceNode(n){
  app().innerHTML=`<div class="result-screen" style="padding:44px 0">
    <h2 style="font-size:26px">${n.title}</h2>
    <p>${n.prompt}</p>
    ${n.options.map((o,i)=>({o,i})).filter(x=>!(x.o.hideIf&&V2.flags[x.o.hideIf])).map(x=>`<div style="margin:12px 0">
      <button class="btn" style="min-width:min(480px,88vw)" onclick="pickChoice(${x.i})">${x.o.label}</button>
      <div style="color:var(--dim);font-size:12.5px;margin-top:4px">${x.o.desc||''}</div></div>`).join('')}
  </div>`;
}
function pickChoice(i){
  const n=curNode(), o=n.options[i];
  if(o.set) Object.assign(V2.flags,o.set);
  if(o.add) for(const k in o.add) V2.flags[k]=(V2.flags[k]||0)+o.add[k];
  if(!V2.cleared.includes(V2.stageId)) V2.cleared.push(V2.stageId);
  V2.stageId=o.to; v2Save(); v2Enter();
}
function showV2End(n){
  if(!V2.cleared.includes(V2.stageId)) V2.cleared.push(V2.stageId);
  v2Save();
  recordCampaignClear(V2.camp, V2.stageId);
  SFX.play('victory'); startBGM('calm');
  app().innerHTML=`<div class="result-screen">
    ${sealSVG('終','#d9b36c')}<h2>終 幕</h2>
    <p>${(n.text||[]).join('<br>')}</p>
    <button class="btn" onclick="showRouteMap()">루트 맵</button>
    <button class="btn danger" onclick="toTitle()">타이틀로</button>
  </div>`;
}

/* ── 보물 획득 ── */
function v2Pickup(u){
  if(!B||!B.treasures||!u||u.team!=='P') return;
  const t=B.treasures.find(t=>!t.taken&&t.x===u.x&&t.y===u.y);
  if(!t) return;
  t.taken=true;
  SFX.play('gold');
  if(t.gold){ B.loot.gold+=t.gold; fx(u.x,u.y,`+${t.gold}냥`,'label'); log(`<b>보물!</b> ${t.gold}냥 획득 (승리 시 확정)`,true); }
  if(t.item){ B.loot.items.push(t.item); fx(u.x,u.y,ITEMS[t.item].name,'label'); log(`<b>보물!</b> ${ITEMS[t.item].name} 획득 (승리 시 확정)`,true); }
  renderBattle(true);
}

/* ── 도구 (전투 중 소모품) ── */
function v2Usables(){
  if(!V2) return [];
  return Object.keys(V2.inv).filter(id=>V2.inv[id]>0&&ITEMS[id]&&ITEMS[id].kind==='use');
}
function openToolMenu(u){
  const list=v2Usables();
  const html=`<div class="modal-back" id="tool-modal">
    <div class="modal"><h3>도구 사용 — ${u.name}</h3>
    ${list.map(id=>{const it=ITEMS[id];return `<div style="margin:6px 0"><button class="btn small" style="width:100%;text-align:left" onclick="v2UseTool('${id}')">${it.name} ×${V2.inv[id]} <span style="color:var(--dim);font-size:12px">— ${it.desc}</span></button></div>`;}).join('')}
    <div class="btnrow"><button class="btn" onclick="closeToolMenu()">취소</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function closeToolMenu(){ const m=document.getElementById('tool-modal'); if(m) m.remove(); backToMenu(); }
function v2UseTool(id){
  const m=document.getElementById('tool-modal'); if(m) m.remove();
  const u=B.sel, it=ITEMS[id];
  if(!u||!it||(V2.inv[id]||0)<=0){ backToMenu(); return; }
  V2.inv[id]--; if(V2.inv[id]<=0) delete V2.inv[id];
  if(it.cure&&u.poison){ u.poison=0; log(`${u.name} — 해독되었다`); }
  if(it.heal){ const amt=Math.min(u.maxhp-u.hp, it.heal); u.hp+=amt; fx(u.x,u.y,'+'+amt,'heal'); SFX.play('heal'); log(`${u.name} — ${it.name} 사용 (HP ${amt} 회복)`); }
  if(it.ki){ const amt=Math.min(u.maxki-u.ki, it.ki); u.ki+=amt; fx(u.x,u.y,'기+'+amt,'label'); SFX.play('skill'); log(`${u.name} — ${it.name} 사용 (기 ${amt} 회복)`); }
  v2Save();
  renderBattle(true);
  finishUnit(u);
}

/* ── 거점 (편성·상점·행낭·승급) ── */
function showCamp(node, back){
  CAMP_CTX={node:node||null, back:back||'route'};
  CAMP_TAB='unit';
  startBGM('calm');
  renderCamp();
}
function campTab(t){ CAMP_TAB=t; renderCamp(); }
function campFromDeploy(){ showCamp(null,'deploy'); }
function campFromRoute(){ showCamp(null,'route'); }
function campBack(){ if(CAMP_CTX&&CAMP_CTX.back==='deploy'){ v2Deploy(curNode()); } else showRouteMap(); }
function campShopList(){
  /* 거점 고유 품목 + 기본 카탈로그(신규 아이템 포함)를 합쳐 항상 노출 */
  const themed=(CAMP_CTX&&CAMP_CTX.node&&CAMP_CTX.node.shop)||[];
  const seen=new Set(), out=[];
  for(const id of [...themed, ...DEFAULT_SHOP]){ if(!seen.has(id)&&ITEMS[id]){ seen.add(id); out.push(id); } }
  return out;
}
function ownedCount(id){ return V2.inv[id]||0; }
function renderCamp(){
  const n=CAMP_CTX.node;
  let body='';
  if(CAMP_TAB==='unit') body=campUnitHTML();
  else if(CAMP_TAB==='shop') body=campShopHTML();
  else if(CAMP_TAB==='support') body=campSupportHTML();
  else body=campBagHTML();
  const nSup=campSupportAvail().filter(p=>(V2.supports[pairKey(p.a,p.b)]||0)<3 && V2.supportLock[pairKey(p.a,p.b)]!==V2.stageId).length;
  app().innerHTML=`<div id="camp">
    <h2>${n?n.title:'거점 — 부대 정비'}</h2>
    <div class="camp-head"><span>소지금 <b style="color:var(--gold2)">${V2.gold}냥</b></span><span>부대 ${V2.party.length}명</span></div>
    <div class="camp-tabs">
      <button class="btn small ${CAMP_TAB==='unit'?'on':''}" onclick="campTab('unit')">편성·승급</button>
      <button class="btn small ${CAMP_TAB==='shop'?'on':''}" onclick="campTab('shop')">상점</button>
      <button class="btn small ${CAMP_TAB==='support'?'on':''}" onclick="campTab('support')">지원 대화${nSup?` <span style="color:#e8a0c0">●${nSup}</span>`:''}</button>
      <button class="btn small ${CAMP_TAB==='bag'?'on':''}" onclick="campTab('bag')">행낭</button>
    </div>
    <div id="camp-body">${body}</div>
    <div style="text-align:center;margin-top:14px">
      ${n?`<button class="btn" onclick="v2Depart()">출 발</button>`:`<button class="btn" onclick="campBack()">돌아가기</button>`}
      <button class="btn small danger" style="margin-left:8px" onclick="toTitle()">타이틀로</button>
    </div>
  </div>`;
}
function v2Depart(){
  const n=CAMP_CTX.node;
  if(!V2.cleared.includes(V2.stageId)) V2.cleared.push(V2.stageId);
  v2Advance(n);
}
function campUnitHTML(){
  return `<table class="camptable"><tr><th>협객</th><th>Lv</th><th>병기</th><th>보구</th><th>승급</th></tr>`+
  V2.party.map(cid=>{
    const r=V2.roster[cid], c=CHARS[cid];
    const eq=V2.equips[cid]=V2.equips[cid]||{w:null,a:null};
    const opts=k=>{
      const kind=k==='w'?'weapon':'acc';
      let o=`<option value="">—</option>`;
      for(const id in ITEMS){
        if(ITEMS[id].kind!==kind) continue;
        if(eq[k]===id) o+=`<option value="${id}" selected>${ITEMS[id].name} (장착)</option>`;
        else if(ownedCount(id)>0) o+=`<option value="${id}">${ITEMS[id].name} ×${ownedCount(id)}</option>`;
      }
      return o;
    };
    const promo=c.promo;
    let pcell='—';
    if(V2.promoted[cid]) pcell=`<span style="color:var(--gold2)">${V2.promoted[cid]}</span>`;
    else if(promo){
      const ok=r.lvl>=promo.lvl&&ownedCount(promo.item)>0;
      pcell=`<button class="btn small" ${ok?'':'disabled'} onclick="v2Promote('${cid}')">승급</button>
        <div style="font-size:11px;color:var(--dim)">Lv${promo.lvl} + ${ITEMS[promo.item].name}</div>`;
    }
    return `<tr><td style="text-align:left"><b style="color:var(--gold2)">${c.name}</b><div style="font-size:11px;color:var(--dim)">${V2.promoted[cid]||c.cls}</div></td>
      <td>${r.lvl}</td>
      <td><select onchange="v2Equip('${cid}','w',this.value)">${opts('w')}</select></td>
      <td><select onchange="v2Equip('${cid}','a',this.value)">${opts('a')}</select></td>
      <td>${pcell}</td></tr>`;
  }).join('')+`</table>`;
}
function v2Equip(cid, slot, id){
  SFX.play('equip');
  const eq=V2.equips[cid]=V2.equips[cid]||{w:null,a:null};
  if(eq[slot]){ V2.inv[eq[slot]]=(V2.inv[eq[slot]]||0)+1; eq[slot]=null; }
  if(id){
    if((V2.inv[id]||0)<=0){ v2Save(); renderCamp(); return; }
    V2.inv[id]--; if(V2.inv[id]<=0) delete V2.inv[id];
    eq[slot]=id;
  }
  v2Save(); renderCamp();
}
function v2Promote(cid){
  const c=CHARS[cid], promo=c.promo, r=V2.roster[cid];
  if(!promo||V2.promoted[cid]||r.lvl<promo.lvl||(V2.inv[promo.item]||0)<=0) return;
  V2.inv[promo.item]--; if(V2.inv[promo.item]<=0) delete V2.inv[promo.item];
  for(const k in (promo.bonus||{})) r.stats[k]=(r.stats[k]||0)+promo.bonus[k];
  V2.promoted[cid]=promo.cls;
  unlockAchv('promote');
  if(promo.skill){
    V2.extraSkills[cid]=V2.extraSkills[cid]||[];
    if(!V2.extraSkills[cid].includes(promo.skill)) V2.extraSkills[cid].push(promo.skill);
  }
  v2Save(); renderCamp();
}
function campShopHTML(){
  const list=campShopList();
  const buy=list.map(id=>{const it=ITEMS[id];return `<tr><td style="text-align:left"><b>${it.name}</b><div style="font-size:11px;color:var(--dim)">${it.desc}</div></td><td>${it.price}냥</td><td><button class="btn small" ${V2.gold>=it.price?'':'disabled'} onclick="v2Buy('${id}')">구입</button></td></tr>`;}).join('');
  const inv=Object.keys(V2.inv);
  const sell=inv.length?inv.map(id=>{const it=ITEMS[id];return `<tr><td style="text-align:left">${it.name} ×${V2.inv[id]}</td><td>${Math.floor(it.price/2)}냥</td><td><button class="btn small" onclick="v2Sell('${id}')">매각</button></td></tr>`;}).join(''):`<tr><td colspan="3" style="color:var(--dim)">매각할 물건이 없습니다</td></tr>`;
  return `<div class="camp-cols"><div><h3>구입</h3><table class="camptable">${buy}</table></div>
  <div><h3>매각 <span style="font-size:11px;color:var(--dim)">(정가의 절반)</span></h3><table class="camptable">${sell}</table></div></div>`;
}
function v2Buy(id){ const it=ITEMS[id]; if(!it||V2.gold<it.price) return; V2.gold-=it.price; V2.inv[id]=(V2.inv[id]||0)+1; SFX.play('gold'); v2Save(); renderCamp(); }
function v2Sell(id){ if((V2.inv[id]||0)<=0) return; V2.inv[id]--; if(V2.inv[id]<=0) delete V2.inv[id]; V2.gold+=Math.floor(ITEMS[id].price/2); SFX.play('gold'); v2Save(); renderCamp(); }
function campBagHTML(){
  return `<table class="camptable">${invRowsHTML()}</table>`;
}
/* ── 지원 대화(인연) 탭 ── */
function campSupportAvail(){
  return SUPPORTS.pairs.filter(p=>V2.party.includes(p.a)&&V2.party.includes(p.b));
}
function campSupportHTML(){
  const avail=campSupportAvail();
  if(!avail.length) return `<p style="color:var(--dim);padding:10px 4px">아직 인연을 나눌 동료가 모이지 않았습니다. 이야기가 진행되면 새 인연이 열립니다.</p>`;
  const rows=avail.map(p=>{
    const key=pairKey(p.a,p.b), rank=V2.supports[key]||0;
    const locked=V2.supportLock[key]===V2.stageId;
    const maxed=rank>=3;
    const rankBadge=rank?`<span style="color:#e8a0c0">인연 ${RANK_NAME[rank]}</span>`:`<span style="color:var(--dim)">인연 없음</span>`;
    let btn;
    if(maxed) btn=`<span style="color:var(--gold2);font-size:12px">최고 랭크 · 합격 각성</span>`;
    else if(locked) btn=`<span style="color:var(--dim);font-size:12px">이번 거점에서 시청함</span>`;
    else btn=`<button class="btn small" onclick="viewSupport('${key}')">지원 대화 (→ ${RANK_NAME[rank+1]})</button>`;
    return `<tr>
      <td style="text-align:left"><b style="color:var(--gold2)">${p.label}</b>${p.special?' <span style="font-size:11px;color:#e8a0c0">★합격</span>':''}<div style="font-size:11px;color:var(--dim)">${rankBadge}</div></td>
      <td>${btn}</td></tr>`;
  }).join('');
  return `<p style="color:var(--dim);font-size:12.5px;margin-bottom:8px">인연이 깊을수록 전장에서 두 사람이 <b style="color:#e8a0c0">인접</b>하면 피해·명중·필살·회피가 강해집니다. 거점마다 인연 하나를 한 단계씩 키울 수 있습니다.</p>
    <table class="camptable"><tr><th>인연</th><th>지원 대화</th></tr>${rows}</table>`;
}
function viewSupport(key){
  const p=SUPPORT_MAP[key]; if(!p) return;
  const rank=V2.supports[key]||0;
  if(rank>=3||V2.supportLock[key]===V2.stageId) return;
  const conv=p.convs[SUPPORTS.ranks[rank]];
  SFX.play('ui');
  const done=()=>{
    V2.supports[key]=rank+1;
    V2.supportLock[key]=V2.stageId;
    if(rank+1>=3){ SFX.play('levelup'); unlockAchv('bond_max'); } else SFX.play('heal');
    v2Save();
    CAMP_TAB='support';
    renderCamp();
  };
  showDialogue(conv, done, `지원 대화 — ${p.label} (${RANK_NAME[rank+1]})`);
}

/* ── 루트 맵 ── */
function showRouteMap(){
  startBGM('calm');
  const C=CAMPAIGNS[V2.camp];
  const rows=C.order.map(id=>{
    const n=C.stages[id];
    const cleared=V2.cleared.includes(id);
    const cur=V2.stageId===id;
    const icon=cleared?'✓':(cur?'▶':'·');
    const cls=cleared?'done':(cur?'cur':'lock');
    const kindTxt={battle:'전투',camp:'거점',choice:'분기',talk:'이야기',end:'종막'}[n.kind]||'';
    return `<div class="route-row ${cls}" ${cur?`onclick="v2Enter()"`:''}>
      <span class="ri">${icon}</span><span class="rt">${n.title||id}</span><span class="rk">${kindTxt}</span></div>`;
  }).join('');
  app().innerHTML=`<div id="routemap">
    <h2>${C.name}</h2>
    <div class="camp-head"><span>소지금 <b style="color:var(--gold2)">${V2.gold}냥</b></span><span>부대 ${V2.party.length}명</span><span>행적 ${Object.keys(V2.flags).length}건</span></div>
    <div class="route-list">${rows}</div>
    <div style="text-align:center;margin-top:14px">
      <button class="btn" onclick="v2Enter()">진행 ▶</button>
      <button class="btn small" style="margin-left:8px" onclick="campFromRoute()">거점 (장비·승급)</button>
      <button class="btn small danger" style="margin-left:8px" onclick="toTitle()">타이틀로</button>
    </div>
  </div>`;
}

/* ── 캠페인 선택 ── */
function campCleared(id){
  const sv=v2LoadSave(id);
  return !!(sv&&sv.cleared&&sv.cleared.some(x=>String(x).startsWith('end')));
}
function lockedCard(id, badge){
  const C=CAMPAIGNS[id];
  const req=C.requireAll||[];
  const done=req.filter(campCleared).length;
  const reqNames=req.map(r=>`${CAMPAIGNS[r]?CAMPAIGNS[r].name.replace(/^(해금 외전|외전.·|외전.|사조삼부곡 [^—]*—) /,'').trim():r}${campCleared(r)?' ✓':''}`).join(' · ');
  return `<div class="camp-card lock"><h3>🔒 ${C.name} ${badge?`<span style="font-size:12px;color:var(--gold2)">${badge}</span>`:''}</h3>
    <p>${C.desc}</p>
    <p style="color:var(--gold2);font-size:12.5px">해금 조건 (${done}/${req.length}): ${reqNames}</p></div>`;
}
function unlocked(id){ return (CAMPAIGNS[id].requireAll||[]).every(campCleared); }
function campCard(id, badge){
  const C=CAMPAIGNS[id], sv=v2LoadSave(id);
  const cleared=campCleared(id);
  return `<div class="camp-card">
    <h3>${C.name} ${badge?`<span style="font-size:12px;color:var(--gold2)">${badge}</span>`:''}${cleared?' <span style="font-size:12px;color:#8fce6a">✓ 완주</span>':''}</h3>
    <p>${C.desc}</p>
    <div>
      ${sv?`<button class="btn" onclick="startCampaignV2('${id}',true)">이어하기 (진행 ${sv.cleared.length}단계)</button>`:''}
      <button class="btn ${sv?'small':''}" ${sv?'style="margin-left:8px"':''} onclick="startCampaignV2('${id}',false)">${sv?'처음부터':'시작하기'}</button>
      ${cleared?`<button class="btn small" style="margin-left:8px" onclick="chooseNgPlus('${id}')">회차+ <span style="font-size:11px;color:var(--gold2)">계승</span></button>`:''}
    </div></div>`;
}
/* ── 회차(New Game+) 계승 선택 ── */
function chooseNgPlus(id){
  SFX.play('ui');
  const html=`<div class="modal-back" id="ng-modal" onclick="if(event.target===this)this.remove()">
    <div class="modal"><h3>회차 계승 — ${CAMPAIGNS[id].name}</h3>
    <p style="font-size:12.5px;color:var(--dim);margin-bottom:10px">완주한 캠페인을 처음부터 다시 시작합니다. 계승 보너스 하나를 선택하세요. (기존 세이브는 덮어씁니다)</p>
    <div class="set-col">
      <button class="btn small setrow" onclick="ngStart('${id}','gold')">자금 우대<div class="set-sub">시작 소지금 +2000냥</div></button>
      <button class="btn small setrow" onclick="ngStart('${id}','item')">명품 병기<div class="set-sub">보검 + 대환단 ×3 + 연위갑 지급</div></button>
      <button class="btn small setrow" onclick="ngStart('${id}','bond')">인연 계승<div class="set-sub">이 부대의 모든 인연을 B랭크로 시작</div></button>
    </div>
    <div class="btnrow"><button class="btn" onclick="document.getElementById('ng-modal').remove()">취소</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function ngStart(id,bonus){ const m=document.getElementById('ng-modal'); if(m) m.remove(); startCampaignV2(id,false,bonus); }

/* ── 기록·업적 화면 ── */
function showAchievements(){
  SFX.play('ui');
  const done=ACHV.filter(a=>ACHV_DONE[a.id]).length;
  const rows=ACHV.map(a=>{
    const ok=ACHV_DONE[a.id];
    return `<div class="achv-row ${ok?'on':''}"><div class="achv-ic">${ok?'🏅':'🔒'}</div>
      <div><b>${ok?a.name:'???'}</b><div class="achv-d">${ok?a.desc:'미달성 — '+a.desc}</div></div></div>`;
  }).join('');
  const campRows=Object.keys(CAMPAIGNS).filter(c=>STATS.camps[c]&&STATS.camps[c].cleared)
    .map(c=>CAMPAIGNS[c].name).join(' · ')||'아직 완주한 캠페인이 없습니다';
  app().innerHTML=`<div id="achv-screen">
    <h2>기록 · 업적 <span style="font-size:14px;color:var(--gold2)">${done}/${ACHV.length}</span></h2>
    <div class="stat-box">
      <div class="stat-tile"><b>${STATS.wins||0}</b><span>전투 승리</span></div>
      <div class="stat-tile"><b>${STATS.kills||0}</b><span>적 격파</span></div>
      <div class="stat-tile"><b>${STATS.bosses||0}</b><span>보스 격파</span></div>
      <div class="stat-tile"><b>${STATS.crits||0}</b><span>필살</span></div>
      <div class="stat-tile"><b>${bestWave()}</b><span>무한 최고파</span></div>
    </div>
    <p style="color:var(--dim);font-size:12.5px;margin:6px 0 12px">완주 캠페인: <span style="color:var(--gold2)">${campRows}</span></p>
    <div class="achv-grid">${rows}</div>
    <div style="text-align:center;margin-top:14px"><button class="btn small" onclick="toTitle()">돌아가기</button></div>
  </div>`;
}
function showCampaignSelect(){
  app().innerHTML=`<div id="campsel">
    <h2>신규 캠페인 (베타)</h2>
    <p style="color:var(--dim);font-size:13px;margin-bottom:8px">분기 루트 · 아이템/장비 · 거점 상점 · 승급 시스템이 적용된 캠페인입니다. 클래식(19장)과 세이브가 분리됩니다.</p>
    ${campCard('sajo','제1권')}
    ${campCard('sinjo','제2권')}
    ${campCard('uicheon','제3권')}
    ${campCard('chunryong','천룡팔부')}
    ${campCard('hwasan','외전Ⅰ · 6막 완성판')}
    ${campCard('hooildam','외전Ⅱ')}
    <div class="camp-sep">해금 외전 <span style="font-size:12px;color:var(--dim)">— 본편·외전을 완주하면 열립니다</span></div>
    ${unlocked('wolnyeo')?campCard('wolnyeo','해금!'):lockedCard('wolnyeo')}
    ${unlocked('dokgo')?campCard('dokgo','해금!'):lockedCard('dokgo')}
    ${unlocked('hwalsa')?campCard('hwalsa','해금!'):lockedCard('hwalsa')}
    ${unlocked('pungreung')?campCard('pungreung','해금!'):lockedCard('pungreung')}
    ${unlocked('jinfinal')?campCard('jinfinal','진최종전 · 해금!'):lockedCard('jinfinal','진최종전')}
    <div style="text-align:center;margin-top:10px"><button class="btn small" onclick="toTitle()">돌아가기</button></div>
  </div>`;
}


/* ── 행낭(인벤토리) 모달 ── */
function invRowsHTML(){
  const eqBy={};
  for(const cid in (V2.equips||{})){
    const e=V2.equips[cid];
    for(const k of ['w','a']) if(e[k]) (eqBy[e[k]]=eqBy[e[k]]||[]).push(CHARS[cid].name);
  }
  const ids=[...new Set([...Object.keys(V2.inv),...Object.keys(eqBy)])];
  if(!ids.length) return `<tr><td colspan="2" style="color:var(--dim)">행낭이 비었습니다</td></tr>`;
  const kindName={weapon:'병기',acc:'보구',use:'영약',key:'비급'};
  return ids.map(id=>{
    const it=ITEMS[id];
    return `<tr><td style="text-align:left;white-space:nowrap"><b>${it.name}</b>${V2.inv[id]?` ×${V2.inv[id]}`:''}<div style="font-size:11px;color:var(--dim)">${kindName[it.kind]||''}</div></td>
      <td style="text-align:left;font-size:12.5px;color:var(--dim)">${it.desc}${eqBy[id]?`<br><span style="color:var(--gold2)">장착 중: ${eqBy[id].join(' · ')}</span>`:''}</td></tr>`;
  }).join('');
}
function openInvModal(){
  if(!V2) return;
  const html=`<div class="modal-back" id="inv-modal" onclick="if(event.target===this)this.remove()">
    <div class="modal"><h3>행낭 · 소지금 <span style="color:var(--gold2)">${V2.gold}냥</span></h3>
    <table class="camptable">${invRowsHTML()}</table>
    <div class="btnrow"><button class="btn" onclick="document.getElementById('inv-modal').remove()">닫기</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

/* ── 전투 중 장비 교체 (즉시 반영, 행동 미소모) ── */
function equipOpts(cid,k){
  const kind=k==='w'?'weapon':'acc';
  const eq=V2.equips[cid]=V2.equips[cid]||{w:null,a:null};
  let o=`<option value="">— 없음 —</option>`;
  for(const id in ITEMS){
    if(ITEMS[id].kind!==kind) continue;
    if(eq[k]===id) o+=`<option value="${id}" selected>${ITEMS[id].name} (장착 중)</option>`;
    else if((V2.inv[id]||0)>0) o+=`<option value="${id}">${ITEMS[id].name} ×${V2.inv[id]}</option>`;
  }
  return o;
}
function unitApplyItemDiff(u, oldIt, newIt){
  const d=k=>((newIt&&newIt[k])||0)-((oldIt&&oldIt[k])||0);
  u.eqAtk+=d('atk'); u.eqHit+=d('hit'); u.eqCrit+=d('crit');
  u.stats.def+=d('def'); u.stats.res+=d('res');
  u.stats.mov=Math.max(1,u.stats.mov+d('mov'));
  if(u.eqBonus){ u.eqBonus.def+=d('def'); u.eqBonus.res+=d('res'); u.eqBonus.mov+=d('mov'); u.eqBonus.hp+=d('hp'); }
  const dhp=d('hp');
  if(dhp){ u.maxhp+=dhp; u.stats.hp+=dhp; if(dhp>0) u.hp+=dhp; u.hp=Math.max(1,Math.min(u.maxhp,u.hp)); }
}
function openEquipModal(u){
  const html=`<div class="modal-back" id="eq-modal">
    <div class="modal"><h3>장비 교체 — ${u.name}</h3>
      <p style="font-size:12.5px;color:var(--dim);margin-bottom:8px">교체 즉시 능력치에 반영됩니다. (행동은 소모되지 않습니다)</p>
      <div style="margin:8px 0">병기 <select onchange="battleEquip('${u.cid}','w',this.value)">${equipOpts(u.cid,'w')}</select></div>
      <div style="margin:8px 0">보구 <select onchange="battleEquip('${u.cid}','a',this.value)">${equipOpts(u.cid,'a')}</select></div>
      <div style="font-size:12.5px;color:var(--gold2)">공격+${u.eqAtk} · 명중+${u.eqHit} · 필살+${u.eqCrit} · 방어 ${u.stats.def} · 정신 ${u.stats.res} · 이동 ${u.stats.mov} · HP ${u.hp}/${u.maxhp}</div>
      <div class="btnrow"><button class="btn" onclick="closeEquipModal()">닫기</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function closeEquipModal(){
  const m=document.getElementById('eq-modal'); if(m) m.remove();
  if(B&&B.sel) backToMenu();
}
function battleEquip(cid,slot,id){
  const u=B?B.units.find(x=>x.cid===cid&&x.alive):null;
  const eq=V2.equips[cid]=V2.equips[cid]||{w:null,a:null};
  const oldId=eq[slot]||null;
  if(oldId===(id||null)) return;
  if(oldId){ V2.inv[oldId]=(V2.inv[oldId]||0)+1; eq[slot]=null; }
  if(id){
    if((V2.inv[id]||0)<=0) return;
    V2.inv[id]--; if(V2.inv[id]<=0) delete V2.inv[id];
    eq[slot]=id;
  }
  if(u) unitApplyItemDiff(u, oldId?ITEMS[oldId]:null, id?ITEMS[id]:null);
  SFX.play('equip');
  v2Save();
  renderBattle(true);
  const m=document.getElementById('eq-modal');
  if(m&&u){ m.remove(); openEquipModal(u); }
}

/* ── 부팅 및 전역(인라인 onclick) 노출 ── */
export function boot(){
  buildPortraitDefs();
  showTitle();
}
/* 자동 테스트용 디버그 훅 (게임 로직에는 미사용) */
export const DEBUG = {
  get B(){ return B; },
  get V2(){ return V2; },
  get ENDLESS(){ return ENDLESS; },
  get G(){ return G; },
  winCheck(){ return checkEnd(); },
  calc(a,d,skill){ return calcStrike(a,d,skill); },
  adjBond(u){ return adjBond(u); },
  CHAPTERS, CHARS, SKILLS, ITEMS, SUPPORTS,
};

export const GLOBALS = {
  menuAct, confirmAttack, cancelForecast, endPlayerPhase, showHelp, confirmToTitle,
  uiCancel, cycleZoom, toggleDeploy, startBattle, newGame, continueGame,
  showChapterSelect, jumpChapter, startEndless, nextWave, toTitle, retryChapter, afterVictory,
  showCampaignSelect, startCampaignV2, showRouteMap, v2Enter, pickChoice,
  v2Buy, v2Sell, v2Equip, v2Promote, v2Depart, v2AfterBattle, v2UseTool, closeToolMenu,
  campTab, campBack, campFromDeploy, campFromRoute,
  openInvModal, closeEquipModal, battleEquip, sndToggleUI,
  toggleInfoPop, hideUcard, showSaveHub, hubContinue, saveHubResume, viewSupport,
  showSettings, setDiff, setSpeed, toggleFastEnemy,
  showAchievements, chooseNgPlus, ngStart,
  exportSave, triggerImport,
};
