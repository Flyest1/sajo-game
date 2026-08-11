import { TS, TILE, SKILLS, CHARS, CHAPTERS, ENDING, ENEMY_IDS, TYPE_NAME, triangle } from './data.js';
import { buildPortraitDefs, ptSVG, tileSVG, unitSVG, titleArtSVG, battleSceneHTML, premiumPortraitURL } from './gfx.js';
import { SFX, BGM, toggleSnd, sndOn } from './sfx.js';
import ITEMS from './data/items.json';
import SUPPORTS from './data/supports.json';
import { createCampaignRegistry, CAMPAIGN_META, CAMPAIGN_GROUPS, DISCOVERED_CAMPAIGN_IDS } from './campaigns.js';
import { createSessionRuntime } from './runtime.js';
import { initModalAccessibility, handleModalKeydown } from './ui-accessibility.js';
import { makeCampaignCheckpoint, appendCheckpoint, checkpointById } from './checkpoints.js';
import { loadMotion, killMotionTriggers } from './motion.js';
import { ROAM_RELICS, ROAM_NODE_META, buildRoamNodes, relicOffers, applyRelic, legendFor } from './roam.js';
import {
  LUNJIAN_HEROES, LUNJIAN_ROUNDS, LUNJIAN_BLESSINGS, TRIALS,
  makeLunjianBattle, makeTrialBattle, trialById, evaluateTrial, betterMedal,
} from './challenges.js';
import {
  INTERNALS, HERO_INTERNALS, internalOptions, defaultInternal, internalById, validInternal, internalEffectText,
  internalUnlockState, internalUnlocked, newlyUnlockedInternals,
} from './internals.js';
import {
  newlyUnlockedPromotions, promotionRequirementParts, promotionStatus,
} from './progression.js';
import {
  adjacentEnvironmentGates, advanceBattleEnvironment, createBattleEnvironment,
  damageEnvironmentGate, environmentBlocked, environmentEffectsAt, environmentSummary,
  resolveEnvironmentEffects,
} from './battle-environment.js';
import { applyBattleVariant } from './campaign-battles.js';
import { ENDGAME_SEALS, endgameProgress, syncEndgameRecord, endgameBlessing } from './endgame.js';
import { martialModifiers, enemyMartialCounter } from './combat-rules.js';
import { resolveBossImpact, resolveGuardHit, resolveHealthHit } from './combat-resolution.js';
import { chooseEnemyAction as resolveEnemyAction } from './enemy-ai.js';
import { ENEMY_MARTIALS, enemyMartialByCid, enemyMartialEffectText } from './enemy-martials.js';
import {
  advanceBossPlan, applyBossCounter, bossActionDefs as resolveBossActionDefs,
  bossIntentDescription, bossPlanHasTarget, bossPlanIntent, bossShapeLabel, createBossActionPlan,
  nextBossActionIndex,
} from './boss-actions.js';
import {
  objectiveLeaves as resolveObjectiveLeaves, objectiveTiles as resolveObjectiveTiles,
  objectiveProgress as resolveObjectiveProgress, objectiveWon as resolveObjectiveWon,
} from './battle-objectives.js';
import { bossPhaseDefs as resolveBossPhaseDefs, applyBossPhaseStats } from './boss-patterns.js';
import {
  bondRankWithReputation, reputationCombatEffects, shopPriceFor, lootMultiplier, reputationPerks,
  factionRelationTier, characterTrustTier, characterTrustEffects,
} from './reputation.js';
import {
  migrateLegacy, profileValue, setProfileValue, getCampaignSave, setCampaignSave,
  setLastSession, setEndlessBest, writeV3, createBackupPayload, inspectBackupPayload, restoreBackupPayload, validateV3,
} from './save.js';

let V3STORE = migrateLegacy();

/* ── 인연(지원) 시스템 ── */
function pairKey(a,b){ return a<b ? a+'_'+b : b+'_'+a; }
const SUPPORT_MAP = {};
for(const p of SUPPORTS.pairs) SUPPORT_MAP[pairKey(p.a,p.b)] = p;
const RANK_NAME = ['—','C','B','A'];
function bondRank(cidA,cidB){
  const key=pairKey(cidA,cidB);
  if(SESSION.isChallenge('trial')) return SUPPORT_MAP[key]?3:0;
  if(SESSION.isChallenge('lunjian')) return SUPPORT_MAP[key]?1:0;
  const campaign=SESSION.campaign();
  if(!campaign?.supports) return 0;
  const base=campaign.supports[key]||0;
  return bondRankWithReputation(base,campaign.reputation);
}
/* 유닛 u 기준, 인접 아군 중 최고 인연 랭크(0~3) */
function adjBond(u){
  if(!B||(!SESSION.isCampaign()&&!SESSION.isChallenge('trial')&&!SESSION.isChallenge('lunjian'))) return 0;
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

const G = { chapterIdx:0, roster:{}, party:[], snapshot:null, extraSkills:{}, internals:{}, deploy:null };
let B = null;       // 현재 전투 상태
const SESSION=createSessionRuntime({classic:G});
let uidSeq = 0;

function runtimeContext(){
  return SESSION.context(SETTINGS);
}

/* ── 설정(난이도·속도) ── */
const DIFFS = {
  story: { name:'이야기', enemy:0.85, exp:1.3, gold:1.2, desc:'적 능력 -15% · 경험치 +30% · 자금 +20% — 편하게 이야기를 감상' },
  std:   { name:'표준',   enemy:1.0,  exp:1.0, gold:1.0, desc:'균형 잡힌 기본 난이도' },
  hero:  { name:'협객',   enemy:1.15, exp:0.9, gold:0.7, desc:'적 능력 +15% · 경험치 -10% · 자금 -30% — 도전적인 강호' },
};
const SPEEDS = [1, 1.5, 2];
function loadSettings(){
  return Object.assign({diff:'std',speed:1,fastEnemy:false,reducedFx:false}, profileValue(V3STORE,'settings',{}));
}
let SETTINGS = loadSettings();
function saveSettings(){
  try{
    V3STORE=setProfileValue(V3STORE,'settings',SETTINGS);
    localStorage.setItem('kimyong_settings', JSON.stringify(SETTINGS));
  }catch(e){}
}
/* 현재 전투의 난이도(세이브에 고정) */
function curDiff(){
  const id = (B&&B.diff) || runtimeContext().difficulty;
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
let SKILL_USE = profileValue(V3STORE,'mastery',{});
function masteryTierForUses(n){
  let t=0; for(let i=MASTERY_STEPS.length-1;i>=0;i--){ if(n>=MASTERY_STEPS[i]){ t=i; break; } }
  return t;
}
function masteryTier(sid){ return masteryTierForUses(SKILL_USE[sid]||0); }
function masteryLabel(sid){ const t=masteryTier(sid); return t?('숙련 '+['','★','★★','★★★','極'][t]):''; }
/* 숙련 보정: 위력 배수 +0.04/단계, 명중 +2/단계, 기 소모 -1/2단계 */
function masteryMultBonus(sid){ return masteryTier(sid)*0.04; }
function masteryHitBonus(sid){ return masteryTier(sid)*2; }
function masteryCost(sid){ const sk=SKILLS[sid]; return Math.max(1, (sk.cost||0) - Math.floor(masteryTier(sid)/2)); }
function masteryInfo(sid, uses=SKILL_USE[sid]||0){
  const sk=SKILLS[sid], tier=masteryTierForUses(uses);
  const cost=Math.max(1,(sk.cost||0)-Math.floor(tier/2));
  return {tier,uses,power:sk.heal?0:tier*4,hit:sk.heal?0:tier*2,heal:sk.heal?tier:0,cost,costDown:Math.max(0,(sk.cost||0)-cost)};
}
function masteryEffectText(sid){
  const m=masteryInfo(sid), parts=[];
  if(m.power) parts.push(`위력 +${m.power}%p`,`명중 +${m.hit}`);
  if(m.heal) parts.push(`회복 +${m.heal}`);
  if(m.costDown) parts.push(`기 소모 -${m.costDown}`);
  return parts.length?parts.join(' · '):'현재 보정 없음';
}
function bumpMastery(sid){
  const before=masteryTier(sid);
  SKILL_USE[sid]=(SKILL_USE[sid]||0)+1;
  try{
    V3STORE=setProfileValue(V3STORE,'mastery',SKILL_USE);
    localStorage.setItem('kimyong_mastery', JSON.stringify(SKILL_USE));
  }catch(e){}
  const after=masteryTier(sid);
  if(after>=MASTERY_STEPS.length-1 && before<MASTERY_STEPS.length-1) unlockAchv('mastery_max');
  return after>before ? after : 0; // 상승한 새 단계(없으면 0)
}

/* ── 전적 통계 ── */
let STATS = Object.assign({wins:0,kills:0,bosses:0,crits:0,camps:{}}, profileValue(V3STORE,'stats',{}));
let BATTLE_REPORTS = Array.isArray(profileValue(V3STORE,'battleReports',[]))?profileValue(V3STORE,'battleReports',[]):[];
function saveStats(){
  try{
    V3STORE=setProfileValue(V3STORE,'stats',STATS);
    localStorage.setItem('kimyong_stats', JSON.stringify(STATS));
  }catch(e){}
}

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
  {id:'lunjian_clear', name:'천하논검 제패', desc:'천하논검 8관을 완주'},
  {id:'trial_first', name:'수수께끼의 해답', desc:'전투 수수께끼에서 첫 메달 획득'},
  {id:'trial_gold_all', name:'무결의 해법', desc:'전투 수수께끼 10개에서 모두 금메달 획득'},
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
let ACHV_DONE = profileValue(V3STORE,'achievements',{});
function unlockAchv(id){
  if(ACHV_DONE[id]) return;
  if(!ACHV.some(a=>a.id===id)) return;
  ACHV_DONE[id]=1;
  try{
    V3STORE=setProfileValue(V3STORE,'achievements',ACHV_DONE);
    localStorage.setItem('kimyong_achv', JSON.stringify(ACHV_DONE));
  }catch(e){}
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
  recordBattleReport();
  unlockAchv('first_win');
  if(B&&!B.allyLost) unlockAchv('flawless');
  if(B&&B.turn<=3) unlockAchv('swift');
  if(B&&B.treasures&&B.treasures.length&&B.treasures.every(t=>t.taken)) unlockAchv('treasure');
}

/* 현재 세션이 제공하는 전투 정의 반환 */
function curCh(){ return SESSION.currentBattle(CHAPTERS); }

/* 현재 맥락의 BGM 테마 (캠페인별 분위기) */
const BGM_THEME = { sajo:'heroic', sinjo:'heroic', uicheon:'heroic', chunryong:'chunryong',
  hwasan:'hwasan', hwalsa:'hwasan', wolnyeo:'heroic', dokgo:'gomyo', pungreung:'gomyo',
  hooildam:'heroic', jinfinal:'jinfinal' };
function bgmTheme(){
  const campaignId=SESSION.campaignValue('camp');
  if(campaignId) return BGM_THEME[campaignId]||'default';
  if(SESSION.isChallenge()) return 'jinfinal';
  return 'default';
}
function contributionRows(){
  if(!B)return [];
  return Object.values(B.contributions||{}).map(item=>({...item,name:CHARS[item.cid]?.name||item.cid,internalId:B.units.find(u=>u.team==='P'&&u.cid===item.cid)?.internalId||null,score:Math.round(item.damage+item.guard*2+item.healing+item.kills*12+item.bond*3+(item.counters||0)*4)})).sort((a,b)=>b.score-a.score);
}
function contributionHTML(){
  const rows=contributionRows();if(!rows.length)return '';
  return `<div class="contribution-box"><h3>전투 기여도</h3><div class="contribution-grid">${rows.map((item,i)=>`<div class="contribution-row ${i===0?'top':''}"><b>${i===0?'★ ':''}${item.name} <em>${item.score}</em></b><span>피해 ${item.damage} · 파훼 ${item.guard} · 간파 ${item.counters||0} · 회복 ${item.healing} · 격파 ${item.kills} · 협공 ${item.bond}</span><small>${internalById(item.internalId)?.name||'고유 심법 없음'}</small></div>`).join('')}</div></div>`;
}
function recordBattleReport(){
  if(!B)return;
  const ctx=runtimeContext(),ch=curCh(),members=contributionRows();
  BATTLE_REPORTS=[{at:Date.now(),mode:SESSION.outcome(),campaignId:ctx.campaignId,title:ch?.title||'전투',difficulty:ctx.difficulty,turn:B.turn,members},...BATTLE_REPORTS].slice(0,30);
  try{V3STORE=setProfileValue(V3STORE,'battleReports',BATTLE_REPORTS);}catch(e){}
}
function startBGM(mood){ BGM.start(mood, bgmTheme()); }

const app = () => document.getElementById('app');
async function animateTitleScreen(){
  if(SETTINGS.reducedFx) return;
  const {gsap}=await loadMotion(); if(!document.getElementById('title-screen')) return;
  gsap.fromTo('#title-art',{scale:.94,opacity:0},{scale:1,opacity:1,duration:1.05,ease:'power3.out'});
  gsap.fromTo('.title-main,.title-sub',{y:18,opacity:0},{y:0,opacity:1,duration:.72,stagger:.09,ease:'power2.out'});
  gsap.fromTo('.title-menu>div',{y:14,opacity:0},{y:0,opacity:1,duration:.55,stagger:.055,delay:.22,ease:'power2.out'});
}
async function animateChronicleScreen(){
  if(SETTINGS.reducedFx) return;
  const {gsap}=await loadMotion(); if(!document.querySelector('.chronicle-screen')) return;
  await killMotionTriggers('chronicle-');
  const copy=document.querySelector('.chronicle-head p');
  if(copy&&!copy.dataset.split){
    copy.dataset.split='1';
    copy.innerHTML=copy.textContent.split(/\s+/).map(w=>`<span class="reveal-word">${w}</span>`).join(' ');
    gsap.fromTo(copy.querySelectorAll('.reveal-word'),{opacity:.16},{opacity:1,stagger:.08,ease:'none',scrollTrigger:{id:'chronicle-copy',trigger:copy,start:'top 88%',end:'bottom 58%',scrub:true}});
  }
  const cards=[...document.querySelectorAll('.timeline-rail .camp-card')];
  cards.forEach((card,i)=>{
    card.style.zIndex=String(i+1);
    card.style.top=`${70+Math.min(i,5)*6}px`;
    gsap.fromTo(card,{y:28,scale:.975,opacity:.35},{y:0,scale:1,opacity:1,ease:'power2.out',scrollTrigger:{id:`chronicle-card-${i}`,trigger:card,start:'top 92%',end:'top 62%',scrub:.45}});
  });
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const deepClone = o => JSON.parse(JSON.stringify(o));
const escHtml = value => String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dist = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

function statObj(base){
  return {hp:base[0],str:base[1],int:base[2],def:base[3],res:base[4],spd:base[5],skl:base[6],mov:base[7],ki:base[8]};
}
function availableInternalOptions(cid){
  const options=internalOptions(cid),campaign=SESSION.campaign();if(!campaign)return options;
  return options.filter(id=>internalUnlocked(id,campaign));
}
function selectedInternal(cid){
  const campaign=SESSION.campaign(),challenge=SESSION.challenge();
  const selected=campaign?.internalLoadouts?.[cid]||challenge?.internals?.[cid]||G.internals?.[cid];
  const available=availableInternalOptions(cid);
  return available.includes(selected)?selected:(available[0]||null);
}
function applyInternalStats(stats,item){
  const bonus={};
  for(const [key,value] of Object.entries(item?.effects?.stats||{})){stats[key]=(stats[key]||0)+value;bonus[key]=value;}
  return bonus;
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
  const campaign=SESSION.campaign();
  const extra=(G.extraSkills&&G.extraSkills[cid]||[]).filter(s=>!c.skills.includes(s));
  const learned=[...c.skills,...extra];
  const loadout=(campaign?.skillLoadouts?.[cid]||[]).filter(s=>learned.includes(s));
  const stats=deepClone(r.stats),internalId=selectedInternal(cid),internal=internalById(internalId);
  const internalBonus=applyInternalStats(stats,internal);
  let eqAtk=0, eqHit=0, eqCrit=0;
  const eqBonus={def:0,res:0,mov:0,hp:0}; /* 능력치 표시용 장비 보정 분리 */
  if(campaign?.equips?.[cid]){
    for(const slot of ['w','a']){
      const it=campaign.equips[cid][slot]?ITEMS[campaign.equips[cid][slot]]:null;
      if(!it) continue;
      eqAtk+=it.atk||0; eqHit+=it.hit||0; eqCrit+=it.crit||0;
      stats.def+=it.def||0; stats.res+=it.res||0; stats.mov+=it.mov||0; stats.hp+=it.hp||0;
      eqBonus.def+=it.def||0; eqBonus.res+=it.res||0; eqBonus.mov+=it.mov||0; eqBonus.hp+=it.hp||0;
    }
  }
  const cls=campaign?.promoted?.[cid]||c.cls;
  const campaignDef=campaign&&CAMPAIGNS[campaign.camp];
  const isLd=campaignDef?.leader?(cid===campaignDef.leader):!!c.leader;
  return {uid:'u'+(uidSeq++), cid, name:c.name, cls, type:c.type, range:c.range,
    skills:(loadout.length?loadout:learned).slice(0,3), healer:!!c.healer, leader:isLd, team:'P',
    x, y, stats, maxhp:stats.hp, hp:stats.hp,
    maxki:stats.ki, ki:stats.ki, lvl:r.lvl, exp:r.exp, acted:false, alive:true, boss:false, poison:0,
    eqAtk, eqHit, eqCrit, eqBonus, internalId, internal, internalBonus, movedThisTurn:0, comboLast:null, comboCount:0};
}
function mkEnemyUnit(def){
  const c=CHARS[def.cid], st=statObj(c.base);
  const dm=curDiff().enemy;
  if(def.boost) for(const k in st) st[k]=Math.round(st[k]*def.boost);
  if(dm!==1) for(const k of ['hp','str','int','def','res']) st[k]=Math.max(1,Math.round(st[k]*dm));
  const guardMax=def.guard||(def.boss?Math.max(8,Math.round(st.hp*.28)):0);
  const martial=enemyMartialByCid(def.cid);
  return {uid:'u'+(uidSeq++), cid:def.cid, name:c.name, cls:c.cls, type:c.type, range:c.range,
    skills:c.skills, healer:false, leader:false, team:'E',
    x:def.x, y:def.y, stats:st, maxhp:st.hp, hp:st.hp, maxki:st.ki, ki:st.ki,
    lvl:curCh().no*3, exp:0, acted:false, alive:true,
    boss:!!def.boss, wait:def.wait||0, poison:0, martial,
    bossActions:Array.isArray(def.bossActions)?deepClone(def.bossActions):null,
    bossActionState:{index:0,pending:null,cooldown:0},bossStance:null,
    guardMax, guard:guardMax, broken:false, phaseIndex:0};
}

/* ── 그리드 헬퍼 ── */
const inb = (x,y) => B && x>=0 && y>=0 && x<B.w && y<B.h;
const tileChar = (x,y) => B.map[y][x];
const unitAt = (x,y) => B.units.find(u=>u.alive && u.x===x && u.y===y);
const players = () => B.units.filter(u=>u.team==='P'&&u.alive);
const foes    = () => B.units.filter(u=>u.team==='E'&&u.alive);
const environmentPassable = (x,y) => inb(x,y)&&TILE[tileChar(x,y)].cost<99;
const environmentDangerAt = (x,y) => environmentEffectsAt(B.environment,x,y).reduce((sum,item)=>sum+(item.damage||0)+(item.kiDrain||0)+(item.poison||0),0);

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
      if(environmentBlocked(B.environment,nx,ny)) continue;
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
function stoppable(u,x,y){ const o=unitAt(x,y); return !environmentBlocked(B.environment,x,y)&&(!o || o===u); }

/* ── 전투 계산 ── */
function adjAllies(u){
  if(!B) return 0;
  return Math.min(3, B.units.filter(o=>o.alive&&o!==u&&o.team===u.team&&dist(o,u)===1).length);
}
function adjEnemies(u){
  if(!B)return 0;
  return Math.min(4,B.units.filter(o=>o.alive&&o.team!==u.team&&dist(o,u)===1).length);
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
  const ae=(a.internal||a.martial)?.effects||{},de=(d.internal||d.martial)?.effects||{};
  const comboStep=sk&&a.comboLast&&a.comboLast!==skillId?Math.min(3,(a.comboCount||0)+1):0;
  let dmg=Math.max(0, Math.round(atk*((sk&&sk.mult?sk.mult:1)+mMult)) + tri*2 + supA + bA + (a.eqAtk||0) + (a.repAtk||0) + (a.trustAtk||0) - mit - dT.def - (d.repDef||0) - (d.trustDef||0));
  const mm=martialModifiers({attackerEffects:ae,defenderEffects:de,adjacentAttackers:supA,adjacentDefenders:supD,adjacentEnemies:adjEnemies(a),attackerMoved:a.movedThisTurn||0,attackerHpRatio:a.hp/a.maxhp,defenderHpRatio:d.hp/d.maxhp,defenderKiRatio:d.ki/d.maxki,defenderType:d.type,hasBond:bA>0,hasSkill:!!sk,comboStep});
  let internalMult=mm.attackMultiplier,reduction=mm.reduction;
  const martialCounter=d.team==='E'&&a.team==='P'?enemyMartialCounter(d.martial,{attackerType:a.type,adjacentAllies:supA,comboStep,defenderBroken:d.broken}):{active:false,reasons:[],mult:0,hit:0,guardDamage:0};
  dmg=Math.max(0,Math.round(dmg*internalMult*(1-reduction)*(1+(martialCounter.mult||0))));
  const guarded=d.guardMax>0&&d.guard>0;
  if(guarded) dmg=Math.max(1,Math.round(dmg*.65));
  else if(d.broken) dmg=Math.round(dmg*1.35);
  if(comboStep) dmg=Math.round(dmg*(1+comboStep*.08));
  const guardDmg=guarded?Math.max(1,1+(tri>0?2:0)+(sk?1:0)+Math.min(2,supA)+mm.guardDamage+(martialCounter.guardDamage||0)):0;
  const wHit=(B&&B.weather)?(WEATHER_HIT[B.weather]||0):0;
  let hit=Math.max(10,Math.min(100,
    82+a.stats.skl*2+tri*10+(sk&&sk.hit?sk.hit:0)+mHit+supA*4+bA*4-supD*3-bD*3+
    (a.eqHit||0)+(a.repHit||0)+(a.trustHit||0)-d.stats.spd*2-dT.avoid+wHit+
    mm.hit+(martialCounter.hit||0)
  ));
  let crit=Math.max(0, 4 + a.stats.skl - d.stats.skl + bA*2 + (a.eqCrit||0) + mm.crit);
  if(SESSION.isChallenge('trial')){ hit=100; crit=0; }
  const dbl=!sk && (a.stats.spd>=d.stats.spd+4);
  return {dmg,hit,crit,dbl,tri,supA,supD,bA,bD,mst,guarded,guardDmg,comboStep,internalMult,reduction,martialCounter};
}
function canCounter(d,a){ return d.alive && d.range.includes(dist(a,d)); }

/* ── 연출 ── */
function fx(x,y,txt,cls){
  const layer=document.getElementById('fx'); if(!layer) return;
  const el=document.createElement('div');
  el.className='dmgpop '+(cls||'damage');
  el.dataset.kind=cls||'damage';el.setAttribute('aria-label',String(txt));
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
  u.movedThisTurn=(u.movedThisTurn||0)+Math.abs(nx-ox)+Math.abs(ny-oy);
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
  if(SETTINGS.reducedFx) return;
  const layer=document.getElementById('fx'); if(!layer) return;
  const el=document.createElement('div');
  el.className='hitflash '+(cls||'');
  el.style.left=(x*TS+TS/2-24)+'px'; el.style.top=(y*TS+TS/2-26)+'px';
  layer.appendChild(el);
  setTimeout(()=>el.remove(),450);
}
function shakeMap(big){
  if(SETTINGS.reducedFx) return;
  const m=document.getElementById('mapsizer'); if(!m) return;
  m.classList.add('shake'); if(big) m.classList.add('big');
  setTimeout(()=>{ m.classList.remove('shake'); m.classList.remove('big'); },big?420:380);
}
function inkTrail(a,d,tone='basic',critical=false){
  const layer=document.getElementById('fx'); if(!layer||SETTINGS.reducedFx||!B) return;
  const w=B.w*TS,h=B.h*TS,x1=(a.x+.5)*TS,y1=(a.y+.5)*TS,x2=(d.x+.5)*TS,y2=(d.y+.5)*TS;
  const bend=((a.uid.length+d.uid.length)%2?1:-1)*Math.min(34,Math.max(12,dist(a,d)*5));
  const cx=(x1+x2)/2+bend,cy=(y1+y2)/2-bend*.45;
  const el=document.createElement('div');
  el.className=`ink-strike tone-${tone}${critical?' critical':''}`;
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path class="ink-core" d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}"/><path class="ink-edge" d="M${x1+3},${y1-2} Q${cx-5},${cy+4} ${x2-2},${y2+3}"/><circle cx="${x2}" cy="${y2}" r="${critical?12:7}" class="ink-bloom"/></svg>`;
  layer.appendChild(el);
  setTimeout(()=>el.remove(),critical?720:560);
}
async function showMartialCutin(a,sk,partner=null,headline=null){
  if(SETTINGS.reducedFx||!B||!sk) return;
  const host=document.getElementById('battlebody'); if(!host) return;
  const {gsap}=await loadMotion(); if(!B) return;
  const el=document.createElement('div');
  const tone=a.type==='외'?'force':(a.type==='경'?'swift':'inner');
  el.className=`martial-cutin tone-${tone}${partner?' joint':''}`;
  el.innerHTML=`<div class="cutin-ink"></div><div class="cutin-portraits">
    <div class="cutin-portrait main">${ptSVG(a.cid,'','awaken')}</div>
    ${partner?`<div class="cutin-portrait partner">${ptSVG(partner.cid,'','angry')}</div>`:''}
    </div><div class="cutin-copy"><small>${partner?`${a.name} · ${partner.name}`:a.name}</small><strong>${headline||sk.name}</strong><i>${partner?'合同奧義':'武功絶技'}</i></div><div class="cutin-stamp">${partner?'合':'武'}</div>`;
  host.appendChild(el);
  gsap.fromTo(el,{opacity:0},{opacity:1,duration:.12,ease:'power1.out'});
  gsap.fromTo(el.querySelector('.cutin-portraits'),{x:-46,scale:.9},{x:0,scale:1,duration:.36,ease:'power3.out'});
  gsap.fromTo(el.querySelector('.cutin-copy'),{x:54,opacity:0},{x:0,opacity:1,duration:.34,delay:.04,ease:'power3.out'});
  await aSleep(partner?620:500);
  if(el.isConnected){ gsap.to(el,{opacity:0,duration:.14}); setTimeout(()=>el.remove(),170); }
}
async function showBossReveal(u,title){
  if(SETTINGS.reducedFx||!u) return;
  const host=document.getElementById('battlebody'); if(!host) return;
  const {gsap}=await loadMotion(); if(!B) return;
  const el=document.createElement('div');
  el.className='boss-reveal';
  el.innerHTML=`<div class="boss-brush"></div><div class="boss-portrait">${ptSVG(u.cid,'','angry')}</div><div class="boss-copy"><small>强敵出現</small><strong>${u.name}</strong><span>${title||u.cls}</span></div><div class="boss-stamp">敵</div>`;
  host.appendChild(el);
  gsap.fromTo(el,{opacity:0},{opacity:1,duration:.16});
  gsap.fromTo(el.querySelector('.boss-portrait'),{x:60,scale:1.14},{x:0,scale:1,duration:.48,ease:'power3.out'});
  gsap.fromTo(el.querySelector('.boss-stamp'),{scale:2.4,rotation:12,opacity:0},{scale:1,rotation:-4,opacity:1,duration:.38,delay:.16,ease:'back.out(1.6)'});
  await aSleep(760);
  if(el.isConnected){ gsap.to(el,{opacity:0,duration:.16}); setTimeout(()=>el.remove(),190); }
}
function log(msg,imp){
  if(!B) return;
  B.log.unshift({msg,imp});
  if(B.log.length>40) B.log.pop();
  const el=document.getElementById('log');
  if(el) el.innerHTML=B.log.map(l=>`<div class="${l.imp?'imp':''}">${l.msg}</div>`).join('');
}
function contribution(u){
  if(!B||!u||u.team!=='P')return null;
  B.contributions=B.contributions||{};
  return B.contributions[u.cid]||(B.contributions[u.cid]={cid:u.cid,damage:0,guard:0,healing:0,taken:0,kills:0,bond:0,counters:0});
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
async function strike(a,d,skillId,followup,suppressCutin=false){
  const c=calcStrike(a,d,skillId);
  const sk=skillId?SKILLS[skillId]:null;
  if(sk&&!followup){
    a.ki-=(a.team==='P'?masteryCost(skillId):sk.cost);
    if(!suppressCutin) await showMartialCutin(a,sk,null,c.comboStep?`${sk.name} · ${c.comboStep}連`:null);
    fx(a.x,a.y,sk.name,'label'); SFX.play('skill');
    if(a.team==='P'){ const up=bumpMastery(skillId); if(up){ fx(a.x,a.y-0.4,'숙련 상승!','label'); SFX.play('levelup'); log(`<b>${a.name}</b>의 ${sk.name} — 숙련 ${['','★','★★','★★★','極'][up]} 단계 도달!`,true); } }
    if(c.comboStep){ a.comboCount=c.comboStep; fx(a.x,a.y,`연계 ${c.comboStep}`,'combo'); log(`${a.name} — 서로 다른 초식을 이은 <b>${c.comboStep}단 연계</b>!`,true); }
    else if(a.comboLast!==skillId) a.comboCount=0;
    a.comboLast=skillId;
    await aSleep(420);
  }
  const roll=Math.random()*100;
  await lunge(a,d);
  if(roll<c.hit){
    let dmg=c.dmg;
    const isCrit=Math.random()*100<c.crit;
    if(isCrit) dmg=Math.round(dmg*1.6);
    inkTrail(a,d,sk?a.type:'basic',isCrit);
    if(c.guarded){
      const gp=c.guardDmg+(isCrit?2:0);
      const guardHit=resolveGuardHit({guard:d.guard,guardMax:d.guardMax,broken:d.broken,damage:gp});
      d.guard=guardHit.guard;
      const meter=contribution(a);if(meter)meter.guard+=gp;
      fx(d.x,d.y,`강기 -${gp}`,'guard');
      if(guardHit.broke){
        if(a.team==='P'&&d.team==='E') B.guardBreaks=(B.guardBreaks||0)+1;
        if(a.team==='P'&&a.internal?.effects?.kiOnBreak)a.ki=Math.min(a.maxki,a.ki+a.internal.effects.kiOnBreak);
        const reward=c.martialCounter?.active?d.martial?.counter?.reward:null;
        if(a.team==='P'&&reward?.ki){a.ki=Math.min(a.maxki,a.ki+reward.ki);fx(a.x,a.y,`기+${reward.ki}`,'label');}
        d.broken=true; fx(d.x,d.y,'破 파훼!','break'); SFX.play('crit'); shakeMap(true);
        log(`<b>${d.name}의 호신강기가 무너졌다!</b>${reward?.ki?` ${a.name} 기력 +${reward.ki}.`:''} 남은 협객의 공격이 강해진다.`,true);
      }
    }
    const obj=activeObjective();
    const subdue=obj.type==='subdue'&&d.cid===obj.target&&a.team==='P';
    const floor=subdue?Math.max(1,Math.ceil(d.maxhp*(obj.threshold||.2))):0;
    const hpBefore=d.hp;
    const healthHit=resolveHealthHit({hp:d.hp,maxhp:d.maxhp,damage:dmg,floor});
    d.hp=healthHit.hp;
    const actualDamage=healthHit.damage,attackMeter=contribution(a),defendMeter=contribution(d);
    if(attackMeter){attackMeter.damage+=actualDamage;if(c.bA>0)attackMeter.bond++;}
    if(defendMeter)defendMeter.taken+=actualDamage;
    if(c.martialCounter?.active&&a.team==='P'){
      B.martialCounters=(B.martialCounters||0)+1;if(attackMeter)attackMeter.counters=(attackMeter.counters||0)+1;fx(d.x,d.y,'간파!','break');
      log(`<b>${a.name} — ${d.martial.name} 간파!</b> ${c.martialCounter.reasons.join('·')}`,true);
      const disrupted=disruptBossAction(d,c.martialCounter.reasons.join('·'));
      if(disrupted.changed){
        const result=disrupted.outcome==='cancel'?'초식 취소':'범위·위력 약화';
        fx(d.x,d.y,result,'phase');
        log(`<b>${d.name}의 ${disrupted.actionName} — ${result}!</b> 붉은 예고 범위가 갱신되었다.`,true);
        refreshEnemyIntents();
      }
    }
    const attackStyle=a.martial?.effects||{};
    if(a.team==='E'&&d.team==='P'&&attackStyle.kiDrain){const drained=Math.min(d.ki,attackStyle.kiDrain);d.ki-=drained;if(drained)fx(d.x,d.y,`기-${drained}`,'miss');}
    if(a.team==='E'&&d.team==='P'&&attackStyle.poisonOnSkill&&sk&&!d.poison){d.poison=3;fx(d.x,d.y,'중독!','label');log(`${a.name}의 ${a.martial.name}이(가) ${d.name}에게 독기를 남겼다.`,true);}
    if(a.team==='P'&&d.team==='E'&&d.hp>0&&d.martial?.effects?.reflect&&!c.martialCounter?.active&&!d.broken){
      const reflected=Math.min(Math.max(0,a.hp-1),Math.max(1,Math.round(actualDamage*d.martial.effects.reflect)));
      if(reflected){a.hp-=reflected;const meter=contribution(a);if(meter)meter.taken+=reflected;B.damageTaken=(B.damageTaken||0)+reflected;fx(a.x,a.y,`반사 ${reflected}`,'miss');log(`${d.name}의 <b>${d.martial.name}</b> — ${a.name}에게 ${reflected} 반사 피해`,true);}
    }
    if(d.team==='P') B.damageTaken=(B.damageTaken||0)+Math.max(0,hpBefore-d.hp);
    if(a.team==='P'&&c.bA>0) B.bondStrikes=(B.bondStrikes||0)+1;
    if(a.team==='P'&&a.internal?.effects?.kiOnHit)a.ki=Math.min(a.maxki,a.ki+a.internal.effects.kiOnHit);
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
    if(subdue&&d.hp<=floor){
      d.subdued=true; d.acted=true;
      B.subdues=(B.subdues||0)+1;
      fx(d.x,d.y,'제압!','break');
      log(`<b>${d.name}을(를) 살상하지 않고 제압했다.</b>`,true);
    }else if(d.hp<=0){
      d.alive=false;
      SFX.play('kill');
      fx(d.x,d.y,'격파!','label');
      if(d.team==='E'){
        grantExp(a, 30 + Math.max(0,(d.lvl-a.lvl))*4 + (d.boss?40:0));
        log(`<b>${d.name} 격파!</b>`,true);
        if(a.team==='P'){ STATS.kills++; if(d.boss) STATS.bosses++;
          B.enemyKills=(B.enemyKills||0)+1;
          const meter=contribution(a);if(meter)meter.kills++;
          if(STATS.kills>=50) unlockAchv('kills50'); if(STATS.kills>=200) unlockAchv('kills200');
          if(STATS.bosses>=10) unlockAchv('boss10'); saveStats(); }
      }else{
        if(B) B.allyLost=true;
        log(`<b>${d.name}이(가) 부상으로 이탈했다…</b>`,true);
      }
    }
    await applyBossPhase(d);
  }else{
    inkTrail(a,d,sk?a.type:'basic',false);
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

function bossPhaseDefs(u){
  const stageDefs=curCh().bossPhases;
  const hasStage=Array.isArray(stageDefs)&&stageDefs.some(phase=>!phase.target||phase.target===u.cid);
  return resolveBossPhaseDefs(u,hasStage?stageDefs:u.martial?.phases);
}
async function applyBossPhase(u){
  if(!u||!u.alive||!u.boss) return;
  const defs=bossPhaseDefs(u);
  while(u.phaseIndex<defs.length && u.hp/u.maxhp<=defs[u.phaseIndex].at){
    const p=defs[u.phaseIndex++];
    applyBossPhaseStats(u,p);
    await showBossReveal(u,p.name||'절기 변환');
    fx(u.x,u.y,p.name||'절기 변환','phase'); shakeMap(true);
    log(`<b>${u.name} — ${p.name||'절기 변환'}!</b> 초식과 기세가 달라졌다.`,true);
    await aSleep(420);
  }
}

/* ── 교전(공격+반격+추격) ── */
async function combat(a,d,skillId){
  B.busy=true;
  const pre=calcStrike(a,d,skillId);
  const skA=skillId?SKILLS[skillId]:null;
  await strike(a,d,skillId);
  if(checkEnd()) return;
  if(skillId&&a.team==='P'&&d.alive&&SESSION.isCampaign()){
    const partner=B.units.find(p=>p.team==='P'&&p.alive&&!p.acted&&p!==a&&dist(p,a)===1&&bondRank(a.cid,p.cid)>=3&&p.range.includes(dist(p,d))&&!B.joints[pairKey(a.cid,p.cid)]);
    if(partner){
      const sid=partner.skills.find(s=>!SKILLS[s].heal&&partner.ki>=masteryCost(s));
      if(sid){
        const key=pairKey(a.cid,partner.cid); B.joints[key]=true; partner.acted=true;
        fx(a.x,a.y,'合 합동오의','break'); log(`<b>${a.name} · ${partner.name} 합동 오의!</b>`,true);
        await showMartialCutin(a,SKILLS[sid],partner,'합동 오의');
        await strike(partner,d,sid,false,true);
        if(checkEnd()) return;
      }
    }
  }
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

/* ── R20 보스 범위 초식: 고정된 경고 타일을 그대로 판정 ── */
async function executeBossAction(u,execution){
  const action=execution.action,keys=new Set((execution.tiles||[]).map(value=>`${value.x},${value.y}`));
  const sid=action.skill&&SKILLS[action.skill]?action.skill:null,sk=sid?SKILLS[sid]:null;
  const targets=players().filter(target=>keys.has(`${target.x},${target.y}`));
  if(sk){
    u.ki=Math.max(0,u.ki-(sk.cost||0));
    await showMartialCutin(u,sk,null,action.name);
  }
  fx(u.x,u.y,action.name,'phase');SFX.play('skill');shakeMap(true);
  log(`<b>${u.name} — ${action.name} 발동!</b> ${bossShapeLabel(action.shape.type)} ${execution.tiles.length}칸을 덮친다.`,true);
  await aSleep(360);
  const hits=[];
  for(const target of targets){
    if(!target.alive)continue;
    const preview=calcStrike(u,target,sid),impact=resolveBossImpact({
      hp:target.hp,maxhp:target.maxhp,baseDamage:preview.dmg,power:action.power,
      hitChance:Math.min(100,preview.hit+action.hitBonus),hitRoll:Math.random()*100,
      critChance:preview.crit,critRoll:Math.random()*100,status:execution.status,
      counterDamageMultiplier:action.counter.damageMultiplier,
    });
    inkTrail(u,target,u.type,impact.crit);
    if(!impact.hit){
      fx(target.x,target.y,'회피!','miss');SFX.play('miss');
      log(`${target.name}이(가) ${action.name}의 예고 범위를 빠져나갔다.`);
      hits.push({uid:target.uid,hit:false,damage:0});
      continue;
    }
    const hpBefore=target.hp;target.hp=impact.hp;
    const defendMeter=contribution(target);if(defendMeter)defendMeter.taken+=impact.damage;
    B.damageTaken=(B.damageTaken||0)+impact.damage;
    const attackStyle=u.martial?.effects||{};
    if(attackStyle.kiDrain){const drained=Math.min(target.ki,attackStyle.kiDrain);target.ki-=drained;if(drained)fx(target.x,target.y,`기-${drained}`,'miss');}
    if(attackStyle.poisonOnSkill&&sid&&!target.poison&&target.hp>0){target.poison=3;fx(target.x,target.y,'중독!','label');}
    SFX.play(impact.crit?'crit':'hit');flashTile(target.x,target.y,impact.crit?'crit':'');
    fx(target.x,target.y,impact.damage,impact.crit?'crit':'');
    log(`${u.name}의 ${action.name} → ${target.name} ${impact.damage} 피해${execution.status==='weakened'?' (간파 약화)':''}`);
    hits.push({uid:target.uid,hit:true,damage:hpBefore-target.hp,crit:impact.crit});
    if(target.hp<=0){
      target.alive=false;B.allyLost=true;SFX.play('kill');fx(target.x,target.y,'격파!','label');
      log(`<b>${target.name}이(가) 부상으로 이탈했다…</b>`,true);
    }
    await aSleep(180);
  }
  if(!targets.length)log(`<b>${action.name} 불발!</b> 협객들이 예고 범위를 모두 벗어났다.`,true);
  u.bossActionState.lastExecution={planId:execution.id,actionId:action.id,status:execution.status,tiles:execution.tiles.map(value=>({...value})),hits};
  renderBattle(true);
  await aSleep(420);
  checkEnd();
}

async function performBossActionTurn(u){
  const state=u?.bossActionState,pending=state?.pending;
  if(!pending)return false;
  const actions=bossActionsFor(u),step=advanceBossPlan(pending);
  if(step.event==='cancelled'){
    state.pending=null;state.index=nextBossActionIndex(state.index,actions);u.bossStance=null;
    state.cooldown=pending.action.cooldown;
    state.lastExecution={planId:pending.id,actionId:pending.action.id,status:'cancelled',tiles:[],hits:[]};
    fx(u.x,u.y,'초식 취소','break');SFX.play('crit');
    log(`<b>${u.name}의 ${pending.action.name}이(가) 간파되어 끊겼다!</b> ${pending.counterReason||pending.action.counter.label}`,true);
    renderBattle(true);await aSleep(520);return true;
  }
  if(step.event==='charge'){
    state.pending=step.plan;u.bossStance=pending.action.charge.stance;
    const weakened=pending.status==='weakened'?' · 간파로 흐트러짐':'';
    fx(u.x,u.y,pending.action.charge.stance,'phase');
    log(`<b>${u.name} — ${pending.action.name} 축력!</b> ${pending.action.charge.label}${weakened}`,true);
    renderBattle(true);await aSleep(620);return true;
  }
  if(step.event==='execute'){
    state.pending=null;state.index=nextBossActionIndex(state.index,actions);u.bossStance=null;
    state.cooldown=step.execution.action.cooldown;
    await executeBossAction(u,step.execution);return true;
  }
  return false;
}

/* ── 치료 ── */
async function healAction(a,t,skillId){
  B.busy=true;
  const sid=skillId||a.skills[0];
  const sk=SKILLS[sid];
  a.ki-=(a.team==='P'?masteryCost(sid):sk.cost);
  const mstAmt=(a.team==='P')?masteryTier(sid):0;
  const amt=a.stats.int+sk.healPow+mstAmt;
  const before=t.hp;t.hp=Math.min(t.maxhp,t.hp+amt);
  const meter=contribution(a);if(meter)meter.healing+=t.hp-before;
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

/* ── 승패 판정: 모든 캠페인이 공유하는 목표 규칙 ── */
function activeObjective(){ const ch=curCh(); return (ch&&ch.objective)||ch.win||{type:'rout'}; }
function objectiveContext(pendingReinf=false){ return {units:B.units,turn:B.turn,pendingReinf}; }
function objectiveLeaves(o=activeObjective()){ return resolveObjectiveLeaves(o); }
function objectiveTiles(o){ return resolveObjectiveTiles(o); }
function objectiveProgress(o=activeObjective()){ return resolveObjectiveProgress(o,objectiveContext()); }
function objectiveWon(o=activeObjective(),pendingReinf=false){ return resolveObjectiveWon(o,objectiveContext(pendingReinf)); }
function checkEnd(){
  if(B.over) return true;
  const ch=curCh();
  const o=activeObjective();
  const leaderDown=ch.defeat?.type==='all'?false:B.units.some(u=>u.leader&&!u.alive);
  const protectDown=objectiveLeaves(o).flatMap(x=>x.protect||[]).some(cid=>B.units.some(u=>u.cid===cid&&!u.alive));
  if(leaderDown||protectDown||players().length===0){
    B.over=true; B.busy=true;
    setTimeout(()=>showDefeat(),800);
    return true;
  }
  const pendingReinf=(ch.reinforce||[]).some((r,i)=>!(B.reinfDone||[]).includes(i));
  const win=objectiveWon(o,pendingReinf);
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
    const sc=TILE[tileChar(x,y)].avoid + TILE[tileChar(x,y)].def*10 - environmentDangerAt(x,y)*8 - mr.get(k)*0.1;
    if(!best||sc>best.sc) best={x,y,sc};
  }
  return best;
}

/* ── 적 의도: 표시와 실제 AI가 동일한 평가 함수/고정 계획을 사용 ── */
function bossActionsFor(u){
  return resolveBossActionDefs(u,{
    stageActions:curCh()?.bossActions,
    unitActions:u.bossActions,
    martialActions:u.martial?.actions||u.martial?.bossActions,
  });
}
function ensureBossActionPlan(u){
  const actions=bossActionsFor(u);
  if(!actions.length)return null;
  u.bossActionState=u.bossActionState||{index:0,pending:null,cooldown:0};
  if(!u.bossActionState.pending){
    const index=u.bossActionState.index%actions.length;
    const candidate=createBossActionPlan({
      unit:u,action:actions[index],targets:players(),bounds:{w:B.w,h:B.h},turn:B.turn,sequence:index,
    });
    if(!bossPlanHasTarget(candidate,players()))return null;
    u.bossActionState.pending=candidate;
  }
  return u.bossActionState.pending;
}
function disruptBossAction(u,reason){
  const pending=u?.bossActionState?.pending;
  if(!pending)return {changed:false,outcome:'none',actionName:null};
  const result=applyBossCounter(pending,reason);
  u.bossActionState.pending=result.plan;
  return {...result,actionName:pending.action.name};
}
function chooseBossAction(u){
  /* 대기 중인 보스는 실제 각성 시점에 표적을 고정해야 초기 배치 칸을 향한 낡은 예고가 남지 않는다. */
  if(!u?.bossActionState?.pending&&u.wait&&u.hp===u.maxhp&&!players().some(player=>dist(player,u)<=u.wait))return null;
  if(!u?.bossActionState?.pending&&(u?.bossActionState?.cooldown||0)>0)return null;
  const plan=ensureBossActionPlan(u);
  return plan?bossPlanIntent(plan):null;
}
function chooseEnemyAction(u,{allowBoss=true}={}){
  if(allowBoss){
    const bossAction=chooseBossAction(u);
    if(bossAction)return bossAction;
  }
  const mr=moveRange(u);
  return resolveEnemyAction({
    unit:u,players:players(),moveTiles:mr,ranges:u.range,
    canStop:(x,y)=>stoppable(u,x,y),
    selectSkill:()=>u.skills.find(s=>!SKILLS[s].heal&&u.ki>=SKILLS[s].cost)||null,
    terrainAt:(x,y)=>TILE[tileChar(x,y)].avoid-environmentDangerAt(x,y)*8,
    previewStrike:(attacker,target,sid,position)=>{
      const preview=calcStrike(attacker,target,sid),dd=Math.abs(target.x-position.x)+Math.abs(target.y-position.y);
      if(target.range.includes(dd))preview.retaliation=calcStrike(target,attacker,null);
      return preview;
    },
  });
}
function refreshEnemyIntents(){
  if(!B) return;
  B.intents={};
  for(const e of foes()) B.intents[e.uid]=chooseEnemyAction(e);
}
function enemyIntent(u){ return B&&B.intents?B.intents[u.uid]:null; }
function intentText(u){
  const it=enemyIntent(u); if(!it) return '의도 미확인';
  const target=B.units.find(x=>x.uid===it.targetUid);
  if(it.bossAction)return bossIntentDescription(it,target?.name);
  const tactic=u.tactic?`${{hunter:'약자 추격',leader:'대장 압박',execute:'마무리 공세'}[u.tactic]||u.tactic} · `:'';
  const martial=u.martial?`${u.martial.name} · `:'';
  if(it.kind==='attack') return `${martial}${tactic}${it.sid?SKILLS[it.sid].name:'일반 공격'} → ${target?target.name:'목표'}${it.x!==u.x||it.y!==u.y?' · 이동 후':''}`;
  if(it.kind==='move') return `${martial}${target?target.name:'아군'}에게 접근`;
  return '대기';
}
function enemyThreatTiles(){
  const set=new Set();
  for(const e of foes()){
    const intent=enemyIntent(e);
    if(intent?.bossAction){for(const key of intent.warningKeys||[])set.add(key);continue;}
    const mr=moveRange(e), atk=attackTiles(e,mr);
    for(const k of atk) set.add(k);
  }
  return set;
}
function bossWarningIntents(){
  if(!B)return [];
  return foes().map(unit=>({unit,intent:enemyIntent(unit)})).filter(item=>item.intent?.bossAction);
}
function toggleThreats(){
  if(!B) return;
  B.showThreats=!B.showThreats;
  SFX.play('ui'); renderBattle();
}

function onTile(x,y){
  if(!B||B.over||B.phase!=='P') return;
  const u=unitAt(x,y);
  if(B.busy){
    if(B.queueInput&&u&&u.team==='P'&&!u.acted) B.queuedUnit=u.uid;
    return;
  }
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
  if(checkEnd()) return;
  if(!B.over && players().every(p=>p.acted)) setTimeout(endPlayerPhase,400);
}

/* ── 액션 메뉴 ── */
function openMenu(){
  const u=B.sel; hideMenu();
  if(!u||!u.alive||u.acted||B.phase!=='P') return;
  const campaign=SESSION.campaign();
  const enemiesNear=foes().filter(e=>u.range.includes(dist(u,e)));
  const gatesNear=adjacentEnvironmentGates(B.environment,u);
  let html='';
  if(enemiesNear.length) html+=`<button class="btn" onclick="menuAct('attack')">공격</button>`;
  u.skills.forEach((sid,i)=>{
    const sk=SKILLS[sid];
    const cost=masteryCost(sid), ml=masteryLabel(sid);
    const mlTxt=ml?` <span style="color:#e8c96a;font-size:11px">${ml}</span>`:'';
    const mstTitle=`${sk.desc} · ${masteryEffectText(sid)} · ${masteryProgress(sid)}`;
    if(u.ki<cost) return;
    if(sk.heal){
      const hurt=players().filter(p=>p!==u&&u.range.includes(dist(u,p))&&p.hp<p.maxhp);
      if(hurt.length) html+=`<button class="btn" title="${mstTitle}" onclick="menuAct('heal',${i})">${sk.name} <span style="color:#6ab0ce;font-size:12px">기${cost}</span>${mlTxt}</button>`;
    }else if(enemiesNear.length){
      html+=`<button class="btn" title="${mstTitle}" onclick="menuAct('skill',${i})">${sk.name} <span style="color:#6ab0ce;font-size:12px">기${cost}</span>${mlTxt}</button>`;
    }
  });
  if(campaign&&v2Usables().length){
    html+=`<button class="btn" onclick="menuAct('tool')">도구 <span style="color:#d9b36c;font-size:12px">${v2Usables().length}</span></button>`;
  }
  if(campaign){
    html+=`<button class="btn" onclick="menuAct('equip')">장비</button>`;
  }
  for(const gate of gatesNear)html+=`<button class="btn" onclick="menuAct('gate','${gate.id}')">${gate.label} 파괴 <span style="color:#d9b36c;font-size:12px">${gate.hp}/${gate.maxHp}</span></button>`;
  html+=`<button class="btn" onclick="menuAct('wait')">대기</button>`;
  html+=`<button class="btn" onclick="menuAct('cancel')">취소</button>`;
  const m=document.createElement('div');
  m.id='amenu'; m.setAttribute('role','menu'); m.setAttribute('aria-label',`${u.name} 행동`); m.innerHTML=html;
  document.body.appendChild(m);
  const token=document.getElementById(`ug-${u.uid}`), rect=token?.getBoundingClientRect();
  const menuW=Math.max(165,m.offsetWidth), menuH=Math.min(m.scrollHeight,window.innerHeight-16);
  let mx=(rect?.right||8)+6, my=(rect?.top||8)-10;
  if(mx+menuW>window.innerWidth-8) mx=Math.max(8,(rect?.left||window.innerWidth)-menuW-6);
  my=Math.max(8,Math.min(my,window.innerHeight-menuH-8));
  m.style.left=mx+'px'; m.style.top=my+'px';
}
function hideMenu(){ const m=document.getElementById('amenu'); if(m) m.remove(); }
function menuAct(act,idx){
  SFX.play('ui');
  const u=B.sel;
  if(act==='cancel'){ clearSel(); return; }
  if(act==='wait'){ hideMenu(); finishUnit(u); return; }
  if(act==='gate'){ breakEnvironmentGate(u,idx); return; }
  hideMenu();
  if(act==='tool'){ openToolMenu(u); return; }
  if(act==='equip'){ openEquipModal(u); return; }
  if(act==='attack'){ B.mode='target-attack'; B.skillIdx=null; B.targets=foes().filter(e=>u.range.includes(dist(u,e))); }
  if(act==='skill'){ B.mode='target-skill'; B.skillIdx=idx; B.targets=foes().filter(e=>u.range.includes(dist(u,e))); }
  if(act==='heal'){ B.mode='target-heal'; B.skillIdx=idx; B.targets=players().filter(p=>p!==u&&u.range.includes(dist(u,p))&&p.hp<p.maxhp); }
  renderBattle();
}

function breakEnvironmentGate(u,gateId){
  hideMenu();
  if(!u||!adjacentEnvironmentGates(B.environment,u).some(gate=>gate.id===gateId))return;
  const result=damageEnvironmentGate(B.environment,gateId,1);if(!result.changed)return;
  B.environment=result.environment;SFX.play(result.destroyed?'crit':'hit');
  fx(result.gate.x,result.gate.y,result.destroyed?'문 파괴!':`내구 ${result.gate.hp}`,'break');
  log(`${u.name}이(가) <b>${result.gate.label}</b>을(를) 공격했다.${result.destroyed?' 통로가 열렸다.':''}`,true);
  refreshEnemyIntents();finishUnit(u);
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
        <div class="val">${my.dmg}${my.dbl?' ×2':''}${my.guardDmg?` <small>· 강기 -${my.guardDmg}</small>`:''}${my.martialCounter?.active?` <small class="counter-preview">· 간파 ${my.martialCounter.reasons.join('·')}</small>`:''}</div><div class="lbl">위력</div><div class="val">${counter?`${counter.dmg}${counter.dbl?' ×2':''}`:'반격 불가'}</div>
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

function applyBattleEnvironmentRound(){
  if(!B?.environment)return [];
  B.environment=advanceBattleEnvironment(B.environment,{passable:environmentPassable});
  const effects=resolveEnvironmentEffects(B.environment,B.units,{passable:environmentPassable});
  for(const effect of effects){
    const unit=B.units.find(item=>item.uid===effect.uid&&item.alive);if(!unit)continue;
    if(effect.pushTo){const ox=unit.x,oy=unit.y;unit.x=effect.pushTo.x;unit.y=effect.pushTo.y;fx(unit.x,unit.y,'밀려남','miss');log(`${effect.label}에 휩쓸려 ${unit.name}이(가) 이동했다.`);}
    if(effect.kiDrain){const drained=Math.min(unit.ki,effect.kiDrain);unit.ki-=drained;if(drained)fx(unit.x,unit.y,`기-${drained}`,'miss');}
    if(effect.poison&&!unit.poison){unit.poison=effect.poison;fx(unit.x,unit.y,'중독!','label');}
    if(effect.damage){
      const before=unit.hp;unit.hp=Math.max(0,unit.hp-effect.damage);const taken=before-unit.hp;
      const meter=contribution(unit);if(meter)meter.taken+=taken;if(unit.team==='P')B.damageTaken=(B.damageTaken||0)+taken;
      fx(unit.x,unit.y,`${effect.label} ${taken}`,'miss');
      if(unit.hp<=0){unit.alive=false;if(unit.team==='P')B.allyLost=true;log(`<b>${unit.name}이(가) ${effect.label} 때문에 전장에서 이탈했다.</b>`,true);}
    }
  }
  if(effects.length)log(`<b>전장 변화</b> — ${effects.map(effect=>effect.label).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')}`,true);
  return effects;
}

/* ── 턴 진행 ── */
async function startPlayerPhase(first){
  if(B.over) return;
  B.queueInput=true;
  if(!first) B.turn++;
  const ch=curCh();
  /* 방어전: 규정 턴을 버티면 승리 */
  const objective=activeObjective();
  if(objective.type==='survive' && B.turn>objective.turns){
    B.over=true; B.busy=true;
    renderBattle();
    await banner('방어 성공!');
    if(!B) return;
    setTimeout(()=>showVictory(),500);
    return;
  }
  B.phase='P';
  for(const u of B.units.filter(u=>u.alive)){u.acted=false;u.movedThisTurn=0;}
  for(const p of players()){
    p.ki=Math.min(p.maxki,p.ki+4);
    const ie=p.internal?.effects||{};
    if(ie.turnKi)p.ki=Math.min(p.maxki,p.ki+ie.turnKi);
    if(ie.turnHeal&&p.hp<p.maxhp){
      const before=p.hp;p.hp=Math.min(p.maxhp,p.hp+ie.turnHeal);
      const meter=contribution(p);if(meter)meter.healing+=p.hp-before;
      fx(p.x,p.y,`+${p.hp-before}`,'heal');
    }
    const t=TILE[tileChar(p.x,p.y)];
    if(t.heal&&p.hp<p.maxhp){
      const amt=Math.ceil(p.maxhp*t.heal);
      p.hp=Math.min(p.maxhp,p.hp+amt);
      fx(p.x,p.y,'+'+amt,'heal');
    }
  }
  poisonTick('P');
  if(!first){applyBattleEnvironmentRound();if(checkEnd())return;}
  refreshEnemyIntents();
  renderBattle();
  await banner(`아군 페이즈 — ${B.turn}턴`);
  if(!B) return; /* 배너 대기 중 타이틀 이탈 가드 */
  B.busy=false;
  B.queueInput=false;
  const queued=B.units.find(u=>u.uid===B.queuedUnit&&u.alive&&u.team==='P'&&!u.acted);
  B.queuedUnit=null;
  if(queued) selectUnit(queued); else renderSide();
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
    const cooling=!!(!u.bossActionState?.pending&&(u.bossActionState?.cooldown||0)>0);
    const bossIntent=chooseBossAction(u);
    if(bossIntent){
      await performBossActionTurn(u);
      if(B.over)return;
    }else{
      const intent=chooseEnemyAction(u,{allowBoss:false});
      if(intent.kind==='attack'){
        const target=B.units.find(x=>x.uid===intent.targetUid&&x.alive);
        if(!target) continue;
        if(intent.x!==u.x||intent.y!==u.y){ const ox=u.x,oy=u.y; u.x=intent.x; u.y=intent.y; await animMove(u,ox,oy); }
        await combat(u,target,intent.sid);
        if(B.over) return;
      }else if(intent.kind==='move'&&(intent.x!==u.x||intent.y!==u.y)){
        const ox=u.x,oy=u.y; u.x=intent.x; u.y=intent.y; await animMove(u,ox,oy);
      }
      if(cooling)u.bossActionState.cooldown=Math.max(0,u.bossActionState.cooldown-1);
    }
    if(u.alive&&u.broken){ u.guard=u.guardMax; u.broken=false; log(`${u.name}이(가) 호흡을 가다듬어 호신강기를 되찾았다.`); }
  }
  if(B&&!B.over) startPlayerPhase(false);
}

/* ── 전투 시작 ── */
function applyReputationCombatEffects(){
  const campaign=SESSION.campaign();
  if(!campaign||!B) return [];
  const effects=reputationCombatEffects(campaign.reputation,campaign.factions);
  players().forEach(u=>{
    const trust=characterTrustEffects(campaign.trusts,u.cid);
    u.repDef=effects.repDef; u.repAtk=effects.repAtk; u.repHit=effects.repHit;
    u.trustDef=trust.trustDef; u.trustAtk=trust.trustAtk; u.trustHit=trust.trustHit;
  });
  const trusted=players().filter(u=>characterTrustTier(campaign.trusts?.[u.cid]||0).rank>=2);
  return [...effects.labels,...trusted.map(u=>`${u.name} 신뢰 · 명중 +3${u.trustAtk?'·공격 +1':''}${u.trustDef?'·방어 +1':''}`)];
}
function startBattle(){
  const ch=curCh();
  const ctx=runtimeContext();
  saveCampaignCheckpoint('battle',`${ch.title} · 전투 직전`);
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
    busy:true, over:false, log:[], pending:null, reinfDone:[], skillIdx:null, queuedUnit:null, queueInput:true,
    intents:{}, showThreats:true, joints:{},
    diff:ctx.difficulty,
    weather:pickWeather(),
    sceneSeed:strSeed(ctx.sceneKey),
    timeBase:pickBattleTime(),
    enemyKills:0,guardBreaks:0,bondStrikes:0,martialCounters:0,subdues:0,damageTaken:0,contributions:{},
    battleVariant:ch.battleVariant?deepClone(ch.battleVariant):null,
  };
  B.environment=createBattleEnvironment(ch.environment||{},{w:B.w,h:B.h});
  const cap=Math.min(ch.spawns.length,(ch.deploy&&ch.deploy.cap)||12);
  const lineup=(G.deploy&&G.deploy.length?G.deploy:G.party).filter(cid=>G.roster[cid]).slice(0,cap);
  lineup.forEach((cid,i)=>{
    const [x,y]=ch.spawns[i];
    const unit=mkPlayerUnit(cid,x,y);B.units.push(unit);contribution(unit);
  });
  B.treasures=deepClone(ch.treasures||[]);
  B.loot={gold:0,items:[]};
  const campaign=SESSION.campaign();
  if(campaign?.curBattle){ campaign.deploy=G.deploy.slice(); v2Save(); }
  for(const def of ch.enemies) B.units.push(mkEnemyUnit(def));
  B.reputationEffects=applyReputationCombatEffects();
  refreshEnemyIntents();
  startBGM('battle');
  renderScreenBattle();
  log(`<b>${ch.title}</b> — 승리 조건: ${activeObjective().text||ch.win.text}`,true);
  if(B.battleVariant)log(`<b>선택의 여파 · ${B.battleVariant.label}</b> — ${B.battleVariant.desc}`,true);
  const environmentLine=environmentSummary(B.environment);
  if(environmentLine.length)log(`<b>전장 환경</b> — ${environmentLine.join(' · ')}. 정보창과 지도 문양을 확인하십시오.`,true);
  const innerLine=players().filter(u=>u.internal).map(u=>`${u.name}·${u.internal.name}`).join(' / ');
  if(innerLine)log(`<b>심법 편성</b> — ${innerLine}`,true);
  const enemyStyles=foes().filter(u=>u.martial).map(u=>`${u.name}·${u.martial.name}`).filter((v,i,a)=>a.indexOf(v)===i).join(' / ');
  if(enemyStyles)log(`<b>적 무학 간파</b> — ${enemyStyles}`,true);
  if(B.reputationEffects.length) log(`<b>강호의 반향</b> — ${B.reputationEffects.join(' · ')}`,true);
  beginBattlePresentation();
}
async function beginBattlePresentation(){
  const boss=foes().find(u=>u.boss);
  if(boss) await showBossReveal(boss,boss.cls);
  if(B&&!B.over) startPlayerPhase(true);
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
  updateBattleParallax();
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
const TIME_NAME={dawn:'새벽',day:'한낮',dusk:'황혼',night:'밤'};
const TIME_ORDER=['dawn','day','dusk','night'];
function pickBattleTime(){
  const ch=curCh();
  if(ch&&TIME_ORDER.includes(ch.time)) return ch.time;
  if(ch&&ch.weather==='night') return 'night';
  const ctx=runtimeContext();
  const seed=strSeed(`${ctx.campaignId||ctx.mode}_${ctx.stageId}_time`);
  return TIME_ORDER[seed%3];
}
function currentBattleTime(){
  if(!B) return 'day';
  if(B.weather==='night') return 'night';
  const start=Math.max(0,TIME_ORDER.indexOf(B.timeBase));
  return TIME_ORDER[(start+Math.floor((B.turn-1)/3))%TIME_ORDER.length];
}
/* 스테이지 데이터의 weather 우선, 없으면 캠페인·시드로 자동 배정 */
function pickWeather(){
  const ch=curCh();
  if(ch&&ch.weather) return ch.weather;
  const ctx=runtimeContext(), camp=ctx.campaignId||'';
  const seed=strSeed(`${camp||ctx.mode}_${ctx.stageId}`);
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
  if(SETTINGS.reducedFx){ el.innerHTML=''; el.dataset.w='reduced'; return; }
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
function renderBattleAtmosphere(){
  const wrap=document.getElementById('mapwrap'),depth=document.getElementById('battle-depth'),wash=document.getElementById('timewash');
  if(!wrap||!B) return;
  const time=currentBattleTime();
  wrap.dataset.time=time;
  wrap.classList.toggle('reduced-fx',SETTINGS.reducedFx);
  const theme=curCh().sceneTheme||'jianghu';
  if(depth){depth.className=`time-${time} weather-${B.weather} theme-${theme}`;depth.dataset.theme=theme;}
  if(wash) wash.className=`time-${time}`;
  updateBattleParallax();
}
function updateBattleParallax(){
  const ms=document.getElementById('mapscroll'),depth=document.getElementById('battle-depth');
  if(!ms||!depth||SETTINGS.reducedFx) return;
  const sc=CURSCALE||1,x=ms.scrollLeft/sc,y=ms.scrollTop/sc;
  depth.style.setProperty('--far-x',`${x*.045}px`); depth.style.setProperty('--far-y',`${y*.025}px`);
  depth.style.setProperty('--mid-x',`${x*.075}px`); depth.style.setProperty('--mid-y',`${y*.04}px`);
  depth.style.setProperty('--near-x',`${x*.12}px`); depth.style.setProperty('--near-y',`${y*.065}px`);
}
function weatherLine(){ const w=(B&&B.weather)||'clear', time=currentBattleTime(), h=WEATHER_HIT[w]; return `날씨: <b>${WEATHER_NAME[w]}</b> · 시간: <b>${TIME_NAME[time]}</b>${h?` <span style="color:#e0a84a">명중 ${h}</span>`:''}`; }

const JOURNEY_STEPS=[['route','막 지도'],['camp','거점'],['deploy','출전'],['battle','전투'],['aftermath','전후']];
function journeyTrail(active){
  if(!SESSION.isCampaign()) return '';
  const current=Math.max(0,JOURNEY_STEPS.findIndex(([id])=>id===active));
  return `<nav class="journey-trail" aria-label="캠페인 진행 단계">${JOURNEY_STEPS.map(([id,label],i)=>
    `<span class="${i<current?'done':i===current?'current':''}" ${i===current?'aria-current="step"':''}>${i<current?'✓ ':''}${label}</span>`
  ).join('<i aria-hidden="true">›</i>')}</nav>`;
}

/* ── 전투 화면 골격 (전체 화면 + 오버레이 HUD) ── */
let UCARD_HIDE=false, INFO_OPEN=false;
function toggleInfoPop(){ INFO_OPEN=!INFO_OPEN; SFX.play('ui'); if(B) renderSide(); }
function hideUcard(){ UCARD_HIDE=true; if(B) renderSide(); }
function renderScreenBattle(){
  const mw=curCh().map[0].length*TS, mh=curCh().map.length*TS;
  UCARD_HIDE=false; INFO_OPEN=false;
  app().innerHTML=`
  <div id="battle" class="full">
    ${journeyTrail('battle')}
    <div id="topbar">
      <span id="tb-info"></span>
      <span style="flex:1"></span>
      ${SESSION.isCampaign()?`<button class="btn small" onclick="openInvModal()">행낭</button>`:''}
      <button class="btn small snd-btn" onclick="sndToggleUI()">${sndOn()?'♪':'∅'}</button>
      <button class="btn small" onclick="showSettings()">⚙</button>
      <button class="btn small desktop-battle-action" data-battle-action="cancel" onclick="uiCancel()">취소</button>
      <button class="btn small" onclick="cycleZoom()">배율 <span id="tb-zoom">${MAPZOOM===0?'자동':'×'+MAPZOOM}</span></button>
      <button class="btn small desktop-battle-action" data-battle-action="threat" onclick="toggleThreats()">위험 표시</button>
      <button class="btn small desktop-battle-action" data-battle-action="detail" onclick="toggleInfoPop()">정보</button>
      <button class="btn small desktop-battle-action" data-battle-action="end" onclick="endPlayerPhase()">턴 종료</button>
    </div>
    <div id="battlebody">
      <div id="mapscroll"><div id="mapsizer">
        <div id="mapwrap" style="width:${mw}px;height:${mh}px">
          <svg id="mapsvg" width="${mw}" height="${mh}"></svg>
          ${battleSceneHTML(mw,mh,B.weather,currentBattleTime(),B.sceneSeed,curCh().sceneTheme||'jianghu')}
          <div id="timewash" class="time-${currentBattleTime()}"></div>
          <div id="weather"></div>
          <div id="fx"></div>
          <div id="banner"></div>
        </div>
      </div></div>
      <div id="minimap" title="미니맵 — 클릭하면 그 위치로 이동"></div>
      <div id="boss-intent-hud" role="status" aria-live="polite" aria-atomic="true" hidden></div>
      <div id="ucard-pop" class="hidden"></div>
      <div id="info-pop" class="hidden"></div>
    </div>
    <nav id="battle-mobile-bar" aria-label="전투 빠른 행동">
      <button class="btn small" data-battle-action="cancel" onclick="uiCancel()">취소</button>
      <button class="btn small" data-battle-action="threat" onclick="toggleThreats()">위험 표시</button>
      <button class="btn small" data-battle-action="detail" onclick="toggleInfoPop()">정보</button>
      <button class="btn small danger" data-battle-action="end" onclick="endPlayerPhase()">턴 종료</button>
    </nav>
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
  ms.addEventListener('scroll',()=>{ renderMinimap(); updateBattleParallax(); });
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

function environmentOverlaySVG(){
  if(!B?.environment)return '';
  let s='';
  for(const hazard of B.environment.hazards)for(const tile of hazard.tiles){
    const px=tile.x*TS,py=tile.y*TS,label=escHtml(hazard.label);
    const mark=hazard.type==='fire'
      ?`<path d="M${px+15} ${py+40} C${px+8} ${py+29},${px+22} ${py+24},${px+20} ${py+12} C${px+35} ${py+22},${px+39} ${py+31},${px+31} ${py+40}Z"/>`
      :hazard.type==='poison'
        ?`<circle cx="${px+18}" cy="${py+29}" r="7"/><circle cx="${px+31}" cy="${py+22}" r="9"/><circle cx="${px+37}" cy="${py+34}" r="6"/>`
        :hazard.type==='current'
          ?`<path d="M${px+11} ${py+26} H${px+39} M${px+31} ${py+18} L${px+39} ${py+26} L${px+31} ${py+34}"/>`
          :`<path d="M${px+26} ${py+8} L${px+41} ${py+38} H${px+11}Z"/><path d="M${px+26} ${py+16} V${py+29} M${px+26} ${py+34} V${py+35}"/>`;
    s+=`<g class="environment-tile env-${hazard.type}" role="img" aria-label="${label}"><title>${label}</title><rect x="${px+3}" y="${py+3}" width="${TS-6}" height="${TS-6}" rx="6"/>${mark}</g>`;
  }
  for(const cliff of B.environment.cliffs){const px=cliff.x*TS,py=cliff.y*TS;s+=`<g class="environment-tile env-cliff" role="img" aria-label="절벽 · 진입 불가"><title>절벽 · 진입 불가</title><path d="M${px+7} ${py+12} L${px+20} ${py+42} L${px+27} ${py+23} L${px+36} ${py+42} L${px+45} ${py+10}"/></g>`;}
  for(const gate of B.environment.gates.filter(item=>item.hp>0)){const px=gate.x*TS,py=gate.y*TS;s+=`<g class="environment-gate" role="img" aria-label="${escHtml(gate.label)} 내구 ${gate.hp}/${gate.maxHp}"><title>${escHtml(gate.label)} · 인접 행동으로 파괴 · 내구 ${gate.hp}/${gate.maxHp}</title><rect x="${px+8}" y="${py+5}" width="${TS-16}" height="${TS-10}" rx="3"/><path d="M${px+14} ${py+8} V${py+43} M${px+26} ${py+8} V${py+43} M${px+38} ${py+8} V${py+43}"/><text x="${px+TS/2}" y="${py+TS-8}">${gate.hp}</text></g>`;}
  return s;
}

/* ── 전투 렌더 (svg + 사이드) ── */
function renderBattle(light){
  if(!B) return;
  const svg=document.getElementById('mapsvg');
  if(!svg) return;
  let s='';
  for(let y=0;y<B.h;y++) for(let x=0;x<B.w;x++) s+=tileSVG(tileChar(x,y),x,y);
  s+=environmentOverlaySVG();

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
  const objective=activeObjective();
  for(const part of objectiveLeaves(objective)) if(part.type==='seize'||part.type==='escape'){
    const col=part.type==='seize'?'rgba(220,176,54,.42)':'rgba(72,190,158,.4)';
    for(const t of objectiveTiles(part)) hl.push([t.x+','+t.y,col]);
  }
  if(B.showThreats&&B.phase==='P'){
    for(const k of enemyThreatTiles()) hl.push([k,'rgba(145,48,42,.17)']);
  }
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
  if(B.showThreats&&B.phase==='P')for(const {unit,intent} of bossWarningIntents()){
    const status=intent.status==='weakened'?'weakened':(intent.kind==='boss-execute'?'ready':'charging');
    const title=escHtml(`${unit.name} · ${intent.actionName} ${bossShapeLabel(intent.shape)} 공격 예고`);
    for(const warning of intent.warningTiles||[]){
      const px=warning.x*TS,py=warning.y*TS;
      s+=`<g class="boss-warning-tile ${status}" data-boss="${unit.uid}" data-action="${escHtml(intent.actionId)}" role="img" aria-label="${title}"><title>${title}</title><rect x="${px+3}" y="${py+3}" width="${TS-6}" height="${TS-6}" rx="5"/><path d="M${px+9} ${py+TS-9} L${px+TS-9} ${py+9}"/></g>`;
    }
  }
  if(B.tileSel&&!B.busy){
    s+=`<rect x="${B.tileSel.x*TS+1.5}" y="${B.tileSel.y*TS+1.5}" width="${TS-3}" height="${TS-3}" rx="4" fill="none" stroke="#f0d49a" stroke-width="2"/>`;
  }
  /* 유닛 (선택 유닛은 맨 위에) */
  for(const u of B.units.filter(u=>u.alive&&u!==B.sel)) s+=unitSVG(u);
  if(B.sel&&B.sel.alive) s+=unitSVG(B.sel,true);
  if(B.phase==='P'){
    for(const u of foes()){
      const it=enemyIntent(u), px=u.x*TS, py=u.y*TS;
      const kind=it?.bossAction?it.kind:(it&&it.kind==='attack'?(it.sid?'skill':'attack'):(it&&it.kind==='move'?'move':'wait'));
      const label=it?.bossAction
        ?`보스 공격 예고 · ${kind==='boss-cancelled'?'취소됨':(kind==='boss-execute'?'발동':'축력')} · ${it.actionName}`
        :{skill:'무공 공격 예고',attack:'일반 공격 예고',move:'이동 예고',wait:'대기 예고'}[kind];
      const cx=px+9,cy=py+9;
      const shape=kind==='boss-execute'
        ?`<path d="M${cx},${cy-5} L${cx+5},${cy+4} H${cx-5}Z"/><path d="M${cx},${cy-2} V${cy+1} M${cx},${cy+3} V${cy+3.2}"/>`
        :kind==='boss-charge'
          ?`<path d="M${cx-4},${cy-5} H${cx+4} M${cx-4},${cy+5} H${cx+4} M${cx-3},${cy-4} C${cx-3},${cy-1} ${cx+3},${cy+1} ${cx+3},${cy+4} M${cx+3},${cy-4} C${cx+3},${cy-1} ${cx-3},${cy+1} ${cx-3},${cy+4}"/>`
          :kind==='boss-cancelled'
            ?`<path d="M${cx-4},${cy-4} L${cx+4},${cy+4} M${cx+4},${cy-4} L${cx-4},${cy+4}"/>`
            :kind==='skill'
        ?`<path d="M${cx},${cy-5} L${cx+1.7},${cy-1.7} L${cx+5},${cy} L${cx+1.7},${cy+1.7} L${cx},${cy+5} L${cx-1.7},${cy+1.7} L${cx-5},${cy} L${cx-1.7},${cy-1.7}Z"/>`
        :kind==='attack'
          ?`<circle cx="${cx}" cy="${cy}" r="3.2"/><circle cx="${cx}" cy="${cy}" r=".9" fill="#ffd8c8" stroke="none"/><path d="M${cx},${cy-5} V${cy-3.2} M${cx},${cy+3.2} V${cy+5} M${cx-5},${cy} H${cx-3.2} M${cx+3.2},${cy} H${cx+5}"/>`
          :kind==='move'
            ?`<path d="M${cx-5},${cy} H${cx+4} M${cx+1},${cy-3} L${cx+4},${cy} L${cx+1},${cy+3}"/>`
            :`<circle cx="${cx}" cy="${cy}" r="1.7" fill="#ffd8c8" stroke="none"/>`;
      s+=`<g class="intent-mark" role="img" aria-label="${label}" pointer-events="none"><title>${label}</title><rect x="${px+1}" y="${py+1}" width="16" height="16" rx="4" fill="#20120f" stroke="#e07962" stroke-width="1.2"/><g fill="none" stroke="#ffd8c8" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">${shape}</g></g>`;
    }
  }
  svg.innerHTML=s;
  renderBattleAtmosphere();
  renderWeather();
  renderBossIntentHUD();
  renderSide();
}

function renderBossIntentHUD(){
  const el=document.getElementById('boss-intent-hud');if(!el||!B)return;
  const warnings=B.phase==='P'?bossWarningIntents():[];
  if(!warnings.length){el.hidden=true;el.innerHTML='';return;}
  const html=warnings.map(({unit,intent})=>{
    const state=intent.kind==='boss-cancelled'?'cancelled':(intent.status==='weakened'?'weakened':(intent.kind==='boss-execute'?'ready':'charging'));
    const badge=intent.kind==='boss-cancelled'?'간파 취소':(intent.kind==='boss-execute'?'발동 임박':'축력 중');
    const detail=intent.kind==='boss-cancelled'?intent.counterLabel:`${bossShapeLabel(intent.shape)} ${intent.warningTiles.length}칸${intent.status==='weakened'?' · 위력 약화':''}`;
    return `<div class="boss-intent-chip ${state}"><span>${badge}</span><b>${escHtml(unit.name)} · ${escHtml(intent.actionName)}</b><small>${escHtml(detail)}</small></div>`;
  }).join('');
  if(el.innerHTML!==html)el.innerHTML=html;
  el.hidden=false;
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
function bossPatternHTML(u){
  if(!u.boss) return '';
  const defs=bossPhaseDefs(u);
  if(!defs.length) return '';
  return `<div class="boss-pattern"><b>보스 패턴</b>${defs.map((p,i)=>`<span class="${i<u.phaseIndex?'spent':i===u.phaseIndex?'next':''}">${i<u.phaseIndex?'✓':Math.round(p.at*100)+'%'} ${p.name}</span>`).join('')}</div>`;
}
function terrLine(){
  if(!B.tileSel) return '';
  const T=TILE[tileChar(B.tileSel.x,B.tileSel.y)];
  const effects=environmentEffectsAt(B.environment,B.tileSel.x,B.tileSel.y).map(item=>item.label);
  const blocked=environmentBlocked(B.environment,B.tileSel.x,B.tileSel.y);
  return `지형: <b>${T.name}</b> — 회피 +${T.avoid} · 방어 +${T.def}${T.heal?' · 매턴 HP 회복':''}${blocked?' · 진입 불가':''}${effects.length?` · 환경: <b>${effects.join('·')}</b>`:''}`;
}
function ucardHTML(u){
  const hpPct=Math.round(u.hp/u.maxhp*100), kiPct=Math.round(u.ki/u.maxki*100);
  const portraitMood=hpPct<=30?'hurt':(u.broken||u.phaseIndex>0?'angry':'calm');
  return `
  <button class="pop-x" onclick="hideUcard()">×</button>
  <div class="uc-head">
    <div class="uc-pt ${u.team==='E'?'enemy':''}">${ptSVG(u.cid,'',portraitMood)}</div>
    <div style="flex:1">
      <div class="uc-name">${u.name}${u.boss?' ★':''}<span class="typebadge type-${u.type}">${TYPE_NAME[u.type]}</span></div>
      <div class="uc-sub">${u.cls} · Lv.${u.lvl}${u.team==='P'?` · EXP ${u.exp}`:''}${u.poison?` · <span style="color:#c07ae0">☠ 중독 ${u.poison}턴</span>`:''}</div>
      <div class="bar hp ${hpPct<=35?'low':''}"><i style="width:${hpPct}%"></i></div>
      <div class="uc-sub" style="display:flex;justify-content:space-between"><span>HP ${u.hp}/${u.maxhp}</span><span>기 ${u.ki}/${u.maxki}</span></div>
      <div class="bar ki"><i style="width:${kiPct}%"></i></div>
      ${u.guardMax?`<div class="uc-sub guard-label"><span>${u.broken?'破 파훼':'호신강기'}</span><span>${u.guard}/${u.guardMax}</span></div><div class="bar guard"><i style="width:${Math.round(u.guard/u.guardMax*100)}%"></i></div>`:''}
    </div>
  </div>
  <div class="uc-stats">
    ${statRow('힘',u.stats.str)}${statRow('내공',u.stats.int)}${statRow('기술',u.stats.skl)}
    ${statRow('방어',u.stats.def,u.eqBonus&&u.eqBonus.def)}${statRow('정신',u.stats.res,u.eqBonus&&u.eqBonus.res)}${statRow('속도',u.stats.spd)}
    ${statRow('이동',u.stats.mov,u.eqBonus&&u.eqBonus.mov)}${statRow('사거리',u.range.join('·'))}<div></div>
  </div>
  ${(u.eqAtk||u.eqHit||u.eqCrit)?`<div class="uc-sub" style="color:#8fce6a;margin-top:2px">병기 보정: ${[u.eqAtk?`공격 +${u.eqAtk}`:'',u.eqHit?`명중 +${u.eqHit}`:'',u.eqCrit?`필살 +${u.eqCrit}`:''].filter(Boolean).join(' · ')}</div>`:''}
  ${u.internal?`<div class="uc-internal"><b>${u.internal.kind} · ${u.internal.name}</b><span>${internalEffectText(u.internalId)}</span></div>`:''}
  ${u.martial?`<div class="uc-internal enemy-martial"><b>${u.martial.kind} · ${u.martial.name}</b><span>${enemyMartialEffectText(u.martial)}</span><small>행동: ${u.martial.tell}<br>파훼: ${u.martial.counter.text}</small></div>`:''}
  ${bossPatternHTML(u)}
  ${u.team==='E'?`<div class="intent-line ${enemyIntent(u)?.bossAction?'boss-intent':''}"><b>다음 의도</b><span>${intentText(u)}</span></div>`:''}
  ${u.skills.map(sid=>{const sk=SKILLS[sid];const ml=u.team==='P'?masteryLabel(sid):'';const cost=u.team==='P'?masteryCost(sid):sk.cost;const mp=u.team==='P'?masteryProgress(sid):'';const me=u.team==='P'?masteryEffectText(sid):'';return `<div class="uc-skill">◆ ${sk.name}${ml?` <span style="color:#e8c96a">${ml}</span>`:''} — ${sk.desc} (기 ${cost})${mp?`<br><span style="color:#c9a86a">${mp} · 실제 효과: ${me}</span>`:''}</div>`;}).join('')}
  <div class="uc-sub" style="margin-top:6px">${terrLine()}</div>`;
}
function infoHTML(ch){
  const objective=activeObjective(), progress=objectiveProgress(objective);
  const progressTxt=progress?`<div class="row"><span>목표 진행</span><b>${progress}</b></div>`:'';
  const environmentTxt=environmentSummary(B.environment);
  return `
  <button class="pop-x" onclick="toggleInfoPop()">×</button>
  <div class="ch-t">${ch.title}</div>
  <div class="row"><span>턴</span><b>${B.turn}</b></div>
  <div class="row"><span>페이즈</span><b>${B.phase==='P'?'아군':'적군'}</b></div>
  <div class="row"><span>승리</span><b>${objective.text||ch.win.text}</b></div>
  ${environmentTxt.length?`<div class="row"><span>전장 환경</span><b>${environmentTxt.join(' · ')}</b></div>`:''}
  ${progressTxt}
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
  const op=objectiveProgress(), surviveTop=op?` · 목표 ${op}`:'';
  const tbi=document.getElementById('tb-info');
  if(tbi) tbi.innerHTML=`${B.turn}턴 · ${B.phase==='P'?'아군':'<span style="color:#e09080">적군</span>'}${surviveTop} · 적 ${foes().length}`;
  document.querySelectorAll('[data-battle-action="end"]').forEach(el=>{ el.disabled=(B.phase!=='P'||B.busy); });
  document.querySelectorAll('[data-battle-action="threat"]').forEach(el=>{ el.textContent=B.showThreats?'위험 켜짐':'위험 꺼짐'; el.setAttribute('aria-pressed',String(B.showThreats)); });
  document.querySelectorAll('[data-battle-action="detail"]').forEach(el=>{ el.setAttribute('aria-pressed',String(INFO_OPEN)); });
  document.querySelectorAll('[data-battle-action="cancel"]').forEach(el=>{ el.disabled=(B.mode==='idle'&&!B.inspect); });
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
  const campaign=SESSION.campaign(), challenge=SESSION.challenge();
  if(campaign) return strSeed(campaign.camp+'_'+campaign.stageId);
  if(challenge) return strSeed('challenge'+(challenge.wave||challenge.pos||0));
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
  DLG={lines, idx:-1, done, titleCard, lastL:null, lastR:null, exprL:'calm', exprR:'calm'};
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
function dialogueExpression(line){
  if(['calm','angry','hurt','awaken','smile'].includes(line.expr)) return line.expr;
  const t=line.t||'';
  if(/웃|기쁘|고맙|반갑|행복|하하|후후/.test(t)) return 'smile';
  if(/부상|상처|죽음|잃|눈물|미안|슬프|통곡|절망/.test(t)) return 'hurt';
  if(/[!！]|원수|용서하지|끝내|막아|싸우|각오|명령/.test(t)) return 'angry';
  if(/깨달|완성|약속|지키|영웅|책임|선택/.test(t)) return 'awaken';
  return 'calm';
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
    const expression=dialogueExpression(L);
    if(L.side==='L'){ DLG.lastL=L.s; DLG.exprL=expression; } else { DLG.lastR=L.s; DLG.exprR=expression; }
  }
  pL.innerHTML=DLG.lastL?`<div class="dlg-pt L ${L.s!==DLG.lastL||L.s===null?'dimmed':''}" data-cid="${DLG.lastL}" data-expression="${DLG.exprL}">${ptSVG(DLG.lastL,'',DLG.exprL)}</div>`:'';
  pR.innerHTML=DLG.lastR?`<div class="dlg-pt R ${L.s!==DLG.lastR||L.s===null?'dimmed':''}" data-cid="${DLG.lastR}" data-expression="${DLG.exprR}">${ptSVG(DLG.lastR,'',DLG.exprR)}</div>`:'';
}

/* ── 챕터 진행 ── */
function startChapter(idx, skipPre){
  SESSION.useClassic();
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
  const requiredLeader=partyLeader();
  app().innerHTML=`<div id="deploy">
    ${journeyTrail('deploy')}
    <h2>${ch.title} — 출전 준비</h2>
    <div class="dep-sub">출전할 협객을 선택하세요 (<b id="dep-n">${G.deploy.length}</b>/${cap}명)${(()=>{
      const forcedIds=[...new Set([partyLeader(),...((ch.deploy&&ch.deploy.forced)||[])])].filter(c=>c&&G.party.includes(c));
      return forcedIds.length?` · ★필수 출전: ${forcedIds.map(c=>CHARS[c].name).join('·')}`:'';
    })()} · 승리 조건: ${ch.win.text}</div>
    <div class="dep-grid">${deployPool(ch).map(cid=>{
      const r=G.roster[cid], c=CHARS[cid], inner=internalById(selectedInternal(cid)), on=G.deploy.includes(cid), lock=cid===requiredLeader||!!(ch.deploy&&ch.deploy.forced&&ch.deploy.forced.includes(cid));
      return `<button type="button" class="dep-card ${on?'on':'off'} ${lock?'lock':''}" aria-pressed="${on}" ${lock?'disabled aria-label="'+c.name+' 필수 출전"':''} onclick="toggleDeploy('${cid}',${cap})">
        <div class="pt">${ptSVG(cid)}</div>
        <div class="dep-name">${c.name}${lock?' ★':''}</div>
        <div class="dep-info">Lv.${r.lvl} · ${TYPE_NAME[c.type]}</div>
        ${inner?`<div class="dep-inner">${inner.name}<small>${inner.role}</small></div>`:''}
      </button>`;}).join('')}</div>
    <div style="text-align:center">
      <button class="btn" onclick="startBattle()">출 전 !</button>
      ${SESSION.isCampaign()?`<button class="btn small" style="margin-left:8px" onclick="campFromDeploy()">거점 (장비·승급·상점)</button>`:''}
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
    const clean=deepClone(u.stats);
    for(const [key,value] of Object.entries(u.eqBonus||{}))clean[key]-=value||0;
    for(const [key,value] of Object.entries(u.internalBonus||{}))clean[key]-=value||0;
    r.lvl=u.lvl; r.exp=u.exp; r.stats=clean;
  }
}
/* 낙관(도장) 장식 */
function sealSVG(ch,color){
  return `<svg class="seal" viewBox="0 0 64 64" width="60" height="60" aria-hidden="true">
    <rect x="5" y="5" width="54" height="54" rx="7" fill="none" stroke="${color}" stroke-width="3.2" transform="rotate(-5 32 32)"/>
    <text x="32" y="45" text-anchor="middle" font-size="34" font-weight="900" fill="${color}" transform="rotate(-5 32 32)">${ch}</text>
  </svg>`;
}
function growthRewardsHTML(rewards=[],promotions=[]){
  if(!rewards.length&&!promotions.length)return '';
  const martialCards=rewards.map(({cid,id,item})=>`<article><div class="growth-portrait">${ptSVG(cid,'','awaken')}</div><div><small>${CHARS[cid]?.name||cid} · ${item.kind} · ${item.role}</small><h3>${item.name}</h3><p>${internalEffectText(id)}</p><em>${item.unlock?.label||'원작 사건 완료'}</em></div></article>`);
  const promotionCards=promotions.map(({cid,promo})=>`<article class="promotion-awaken"><div class="growth-portrait">${ptSVG(cid,'','awaken')}</div><div><small>${CHARS[cid]?.name||cid} · 승급 계기 개방</small><h3>${promo.cls}</h3><p>${promotionEffectText(promo)}</p><em>거점에서 Lv${promo.lvl} 달성 후 승급 가능</em></div></article>`);
  return `<section class="growth-rewards"><div class="growth-rewards-head"><span>成長</span><div><b>사건 성장</b><small>이번 이야기에서 새 무학 또는 승급의 계기가 열렸습니다</small></div></div><div class="growth-rewards-grid">${[...martialCards,...promotionCards].join('')}</div></section>`;
}
function showVictory(){
  const ch=curCh();
  const outcome=SESSION.outcome();
  const contribHtml=contributionHTML();
  applyRoster();
  SFX.play('victory'); startBGM('calm');
  recordBattleWin();
  if(outcome==='campaign'){
    const campaign=SESSION.campaign();
    const beforeGrowth=deepClone(campaign);
    /* reachedAny 사건도 첫 승리 보상에서 한 번만 드러내기 위해 현재 전투 도달은 완료 전 상태에서 제외한다. */
    beforeGrowth.stageId=null;
    const n=curNode();
    if(n.judge&&B){ /* 특정 유닛 생존 여부 → 플래그 */
      const ju=B.units.find(u=>u.team==='P'&&u.cid===n.judge.unit);
      if(ju&&ju.alive) campaign.flags[n.judge.set]=1;
    }
    const loot=(B&&B.loot)||{gold:0,items:[]};
    const gm=curDiff().gold*lootMultiplier(campaign.reputation);
    campaign.gold += Math.round(((n.goldReward||0) + (loot.gold||0))*gm);
    for(const id of (loot.items||[])) campaign.inv[id]=(campaign.inv[id]||0)+1;
    for(const id of (n.rewardItems||[])) campaign.inv[id]=(campaign.inv[id]||0)+1;
    let learnMsg='';
    for(const l of (n.learn||[])){
      campaign.extraSkills[l.cid]=campaign.extraSkills[l.cid]||[];
      if(!campaign.extraSkills[l.cid].includes(l.skill)&&!CHARS[l.cid].skills.includes(l.skill)){
        campaign.extraSkills[l.cid].push(l.skill);
        learnMsg+=`<br><b style="color:var(--gold2)">${CHARS[l.cid].name}</b>이(가) <b style="color:var(--gold2)">${SKILLS[l.skill].name}</b>을(를) 익혔다!`;
      }
    }
    if(!campaign.cleared.includes(campaign.stageId)) campaign.cleared.push(campaign.stageId);
    const growthRewards=newlyUnlockedInternals(beforeGrowth,campaign,campaign.party);
    const promotionRewards=newlyUnlockedPromotions(beforeGrowth,campaign,CHARS,campaign.party);
    campaign.curBattle=null;
    v2Save();
    const lootTxt=[
      n.goldReward?`보수 ${n.goldReward}냥`:'',
      loot.gold?`보물 ${loot.gold}냥`:'',
      ...(loot.items||[]).map(id=>ITEMS[id].name),
      ...(n.rewardItems||[]).map(id=>`전리품 ${ITEMS[id].name}`)
    ].filter(Boolean).join(' · ');
    app().innerHTML=`<div class="result-screen">
      ${journeyTrail('aftermath')}
      ${sealSVG('勝','#c0392e')}<h2 style="color:#ffd94a">勝 利</h2>
      <p>${n.title} — 클리어!${learnMsg}${lootTxt?`<br>획득: <b style="color:var(--gold2)">${lootTxt}</b>`:''}<br>소지금 ${campaign.gold}냥</p>
      ${growthRewardsHTML(growthRewards,promotionRewards)}
      ${contribHtml}
      <button class="btn" onclick="v2AfterBattle()">계속</button>
    </div>`;
    return;
  }
  if(outcome==='roam'){
    roamBattleWon();
    return;
  }
  if(outcome==='lunjian'){
    lunjianBattleWon();
    return;
  }
  if(outcome==='trial'){
    trialBattleWon();
    return;
  }
  if(outcome==='endless'){
    const w=SESSION.challengeValue('wave',1);
    setBestWave(w);
    if(w>=10) unlockAchv('endless10');
    if(w>=20) unlockAchv('endless20');
    app().innerHTML=`<div class="result-screen">
      <h2 style="color:#ffd94a">제${w}파 격퇴!</h2>
      <p>영웅들은 호흡을 가다듬는다. 다음 파도는 더욱 거세진다…<br>
      역대 최고 기록: <b style="color:var(--gold2)">${bestWave()}파</b></p>
      ${contribHtml}
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
    ${contribHtml}
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
  const outcome=SESSION.outcome();
  SFX.play('defeat'); startBGM('calm');
  if(outcome==='campaign'){
    SESSION.campaign().curBattle=null;
    app().innerHTML=`<div class="result-screen">
      ${sealSVG('敗','#6a7488')}<h2 style="color:#e07a5a">敗 北</h2>
      <p>${curNode().title} — 패배… 부대를 정비해 다시 도전하자.<br>(도구 소모는 유지되고, 경험치·전리품은 무효가 됩니다)</p>
      <button class="btn" onclick="v2Enter()">재도전</button>
      <button class="btn small" onclick="showRouteMap()">루트 맵</button>
      <button class="btn danger" onclick="toTitle()">타이틀로</button>
    </div>`;
    return;
  }
  if(outcome==='roam'){
    const challenge=SESSION.challenge();
    challenge.falls=(challenge.falls||0)+1;
    challenge.scars=[...new Set([...(challenge.scars||[]),...(B?.units||[]).filter(u=>u.team==='P'&&!u.alive).map(u=>u.cid)])];
    challenge.ch=null; saveRoam();
    app().innerHTML=`<div class="result-screen">${sealSVG('敗','#6a7488')}<h2 style="color:#e07a5a">유람 중 패배</h2><p>이 노드에 들어오기 전 기록에서 다시 도전할 수 있습니다.</p><button class="btn" onclick="enterRoamNode()">재도전</button><button class="btn danger" onclick="toTitle()">잠시 멈춤</button></div>`;
    return;
  }
  if(outcome==='lunjian'){
    const run=SESSION.challenge();run.ch=null;saveLunjian();
    app().innerHTML=`<div class="result-screen">${sealSVG('敗','#6a7488')}<h2 style="color:#e07a5a">논검 패배</h2><p>${run.round+1}관의 초식을 넘지 못했습니다.<br>관문 직전의 전력으로 다시 도전할 수 있습니다.</p><button class="btn" onclick="enterLunjianRound()">현재 관문 재도전</button><button class="btn small" onclick="showLunjianMap()">논검 지도</button><button class="btn danger" onclick="toTitle()">잠시 멈춤</button></div>`;
    return;
  }
  if(outcome==='trial'){
    const id=SESSION.challengeValue('id');
    app().innerHTML=`<div class="result-screen">${sealSVG('敗','#6a7488')}<h2 style="color:#e07a5a">해법 미완성</h2><p>배치를 다시 읽고 다른 순서로 초식을 이어 보십시오.</p><button class="btn" onclick="startTrial('${id}')">다시 풀기</button><button class="btn danger" onclick="showTrialSelect()">수수께끼 목록</button></div>`;
    return;
  }
  if(outcome==='endless'){
    const w=SESSION.challengeValue('wave',1);
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
function normalizeLastPlay(value){
  if(!value||typeof value!=='object') return null;
  const legacy={v2:'campaign',classic:'campaign',endless:'endless',roam:'roam',lunjian:'lunjian'};
  const mode=value.mode||legacy[value.k];
  if(!['campaign','endless','roam','lunjian'].includes(mode)) return null;
  const campaignId=value.campaignId||value.c||(value.k==='classic'?'chronicle':null);
  return {mode,campaignId:campaignId||null,at:Number(value.at||value.t)||Date.now()};
}
function markPlay(mode,campaignId){
  try{
    const last={mode,campaignId:campaignId||null,at:Date.now()};
    V3STORE=setLastSession(V3STORE,last);
    localStorage.setItem(LASTPLAY_KEY, JSON.stringify(last));
  }catch(e){}
}
function lastPlay(){ return normalizeLastPlay(V3STORE.lastSession); }
function recentSessionInfo(){
  const last=lastPlay(); if(!last) return null;
  if(last.mode==='campaign'){
    const id=last.campaignId;
    if(!id||!CAMPAIGNS[id]||!v2LoadSave(id)) return null;
    const source=CAMPAIGN_META[id]?.source;
    return {last,label:CAMPAIGNS[id].name,shortLabel:source&&source.length<=14?source:CAMPAIGNS[id].name,action:'이어하기'};
  }
  if(last.mode==='roam'&&V3STORE.challenges.roam?.current) return {last,label:'강호유람',shortLabel:'강호유람',action:'이어하기'};
  if(last.mode==='lunjian'&&V3STORE.challenges.lunjian?.current) return {last,label:'천하논검',shortLabel:'천하논검',action:'이어하기'};
  if(last.mode==='endless') return {last,label:'영웅집결 무한 모드',shortLabel:'영웅집결',action:'다시 도전'};
  return null;
}
function resumeLastSession(){
  const recent=recentSessionInfo();
  if(!recent){ showSaveHub(); return; }
  const {last}=recent;
  if(last.mode==='campaign') startCampaignV2(last.campaignId,true);
  else if(last.mode==='roam') resumeRoam();
  else if(last.mode==='lunjian') resumeLunjian();
  else startEndless();
}
function saveGame(nextCh){
  try{
    const prev=loadGame();
    const ch=Math.max(nextCh, prev?(prev.ch||0):0); /* 회상 재도전 시 진행도 후퇴 방지 */
    const state={ch, roster:G.roster, party:G.party, extra:G.extraSkills, deploy:G.deploy, diff:G.diff||'std'};
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    V3STORE.legacy.classicV1=deepClone(state);
    V3STORE=writeV3(V3STORE);
    markPlay('campaign','chronicle');
  }catch(e){}
}
/* ── 통합 세이브 허브 (클래식 v1 + 캠페인 v2 + 무한 모드) ── */
function saveHubResume(){
  const m=document.getElementById('hub-modal'); if(m) m.remove();
  resumeLastSession();
}
function hubContinue(kind,camp){
  const m=document.getElementById('hub-modal'); if(m) m.remove();
  if(kind==='campaign') startCampaignV2(camp,true);
  else if(kind==='roam') resumeRoam();
  else if(kind==='lunjian') resumeLunjian();
  else if(kind==='endless') startEndless();
}
function showSaveHub(){
  SFX.play('ui');
  const recent=recentSessionInfo();
  const rows=[];
  for(const id in CAMPAIGNS){
    const sv=v2LoadSave(id);
    if(!sv) continue;
    const done=sv.cleared&&sv.cleared.some(x=>String(x).startsWith('end'));
    const meta=CAMPAIGN_META[id]||{};
    rows.push(`<tr><td style="text-align:left"><b>${CAMPAIGNS[id].name}</b><div class="hub-sub">${meta.canon||''} · ${done?'완주':'진행 '+(sv.cleared?sv.cleared.length:0)+'단계'} · ${sv.gold||0}냥</div></td>
      <td><button class="btn small" onclick="hubContinue('campaign','${id}')">이어하기</button></td></tr>`);
  }
  const roam=V3STORE.challenges.roam||{};
  if(roam.current) rows.push(`<tr><td style="text-align:left"><b>강호유람</b><div class="hub-sub">시드 ${escHtml(roam.current.seed)} · ${roam.current.pos||0}/${roam.current.nodes?.length||10} 노드</div></td>
    <td><button class="btn small" onclick="hubContinue('roam')">이어하기</button></td></tr>`);
  const lunjian=V3STORE.challenges.lunjian||{};
  if(lunjian.current) rows.push(`<tr><td style="text-align:left"><b>천하논검</b><div class="hub-sub">${(lunjian.current.round||0)+1}/8관 · ${DIFFS[lunjian.current.diff]?.name||'표준'}</div></td><td><button class="btn small" onclick="hubContinue('lunjian')">이어하기</button></td></tr>`);
  if(bestWave()>0){
    rows.push(`<tr><td style="text-align:left"><b>영웅집결 무한 모드</b><div class="hub-sub">역대 최고 ${bestWave()}파</div></td>
      <td><button class="btn small" onclick="hubContinue('endless')">도전</button></td></tr>`);
  }
  const html=`<div class="modal-back" id="hub-modal" onclick="if(event.target===this)this.remove()">
    <div class="modal"><h3>이어하기 — 통합 기록</h3>
    ${recent?`<div class="hub-last"><span>최근 플레이: <b>${recent.label}</b></span><button class="btn small" onclick="saveHubResume()">${recent.action} ▶</button></div>`:''}
    ${rows.length?`<table class="camptable">${rows.join('')}</table>`:'<p style="color:var(--dim)">저장된 기록이 없습니다.</p>'}
    <div class="btnrow"><button class="btn" onclick="document.getElementById('hub-modal').remove()">닫기</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function showSaveHealth(){
  document.getElementById('set-modal')?.remove();
  const issues=V3STORE.quarantine?.issues||[];
  const checkpoints=V3STORE.checkpoints?.history||[];
  const issueRows=issues.map(issue=>`<div class="health-row"><div><b>${issue.path}</b><small>${issue.reason}</small></div><span class="health-badge warn">격리</span></div>`).join('');
  const checkpointRows=checkpoints.map(item=>`<div class="health-row"><div><b>${item.label}</b><small>${new Date(item.at).toLocaleString('ko-KR')} · ${item.kind}</small></div><button class="btn small" onclick="restoreCampaignCheckpoint('${item.id}')">복구</button></div>`).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="health-modal"><div class="modal save-health"><h3>저장 검사·복구</h3>
    <p class="modal-note">손상 구획은 게임에서 분리되어 있으며 백업 내보내기에 그대로 보존됩니다. 체크포인트 복구는 해당 캠페인의 현재 진행을 선택 시점으로 되돌립니다.</p>
    <h4>손상 격리 ${issues.length}건</h4><div class="health-list">${issueRows||'<p class="health-empty">격리된 손상 기록이 없습니다.</p>'}</div>
    <h4>자동 체크포인트 ${checkpoints.length}개</h4><div class="health-list">${checkpointRows||'<p class="health-empty">아직 생성된 체크포인트가 없습니다.</p>'}</div>
    <div class="btnrow"><button class="btn small" onclick="exportSave()">백업 내보내기</button><button class="btn" onclick="document.getElementById('health-modal').remove()">닫기</button></div>
  </div></div>`);
}
function restoreCampaignCheckpoint(id){
  const checkpoint=checkpointById(V3STORE,id); if(!checkpoint) return;
  if(!confirm(`${checkpoint.label} 상태로 돌아갈까요?\n현재 ${CAMPAIGNS[checkpoint.campaignId]?.name||checkpoint.campaignId} 진행은 덮어씁니다.`)) return;
  V3STORE=setCampaignSave(V3STORE,checkpoint.campaignId,checkpoint.state);
  localStorage.setItem(v2Key(checkpoint.campaignId),JSON.stringify(checkpoint.state));
  markPlay('campaign',checkpoint.campaignId);
  document.getElementById('health-modal')?.remove();
  startCampaignV2(checkpoint.campaignId,true);
}
function loadGame(){
  return V3STORE.legacy.classicV1||null;
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
function bestWave(){ return (V3STORE.challenges&&V3STORE.challenges.endless&&V3STORE.challenges.endless.bestWave)||0; }
function setBestWave(w){
  try{
    if(w>bestWave()){
      V3STORE=setEndlessBest(V3STORE,w);
      localStorage.setItem(ENDLESS_KEY,String(w));
    }
  }catch(e){}
}
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
    enemies, win:{type:'rout', text:`제${wave}파 전멸`}, lose:'전원 퇴각 시 패배', defeat:{type:'all'}, pre:[], post:[] };
}
function startEndless(){
  markPlay('endless');
  /* 전 영웅 집결: 스토리 진행과 무관하게 모든 아군을 Lv.10으로 소집 */
  SESSION.useClassic();
  G.chapterIdx=0; G.roster={}; G.party=[]; G.deploy=null;
  const allies=Object.keys(CHARS).filter(id=>!ENEMY_IDS.has(id)&&!CHARS[id].npc);
  for(const cid of allies) initRosterChar(cid);
  for(const cid of G.party){ const r=G.roster[cid]; for(let i=1;i<10;i++) rosterLevelUp(r); }
  G.extraSkills={gj:['jwauhobak'], jmk:['geongon']};
  nextWave(1);
}
function nextWave(w){
  SESSION.activateChallenge({wave:w, ch:makeEndlessWave(w), diff:SETTINGS.diff});
  showDeploy();
}

/* ── 강호유람: 12~15노드 시드형 원정 ── */
function seededRng(seed){ let a=strSeed(String(seed))||1; return ()=>{ a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296; }; }
function shuffleSeeded(arr,rng){ for(let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr; }
function roamNodes(seed){ return buildRoamNodes(seededRng(`${seed}:route`)); }
function normalizeRoam(run){
  run.boons=Array.isArray(run.boons)?run.boons:[];
  run.relics=Array.isArray(run.relics)?run.relics:[];
  run.coins=Number.isFinite(run.coins)?run.coins:6;
  run.factions=run.factions&&typeof run.factions==='object'?run.factions:{};
  run.scars=Array.isArray(run.scars)?run.scars:[];
  run.falls=Number.isFinite(run.falls)?run.falls:0;
  run.victories=Number.isFinite(run.victories)?run.victories:0;
  return run;
}
function saveRoam(){
  if(!SESSION.challengeState||SESSION.challengeState.mode!=='roam') return;
  normalizeRoam(SESSION.challengeState);
  markPlay('roam');
  const {ch,...run}=SESSION.challengeState;
  V3STORE.challenges.roam=V3STORE.challenges.roam||{};
  V3STORE.challenges.roam.current=deepClone({...run,roster:G.roster,party:G.party,extra:G.extraSkills,deploy:G.deploy});
  V3STORE=writeV3(V3STORE);
}
function showRoamStart(){
  const saved=V3STORE.challenges.roam&&V3STORE.challenges.roam.current;
  const legends=(V3STORE.challenges.roam&&V3STORE.challenges.roam.legends)||[];
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="roam-modal"><div class="modal"><h3>강호유람</h3><p class="modal-note">같은 시드는 같은 4인 후보·12~15개 노드·장터 물품을 만듭니다. 기연과 보물로 이번 원정만의 전투 빌드를 완성하세요.</p><input id="roam-seed" class="seed-input" maxlength="20" value="${new Date().toISOString().slice(0,10).replaceAll('-','')}" aria-label="시드 코드"><div class="btnrow"><button class="btn" onclick="startRoamFromInput()">새 유람</button>${saved?'<button class="btn" onclick="resumeRoam()">이어하기</button>':''}${legends.length?'<button class="btn" onclick="showRoamLegends()">강호전설</button>':''}<button class="btn danger" onclick="document.getElementById('roam-modal').remove()">취소</button></div></div></div>`);
}
function startRoamFromInput(){ const el=document.getElementById('roam-seed'); startRoam((el&&el.value)||Date.now().toString(36)); }
function startRoam(seed){
  const m=document.getElementById('roam-modal'); if(m)m.remove();
  B=null; SESSION.useClassic(); G.roster={};G.party=[];G.extraSkills={};G.deploy=null;
  const rng=seededRng(seed+':party');
  const allies=shuffleSeeded(Object.keys(CHARS).filter(id=>!ENEMY_IDS.has(id)&&!CHARS[id].npc),rng).slice(0,4);
  for(const cid of allies){ initRosterChar(cid); const r=G.roster[cid]; for(let i=1;i<8;i++) rosterLevelUp(r); }
  SESSION.activateChallenge({mode:'roam',seed:String(seed),pos:0,nodes:roamNodes(seed),boons:[],relics:[],coins:6,factions:{},scars:[],falls:0,victories:0,diff:SETTINGS.diff,ch:null});
  saveRoam(); showRoamMap();
}
function resumeRoam(){
  const s=V3STORE.challenges.roam&&V3STORE.challenges.roam.current; if(!s)return;
  const m=document.getElementById('roam-modal'); if(m)m.remove();
  const {roster,party,extra,deploy,...savedRun}=deepClone(s);
  B=null;SESSION.activateChallenge(normalizeRoam({mode:'roam',...savedRun,diff:s.diff||SETTINGS.diff,ch:null}));
  G.roster=deepClone(s.roster);G.party=deepClone(s.party);G.extraSkills=deepClone(s.extra||{});G.deploy=deepClone(s.deploy||null);
  showRoamMap();
}
function makeRoamBattle(pos,boss){
  const rng=seededRng(`${SESSION.challengeState.seed}:battle:${pos}`), base=CHAPTERS[ARENAS[pos%ARENAS.length]], W=base.map[0].length;
  const minions=['dj','msa','gs','sab','sap','mgb','mgs','ydg','gdb','gds','ssj','myg'];
  const elites=['jhp','hth','yjo','plh','stc','yjs','gwd','hnp'], bosses=['mcp','ygang','ogg','oyb','imsu','grb','hbo','njg','sgon','myb','gmj','jcc','yyh'];
  let cells=[];for(let y=0;y<base.map.length;y++)for(let x=Math.floor(W/2);x<W;x++)if(TILE[base.map[y][x]].cost<99&&base.spawns.every(s=>Math.abs(s[0]-x)+Math.abs(s[1]-y)>=3))cells.push([x,y]);
  shuffleSeeded(cells,rng);const enemies=[],count=5+Math.floor(pos*.55),boost=1+pos*.045;
  for(let i=0;i<count&&cells.length;i++){const pool=pos>3&&rng()<.35?elites:minions,[x,y]=cells.pop();enemies.push({cid:pool[Math.floor(rng()*pool.length)],x,y,boost});}
  if(boss&&cells.length){const [x,y]=cells.pop();enemies.push({cid:bosses[Math.floor(rng()*bosses.length)],x,y,boss:true,boost:boost+.18});}
  return {no:6+pos,title:boss?'강호유람 — 천하 고수':'강호유람 — 길 위의 습격',joins:[],map:base.map,spawns:base.spawns,enemies,win:{type:'rout',text:boss?'천하 고수와 수하 격파':'습격자 격파'},lose:'전원 퇴각 시 패배',defeat:{type:'all'},pre:[],post:[]};
}
function showRoamMap(){
  const run=normalizeRoam(SESSION.challengeState);
  const nodes=run.nodes.map((n,i)=>`<div class="roam-node ${i<run.pos?'done':i===run.pos?'cur':'lock'}"><i>${i<run.pos?'✓':i+1}</i><b>${ROAM_NODE_META[n]?.label||n}</b></div>`).join('<span class="roam-line"></span>');
  const type=run.nodes[run.pos], destination=ROAM_NODE_META[type]?.action||'계속';
  const relicText=run.relics.length?run.relics.map(id=>ROAM_RELICS[id]?.name).filter(Boolean).join(' · '):'아직 지닌 보물이 없습니다.';
  const factionText=Object.entries(run.factions).filter(([,v])=>v>0).map(([k,v])=>`${k} ${v}`).join(' · ')||'아직 인연을 맺은 문파가 없습니다.';
  app().innerHTML=`<div class="result-screen roam-screen"><div class="eyebrow">SEED ${escHtml(run.seed)}</div><h2>강호유람</h2><div class="roam-summary"><b>노정 ${run.pos}/${run.nodes.length}</b><b>엽전 ${run.coins}</b><b>승전 ${run.victories}</b></div><div class="roam-party">${G.party.map(cid=>`<span>${CHARS[cid].name} Lv.${G.roster[cid].lvl}</span>`).join('')}</div><div class="roam-path">${nodes}</div><div class="roam-build"><p><b>기연</b>${run.boons.join(' · ')||'없음'}</p><p><b>보물</b>${relicText}</p><p><b>문파</b>${factionText}</p></div><button class="btn" onclick="enterRoamNode()">${destination}</button><button class="btn danger" onclick="toTitle()">잠시 멈춤</button></div>`;
}
function enterRoamNode(){
  const type=SESSION.challengeState.nodes[SESSION.challengeState.pos];
  if(type==='battle'||type==='boss'){SESSION.challengeState.ch=makeRoamBattle(SESSION.challengeState.pos,type==='boss');saveRoam();showDeploy();return;}
  if(type==='camp'){
    app().innerHTML=`<div class="result-screen roam-event"><h2>客棧 객잔</h2><p>따뜻한 국물과 등불 아래, 다음 길을 준비한다.</p><button class="btn" onclick="roamChoice('train')">밤새 수련 — 전원 Lv.+1</button><button class="btn" onclick="roamChoice('rest')">운기조식 — 전원 최대 HP·기력 +3</button></div>`;
  }else if(type==='event'){
    app().innerHTML=`<div class="result-screen"><h2>奇緣 길 위의 기연</h2><p>낡은 비급 한 장과 묵직한 호신부가 놓여 있다. 하나만 취할 수 있다.</p><button class="btn" onclick="roamChoice('power')">비급 — 힘·내공 +2</button><button class="btn" onclick="roamChoice('guard')">호신부 — 방어·정신 +2</button></div>`;
  }else if(type==='shop') showRoamShop();
  else if(type==='faction') showRoamFaction();
}
function roamChoice(kind){
  const label={train:'수련',rest:'운기조식',power:'잔결 비급',guard:'호신부'}[kind];SESSION.challengeState.boons.push(label);
  for(const cid of G.party){const r=G.roster[cid];if(kind==='train')rosterLevelUp(r);if(kind==='rest'){r.stats.hp+=3;r.stats.ki+=3;}if(kind==='power'){r.stats.str+=2;r.stats.int+=2;}if(kind==='guard'){r.stats.def+=2;r.stats.res+=2;}}
  advanceRoamNode();
}
function currentRoamOffers(){
  const run=normalizeRoam(SESSION.challengeState);
  return relicOffers(seededRng(`${run.seed}:shop:${run.pos}`),run.relics);
}
function showRoamShop(){
  const run=normalizeRoam(SESSION.challengeState), offers=currentRoamOffers();
  const rows=offers.length?offers.map(id=>{const item=ROAM_RELICS[id];return `<button class="btn roam-shop-item" ${run.coins<item.cost?'disabled':''} onclick="roamBuyRelic('${id}')"><b>${item.name}</b><span>${item.desc}</span><em>엽전 ${item.cost}</em></button>`;}).join(''):'<p>이미 이 장터의 진귀한 물건을 모두 지녔습니다.</p>';
  app().innerHTML=`<div class="result-screen roam-event"><h2>市 장터의 기물상</h2><p>원정대의 엽전 <b>${run.coins}</b> · 구입한 보물은 네 협객 모두에게 즉시 적용됩니다.</p><div class="roam-shop">${rows}</div><button class="btn danger" onclick="advanceRoamNode()">장터를 떠난다</button></div>`;
}
function roamBuyRelic(id){
  const run=normalizeRoam(SESSION.challengeState), item=ROAM_RELICS[id];
  if(!item||run.relics.includes(id)||!currentRoamOffers().includes(id)||run.coins<item.cost) return;
  run.coins-=item.cost;run.relics.push(id);run.boons.push(item.name);
  for(const cid of G.party) applyRelic(G.roster[cid].stats,id);
  saveRoam();SFX.play('equip');showRoamShop();
}
function showRoamFaction(){
  const run=normalizeRoam(SESSION.challengeState), factions=['개방','전진교','명교','소요파'];
  const faction=factions[Math.floor(seededRng(`${run.seed}:faction:${run.pos}`)()*factions.length)];
  run.pendingFaction=faction;
  app().innerHTML=`<div class="result-screen roam-event"><h2>門 ${faction}의 청</h2><p>${faction} 문도들이 추격대에 포위되었다. 어느 방식으로 강호의 인연을 맺을 것인가?</p><button class="btn" onclick="roamFactionChoice('aid')">함께 지킨다 — 방어·정신 +1, 관계 +2</button><button class="btn" onclick="roamFactionChoice('duel')">무공으로 길을 연다 — 힘·내공 +1, 엽전 +2, 관계 +1</button></div>`;
}
function roamFactionChoice(kind){
  const run=normalizeRoam(SESSION.challengeState), faction=run.pendingFaction||'강호';
  run.factions[faction]=(run.factions[faction]||0)+(kind==='aid'?2:1);
  for(const cid of G.party){const st=G.roster[cid].stats;if(kind==='aid'){st.def++;st.res++;}else{st.str++;st.int++;}}
  if(kind==='duel') run.coins+=2;
  run.boons.push(`${faction} ${kind==='aid'?'수호':'논검'}`);delete run.pendingFaction;
  advanceRoamNode();
}
function advanceRoamNode(){
  SESSION.challengeState.pos++;saveRoam();showRoamMap();
}
function roamBattleWon(){
  const contrib=contributionHTML(),run=normalizeRoam(SESSION.challengeState), wasBoss=run.nodes[run.pos]==='boss';
  const fallen=(B?.units||[]).filter(u=>u.team==='P'&&!u.alive).map(u=>u.cid);
  run.scars=[...new Set([...run.scars,...fallen])];run.coins+=wasBoss?6:3;run.victories++;run.ch=null;run.pos++;
  if(run.pos>=run.nodes.length){
    const roam=V3STORE.challenges.roam=V3STORE.challenges.roam||{};
    const legends=G.party.map(cid=>legendFor(cid,CHARS[cid],run));
    roam.best=Math.max(roam.best||0,run.nodes.length);roam.legends=[...legends,...(roam.legends||[])].slice(0,40);delete roam.current;V3STORE=writeV3(V3STORE);
    app().innerHTML=`<div class="result-screen roam-finish">${sealSVG('遊','#d9b36c')}<h2>강호에 이름을 남기다</h2><p>시드 <b>${escHtml(run.seed)}</b>의 ${run.nodes.length}갈래 길을 완주했습니다.<br>네 협객의 별호와 여정이 강호전설에 기록되었습니다.</p><div class="legend-grid">${legends.map(x=>`<div class="legend-card"><b>${x.name}</b><strong>${x.title}</strong><span>${x.scar}</span></div>`).join('')}</div>${contrib}<button class="btn" onclick="showRoamLegends()">강호전설 보기</button><button class="btn" onclick="showChallengeSelect()">도전 목록</button></div>`;return;
  }
  saveRoam();app().innerHTML=`<div class="result-screen">${sealSVG('勝','#c0392e')}<h2>길을 열었다</h2><p>원정 ${run.pos}/${run.nodes.length} 노드를 통과했습니다.<br>전리품으로 엽전 ${wasBoss?6:3}을 얻었습니다.</p>${contrib}<button class="btn" onclick="showRoamMap()">다음 길</button></div>`;
}
function showRoamLegends(){
  const old=document.getElementById('roam-modal');if(old)old.remove();
  const legends=(V3STORE.challenges.roam&&V3STORE.challenges.roam.legends)||[];
  const rows=legends.length?legends.map(x=>`<div class="legend-row"><b>${x.name}</b><span>${x.title} · ${x.scar}</span><small>SEED ${escHtml(x.seed)} · ${x.nodes}노드 · ${(x.relics||[]).map(id=>ROAM_RELICS[id]?.name).filter(Boolean).join(' · ')||'무보물'}</small></div>`).join(''):'<p>아직 기록된 강호전설이 없습니다.</p>';
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="legend-modal"><div class="modal"><h3>강호전설</h3><div class="legend-list">${rows}</div><div class="btnrow"><button class="btn" onclick="document.getElementById('legend-modal').remove()">닫기</button></div></div></div>`);
}

/* ── 천하논검: 4인 편성·8관 연전 ── */
let LUNJIAN_PICK=['gj','yg','jmk','sb'];
let LUNJIAN_INTERNALS={};
function fixedChallengeRoster(ids,level){
  G.roster={};G.party=[];G.extraSkills={};G.deploy=null;
  const names=['hp','str','int','def','res','spd','skl'];
  for(const cid of ids){
    const c=CHARS[cid],stats=statObj(c.base),growth=c.grow?.length?c.grow:[60,40,40,40,40,40,40];
    names.forEach((name,i)=>{stats[name]+=Math.round((level-1)*(growth[i]||40)/100);});
    stats.ki+=level-1;
    G.roster[cid]={cid,lvl:level,exp:0,stats};G.party.push(cid);
  }
}
function lunjianStore(){
  V3STORE.challenges.lunjian=V3STORE.challenges.lunjian||{bestRound:0,clears:0,records:[]};
  return V3STORE.challenges.lunjian;
}
function saveLunjian(){
  const run=SESSION.challenge();if(!run||run.mode!=='lunjian')return;
  const {ch,...state}=run,store=lunjianStore();
  store.current=deepClone({...state,roster:G.roster,party:G.party,extra:G.extraSkills,deploy:G.deploy});
  V3STORE=writeV3(V3STORE);markPlay('lunjian');
}
function showLunjianStart(){
  const saved=lunjianStore().current;
  LUNJIAN_PICK=['gj','yg','jmk','sb'];
  LUNJIAN_INTERNALS=Object.fromEntries(LUNJIAN_HEROES.map(cid=>[cid,defaultInternal(cid)]));
  app().innerHTML=`<div id="campsel" class="chronicle-screen trial-screen"><div class="chronicle-head"><div><div class="eyebrow">天下論劍</div><h2>천하논검</h2><p>네 협객을 골라 여덟 관주의 호신강기와 전용 초식을 연속으로 파훼하십시오. 관문 사이에는 하나의 심법을 택해 부대를 강화합니다.</p></div><button class="btn small danger" onclick="showChallengeSelect()">도전 목록</button></div>
    ${saved?`<div class="challenge-resume"><b>진행 중인 논검 · ${saved.round+1}/8관</b><button class="btn" onclick="resumeLunjian()">이어하기</button></div>`:''}
    <div class="trial-rule"><span>편성 <b id="lj-count">${LUNJIAN_PICK.length}/4</b></span><span>난이도 <b>${curDiff().name}</b></span><span>전투마다 체력·기력 회복</span></div>
    <div class="lunjian-picks">${LUNJIAN_HEROES.map(cid=>`<button data-cid="${cid}" class="dep-card ${LUNJIAN_PICK.includes(cid)?'on':'off'}" aria-pressed="${LUNJIAN_PICK.includes(cid)}" onclick="toggleLunjianPick('${cid}')"><div class="pt">${ptSVG(cid)}</div><div class="dep-name">${CHARS[cid].name}</div><div class="dep-info">${TYPE_NAME[CHARS[cid].type]} · ${CHARS[cid].cls}</div><div class="dep-inner">${internalById(LUNJIAN_INTERNALS[cid]).name}<small>${internalById(LUNJIAN_INTERNALS[cid]).role}</small></div></button>`).join('')}</div>
    <div id="lj-internals" class="lunjian-internals">${lunjianInternalSelectors()}</div>
    <div class="btnrow"><button id="lj-start" class="btn" onclick="beginLunjian()">네 협객으로 시작</button></div></div>`;
}
function lunjianInternalSelectors(){
  return LUNJIAN_PICK.map(cid=>`<label><b>${CHARS[cid].name}</b><select aria-label="${CHARS[cid].name} 내공·특성" onchange="setLunjianInternal('${cid}',this.value)">${internalOptions(cid).map(id=>`<option value="${id}" ${LUNJIAN_INTERNALS[cid]===id?'selected':''}>${INTERNALS[id].name} · ${INTERNALS[id].role}</option>`).join('')}</select><small>${internalEffectText(LUNJIAN_INTERNALS[cid])}</small></label>`).join('');
}
function setLunjianInternal(cid,id){
  LUNJIAN_INTERNALS[cid]=validInternal(cid,id);const host=document.getElementById('lj-internals');if(host)host.innerHTML=lunjianInternalSelectors();
  const item=internalById(LUNJIAN_INTERNALS[cid]),card=document.querySelector(`.lunjian-picks [data-cid="${cid}"] .dep-inner`);if(card&&item)card.innerHTML=`${item.name}<small>${item.role}</small>`;
}
function toggleLunjianPick(cid){
  const i=LUNJIAN_PICK.indexOf(cid);
  if(i>=0)LUNJIAN_PICK.splice(i,1);else if(LUNJIAN_PICK.length<4)LUNJIAN_PICK.push(cid);
  document.querySelectorAll('.lunjian-picks .dep-card').forEach((card,index)=>{const on=LUNJIAN_PICK.includes(LUNJIAN_HEROES[index]);card.classList.toggle('on',on);card.classList.toggle('off',!on);card.setAttribute('aria-pressed',String(on));});
  const count=document.getElementById('lj-count');if(count)count.textContent=`${LUNJIAN_PICK.length}/4`;
  const start=document.getElementById('lj-start');if(start)start.disabled=LUNJIAN_PICK.length!==4;
  const host=document.getElementById('lj-internals');if(host)host.innerHTML=lunjianInternalSelectors();
}
function beginLunjian(){
  if(LUNJIAN_PICK.length!==4)return;
  B=null;fixedChallengeRoster(LUNJIAN_PICK,12);
  SESSION.activateChallenge({mode:'lunjian',round:0,totalTurns:0,blessings:[],internals:Object.fromEntries(LUNJIAN_PICK.map(cid=>[cid,validInternal(cid,LUNJIAN_INTERNALS[cid])])),diff:SETTINGS.diff,ch:null});
  saveLunjian();showLunjianMap();
}
function resumeLunjian(){
  const saved=lunjianStore().current;if(!saved)return showLunjianStart();
  const {roster,party,extra,deploy,...run}=deepClone(saved);
  B=null;SESSION.activateChallenge({...run,mode:'lunjian',ch:null});
  G.roster=roster;G.party=party;G.extraSkills=extra||{};G.deploy=deploy||null;
  showLunjianMap();
}
function showLunjianMap(){
  const run=SESSION.challenge(),store=lunjianStore();if(!run||run.mode!=='lunjian')return showLunjianStart();
  const nodes=LUNJIAN_ROUNDS.map((round,i)=>`<div class="gauntlet-node ${i<run.round?'done':i===run.round?'cur':'lock'}"><i>${i<run.round?'✓':i+1}</i><b>${CHARS[round.boss].name}</b><small>${round.title}</small></div>`).join('');
  const blessings=(run.blessings||[]).map(id=>LUNJIAN_BLESSINGS[id]?.name).filter(Boolean).join(' · ')||'아직 얻은 심법 없음';
  app().innerHTML=`<div class="result-screen gauntlet-screen"><div class="eyebrow">BEST ${store.bestRound||0}/8</div><h2>天下論劍 천하논검</h2><div class="gauntlet-party">${G.party.map(cid=>`<span>${CHARS[cid].name} Lv.${G.roster[cid].lvl}<small>${internalById(validInternal(cid,run.internals?.[cid]))?.name||''}</small></span>`).join('')}</div><div class="gauntlet-path">${nodes}</div><p class="gauntlet-bless"><b>누적 심법</b> ${blessings}</p><button class="btn" onclick="enterLunjianRound()">${run.round+1}관 출전 준비</button><button class="btn danger" onclick="saveLunjian();toTitle()">잠시 멈춤</button></div>`;
}
function enterLunjianRound(){
  const run=SESSION.challenge();if(!run||run.mode!=='lunjian')return;
  run.ch=makeLunjianBattle(run.round,CHAPTERS);G.deploy=[...G.party];saveLunjian();showDeploy();
}
function lunjianBattleWon(){
  const contrib=contributionHTML(),run=SESSION.challenge(),store=lunjianStore();
  run.totalTurns=(run.totalTurns||0)+B.turn;run.round++;run.ch=null;store.bestRound=Math.max(store.bestRound||0,run.round);
  if(run.round>=LUNJIAN_ROUNDS.length){
    store.clears=(store.clears||0)+1;
    const record={party:[...G.party],diff:run.diff,blessings:[...(run.blessings||[])],internals:{...(run.internals||{})},turns:run.totalTurns,at:Date.now()};
    const diffRank={story:1,std:2,hero:3};
    store.records=[record,...(store.records||[])].sort((a,b)=>(diffRank[b.diff]||0)-(diffRank[a.diff]||0)||(a.turns||999)-(b.turns||999)).slice(0,12);
    delete store.current;V3STORE=writeV3(V3STORE);syncEndgameStore();unlockAchv('lunjian_clear');
    app().innerHTML=`<div class="result-screen">${sealSVG('魁','#c0392e')}<h2>천하논검 제패</h2><p>여덟 관주의 초식을 모두 꿰뚫었습니다.<br>${G.party.map(cid=>CHARS[cid].name).join(' · ')}의 이름이 논검록에 남았습니다.</p>${contrib}<button class="btn" onclick="showLunjianRecords()">논검록</button><button class="btn" onclick="showChallengeSelect()">도전 목록</button></div>`;
    return;
  }
  saveLunjian();syncEndgameStore();
  app().innerHTML=`<div class="result-screen blessing-screen">${sealSVG('破','#c0392e')}<h2>${run.round}관 돌파</h2><p>다음 관문을 앞두고 하나의 심법을 새깁니다.</p>${contrib}<div class="blessing-grid">${Object.entries(LUNJIAN_BLESSINGS).map(([id,item])=>`<button class="btn blessing" onclick="lunjianChoose('${id}')"><b>${item.name}</b><span>${item.desc}</span></button>`).join('')}</div></div>`;
}
function lunjianChoose(id){
  const run=SESSION.challenge(),blessing=LUNJIAN_BLESSINGS[id];if(!run||!blessing)return;
  for(const cid of G.party)for(const [stat,value] of Object.entries(blessing.stats))G.roster[cid].stats[stat]+=value;
  run.blessings.push(id);saveLunjian();showLunjianMap();
}
function showLunjianRecords(){
  const records=lunjianStore().records||[];
  const rows=records.map((record,i)=>`<div class="legend-row"><b>#${i+1} ${record.party.map(cid=>CHARS[cid]?.name||cid).join('·')}</b><span>${DIFFS[record.diff]?.name||record.diff} · 총 ${record.turns}턴</span><small>${record.party.map(cid=>internalById(record.internals?.[cid])?.name).filter(Boolean).join(' · ')||'기본 심법'}<br>${(record.blessings||[]).map(id=>LUNJIAN_BLESSINGS[id]?.name).filter(Boolean).join(' · ')||'무심법'} · ${new Date(record.at).toLocaleDateString('ko-KR')}</small></div>`).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="lunjian-records"><div class="modal"><h3>천하 논검록</h3><div class="legend-list">${rows||'<p>아직 완주 기록이 없습니다.</p>'}</div><div class="btnrow"><button class="btn" onclick="document.getElementById('lunjian-records').remove()">닫기</button></div></div></div>`);
}

/* ── 전투 수수께끼: 고정 전력·결정론 전투·메달 ── */
const MEDAL_ICON={gold:'🥇',silver:'🥈',bronze:'🥉',none:'○'};
function trialStore(){V3STORE.challenges.trials=V3STORE.challenges.trials||{medals:{}};V3STORE.challenges.trials.medals=V3STORE.challenges.trials.medals||{};return V3STORE.challenges.trials;}
function showTrialSelect(){
  const medals=trialStore().medals;
  const gold=TRIALS.filter(trial=>medals[trial.id]==='gold').length;
  app().innerHTML=`<div id="campsel" class="chronicle-screen trial-screen"><div class="chronicle-head"><div><div class="eyebrow">武林謎題</div><h2>전투 수수께끼</h2><p>고정된 인물과 무공으로 목표를 해결합니다. 모든 명중은 확정되고 필살은 발생하지 않아 같은 선택은 같은 결과를 냅니다.</p></div><button class="btn small danger" onclick="showChallengeSelect()">도전 목록</button></div><div class="trial-rule"><span>금메달 <b>${gold}/${TRIALS.length}</b></span><span>고정 난이도 <b>표준</b></span><span>최고 메달 영구 저장</span></div><div class="trial-grid">${TRIALS.map((trial,i)=>{const medal=medals[trial.id]||'none';return `<button class="trial-card ${medal}" onclick="showTrialBrief('${trial.id}')"><i>${MEDAL_ICON[medal]}</i><div><small>${String(i+1).padStart(2,'0')} · ${trial.school}</small><b>${trial.title}</b><span>${trial.brief}</span><em>금 ${trial.goldText}</em></div></button>`;}).join('')}</div></div>`;
}
function showTrialBrief(id){
  const trial=trialById(id);if(!trial)return;
  app().innerHTML=`<div class="result-screen trial-brief"><div class="eyebrow">${trial.school} 試鍊</div><h2>${trial.title}</h2><p>${trial.brief}</p><div class="trial-party">${trial.party.map(cid=>`<span>${ptSVG(cid)}<b>${CHARS[cid].name}</b><small>${TYPE_NAME[CHARS[cid].type]}</small></span>`).join('')}</div><div class="medal-conditions"><div><b>🥇 금</b>${trial.goldText}</div><div><b>🥈 은</b>${trial.silverText}</div><div><b>🥉 동</b>승리</div></div><button class="btn" onclick="startTrial('${id}')">수수께끼 시작</button><button class="btn danger" onclick="showTrialSelect()">목록</button></div>`;
}
function startTrial(id){
  const trial=trialById(id);if(!trial)return;
  B=null;fixedChallengeRoster(trial.party,trial.level);
  SESSION.activateChallenge({mode:'trial',id,diff:'std',ch:makeTrialBattle(trial)});G.deploy=[...G.party];showDeploy();
}
function trialMetrics(){return {turn:B.turn,allyLost:!!B.allyLost,damageTaken:B.damageTaken||0,guardBreaks:B.guardBreaks||0,bondStrikes:B.bondStrikes||0,enemyKills:B.enemyKills||0,subdues:B.subdues||0};}
function trialBattleWon(){
  const contrib=contributionHTML(),run=SESSION.challenge(),trial=trialById(run.id),metrics=trialMetrics(),medal=evaluateTrial(trial,metrics),store=trialStore();
  store.medals[trial.id]=betterMedal(store.medals[trial.id],medal);V3STORE=writeV3(V3STORE);syncEndgameStore();unlockAchv('trial_first');
  if(TRIALS.every(item=>store.medals[item.id]==='gold'))unlockAchv('trial_gold_all');
  const next=TRIALS[TRIALS.findIndex(item=>item.id===trial.id)+1];
  app().innerHTML=`<div class="result-screen trial-result">${sealSVG(medal==='gold'?'金':medal==='silver'?'銀':'銅',medal==='gold'?'#d9b36c':medal==='silver'?'#aab3bd':'#a96b45')}<h2>${MEDAL_ICON[medal]} ${trial.title}</h2><p>${medal==='gold'?'완전한 해법입니다.':medal==='silver'?'빈틈을 줄이면 금의 해법에 닿습니다.':'해결했습니다. 이제 더 날카로운 해법에 도전할 수 있습니다.'}<br>완료 ${metrics.turn}턴 · 받은 피해 ${metrics.damageTaken} · 파훼 ${metrics.guardBreaks}회 · 협공 ${metrics.bondStrikes}회</p>${contrib}<button class="btn" onclick="startTrial('${trial.id}')">다시 풀기</button>${next?`<button class="btn" onclick="showTrialBrief('${next.id}')">다음 수수께끼</button>`:''}<button class="btn danger" onclick="showTrialSelect()">목록</button></div>`;
}

/* ── 타이틀 ── */
function toTitle(){ B=null; SESSION.clear(); showTitle(); }
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
    <div class="set-sec"><div class="set-h">저효과 모드</div>
      <div class="set-line"><button class="btn small ${SETTINGS.reducedFx?'on':''}" onclick="toggleReducedFx()">${SETTINGS.reducedFx?'켜짐 ✓':'꺼짐'}</button>
        <span style="color:var(--dim);font-size:12px">컷인·패럴랙스·날씨 입자·화면 흔들림을 줄입니다.</span></div></div>
    <div class="set-sec"><div class="set-h">세이브 백업</div>
      <div class="set-line">
        <button class="btn small" onclick="exportSave()">내보내기</button>
        <button class="btn small" onclick="triggerImport()">가져오기</button>
        <span style="color:var(--dim);font-size:11.5px">전 기록을 파일로 저장·복원 (기기 이동)</span></div></div>
    <div class="set-sec"><div class="set-h">저장 상태</div>
      <div class="set-line"><button class="btn small" onclick="showSaveHealth()">검사·복구</button>
        <span style="color:var(--dim);font-size:11.5px">격리 ${V3STORE.quarantine?.issues?.length||0}건 · 체크포인트 ${V3STORE.checkpoints?.history?.length||0}개</span></div></div>
    <div class="set-sec"><div class="set-h">앱 업데이트</div>
      <div class="set-line"><button class="btn small" onclick="window.__pwa?.checkForUpdate()">새 버전 검사</button><button class="btn small" onclick="window.__pwa?.repairPwaCache()">캐시 복구</button>
        <span style="color:var(--dim);font-size:11.5px">앱 캐시만 새로 받고 저장 기록은 유지</span></div></div>
    <div class="set-sec"><div class="set-h">조작 안내</div>
      <div style="color:var(--dim);font-size:12px;line-height:1.7">방향키/WASD 커서 · Enter/Space 선택·확정 · Esc 취소 · Tab 다음 유닛 · E 턴 종료 · I 정보 · Z 배율<br>게임패드: 방향패드 이동 · A 확정 · B 취소 · Start 턴 종료 · Y 다음 유닛</div></div>
    <div class="version-line">현재 버전 ${window.__pwa?.version||'local'} · 새 버전은 화면 아래 알림에서 적용</div>
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
function toggleReducedFx(){
  SETTINGS.reducedFx=!SETTINGS.reducedFx; saveSettings(); SFX.play('ui');
  if(SETTINGS.reducedFx) void killMotionTriggers();
  if(B){ renderBattleAtmosphere(); renderWeather(); }
  const m=document.getElementById('set-modal'); if(m) m.remove(); showSettings();
}
function showTitle(){
  startBGM('calm');
  const hasAny=Object.keys(CAMPAIGNS).some(id=>v2LoadSave(id)) || bestWave()>0;
  const recent=recentSessionInfo();
  app().innerHTML=`<div id="title-screen">
    ${titleArtSVG()}
    <div class="title-main">사조영웅전<span style="font-size:24px;color:var(--dim)"> ─ </span>강호의 별</div>
    <div class="title-sub">江湖의 별 · v3 통합판</div>
    <div class="title-menu">
      <div><button class="btn primary" onclick="showCampaignSelect('chronicles')">강호연대기 <span>정식 본편</span></button></div>
      <div><button class="btn resume-btn" onclick="resumeLastSession()" ${recent?'':'disabled'}>${recent?`${recent.action} · ${recent.shortLabel}`:'이어할 여정 없음'} <span>최근 여정</span></button></div>
      <div><button class="btn" onclick="showCampaignSelect('legends')">강호외전 <span>단편·창작</span></button></div>
      <div><button class="btn" onclick="showChallengeSelect()">도전과 회상 <span>무한·19전</span></button></div>
      <div><button class="btn" onclick="showSaveHub()" ${hasAny||V3STORE.challenges.roam?.current||recent?'':'disabled'}>모든 기록 <span>통합 세이브</span></button></div>
      <div><button class="btn" onclick="showAchievements()">기록 · 업적 <span style="font-size:12px;color:var(--gold2)">${ACHV.filter(a=>ACHV_DONE[a.id]).length}/${ACHV.length}</span></button></div>
      <div><button class="btn" onclick="showHelp()">유파 안내 (도움말)</button></div>
      <div><button class="btn" onclick="showSettings()">설정 <span style="font-size:12px;color:var(--dim)">난이도 ${DIFFS[SETTINGS.diff].name} · ×${SETTINGS.speed}</span></button></div>
    </div>
    <div class="title-note">
      김용(金庸) 소설의 사건과 시대를 새 대사로 재구성한 비공식·비영리 팬메이드 SRPG<br>
      원작 본편 · 원작 단편 · 게임 오리지널 외전은 화면에서 명확히 구분됩니다.<br>
      PC · 모바일 · 키보드 · 게임패드 지원 — 진행 상황 자동 저장
    </div>
  </div>`;
  requestAnimationFrame(animateTitleScreen);
}
function newGame(){
  showCampaignSelect('chronicles');
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
      ◆ <b style="color:#e07070">적 의도·위험</b>: 적 머리 위 문양은 다음 행동, 상단 위험 버튼은 다음 턴 공격 가능 범위를 표시합니다<br>
      ◆ <b style="color:#d9b45b">호신강기·파훼</b>: 강적의 금색 강기 게이지를 상성·필살·연계로 깎으면 방어가 무너집니다. 보스는 체력 구간마다 초식과 능력이 바뀝니다<br>
      ◆ <b style="color:#8fd8b9">적 초식·간파</b>: 주요 강적 정보창의 행동 예고와 파훼 조건을 읽고 알맞은 무공 유형·협공·연계를 쓰면 추가 명중·피해·강기 파괴가 적용됩니다. 간파 횟수는 전투 기여도에 기록됩니다<br>
      ◆ <b style="color:#8fd6c2">전투 목표</b>: 섬멸 외에도 방어·점거·탈출·비살상 제압이 있습니다. 현재 목표와 진행도는 상단과 정보창에서 확인합니다<br>
      ◆ <b style="color:#d8b5ef">무공 편성·연계</b>: 거점에서 협객당 무공 3개를 고릅니다. 서로 다른 초식을 연속 사용하면 연계가, A급 인연 협객이 인접하면 합동 오의가 발동할 수 있습니다<br>
      ◆ <b style="color:#9fd4c8">내공·특성 편성</b>: 핵심 협객은 원작에서 실제로 익힌 심법이나 확인된 전투 성향 하나를 고릅니다. 원작 사건을 지난 뒤 새 심법이 해금되며, ‘특성’ 표기는 가공 내공명이 아닙니다<br>
      ◆ <b style="color:#d9b36c">수묵 전장</b>: 전경·중경·원경이 카메라에 따라 움직이고 세 턴마다 시간대가 흐릅니다. 무공·합동 오의·보스 전환에는 전용 초상 컷인과 먹선 궤적이 표시됩니다<br>
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
  if(handleModalKeydown(e,{cancelForecast})) return;
  if(!B) return; /* 메뉴 화면에서는 브라우저의 기본 Tab/Enter/Space 조작을 보존 */
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||'');
  if(typing) return;
  if(e.target?.closest?.('button,a,[role="button"]')) return;
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
  const payload=createBackupPayload(localStorage);
  const blob=new Blob([JSON.stringify(payload,null,1)],{type:'application/json'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  const d=new Date();
  const pad=n=>String(n).padStart(2,'0');
  a.href=url; a.download=`강호의별_백업_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function exportBattleReports(){
  SFX.play('ui');
  const payload={app:'강호의 별',format:'battle-report-v1',createdAt:new Date().toISOString(),reports:BATTLE_REPORTS};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  const d=new Date(),pad=n=>String(n).padStart(2,'0');
  a.href=url;a.download=`강호의별_전투기록_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.json`;
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
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
      const result=restoreBackupPayload(rd.result,localStorage);
      if(!result.ok) throw 0;
      const warning=result.issues.length?` 손상 구획 ${result.issues.length}개는 격리했습니다.`:'';
      alert(`${result.count}개 기록을 검증·복원했습니다.${warning} 게임을 새로고침합니다.`);
      location.reload();
    }catch(e){ alert('가져오기 실패 — 올바른 백업 파일이 아닙니다.'); }
  };
  rd.readAsText(f);
}

/* 부팅은 main.js 의 boot() 에서 수행 */


/* ============================================================
   v3 통합 캠페인 엔진 — 등록·보강 규칙은 campaigns.js가 단일 관리
   ============================================================ */
const CAMPAIGNS = createCampaignRegistry();
let CAMP_CTX = null; // 거점 화면 컨텍스트 {node, back}
let CAMP_TAB = 'unit';
const DEFAULT_SHOP = ['mokgeom','cheolgeom','gangcheol','yuyeopdo','panhwanpil','hosinbu','okpae','yeonwoogap','chilseongpae','gyeonggong','bihohye','ungdam','geumchang','sohwandan','haedok','byeokhahwan','jeongsimdan'];

const v2Key = id => 'kimyong_v2_' + id;
function partyLeader(){
  if(SESSION.campaignState&&CAMPAIGNS[SESSION.campaignState.camp]&&CAMPAIGNS[SESSION.campaignState.camp].leader){
    const ld=CAMPAIGNS[SESSION.campaignState.camp].leader;
    return G.party.includes(ld)?ld:null;
  }
  return G.party.find(cid=>CHARS[cid].leader)||null;
}
function v2New(campId){
  const C = CAMPAIGNS[campId];
  return { camp:campId, stageId:C.start, flags:{}, gold:C.gold||0, inv:{}, equips:{}, promoted:{},
           cleared:[], attempted:{}, roster:{}, party:[], extraSkills:{}, deploy:null,
           supports:{}, supportLock:{}, skillLoadouts:{}, internalLoadouts:{}, history:[], reputation:{hyeop:0,jeong:0,se:0}, factions:{}, trusts:{}, choiceMemory:{}, diff:SETTINGS.diff };
}
function importClassicAsChronicle(){
  if(v2LoadSave('chronicle')||!V3STORE.legacy.classicV1) return;
  const old=V3STORE.legacy.classicV1;
  const st=v2New('chronicle');
  const reached=Math.max(0,Math.min(Number(old.ch)||0,CHAPTERS.length));
  st.stageId=reached>=CHAPTERS.length?'end':`ch${String(reached+1).padStart(2,'0')}`;
  st.cleared=Array.from({length:reached},(_,i)=>`ch${String(i+1).padStart(2,'0')}`);
  st.roster=deepClone(old.roster||{});
  st.party=deepClone(old.party||[]);
  st.extraSkills=deepClone(old.extra||{});
  st.deploy=deepClone(old.deploy||null);
  st.diff=old.diff||SETTINGS.diff;
  V3STORE=setCampaignSave(V3STORE,'chronicle',st);
  localStorage.setItem(v2Key('chronicle'),JSON.stringify(st));
  const last=normalizeLastPlay(V3STORE.lastSession);
  if(last?.campaignId==='chronicle'){
    V3STORE=setLastSession(V3STORE,{mode:'campaign',campaignId:'chronicle',at:last.at});
  }
}
function v2Save(){
  markPlay('campaign', SESSION.campaignState&&SESSION.campaignState.camp);
  if(!SESSION.campaignState) return;
  try{
    const {curBattle, ...st}=SESSION.campaignState;
    V3STORE=setCampaignSave(V3STORE,SESSION.campaignState.camp,st);
    localStorage.setItem(v2Key(SESSION.campaignState.camp), JSON.stringify(st));
  }catch(e){}
}
function saveCampaignCheckpoint(kind,label){
  const campaign=SESSION.campaign(); if(!campaign) return;
  appendCheckpoint(V3STORE,makeCampaignCheckpoint({kind,label,campaign}));
  V3STORE=writeV3(V3STORE);
}
function v2LoadSave(campId){
  return getCampaignSave(V3STORE,campId);
}
function v2Bind(){
  G.roster=SESSION.campaignState.roster; G.party=SESSION.campaignState.party; G.extraSkills=SESSION.campaignState.extraSkills; G.deploy=SESSION.campaignState.deploy;
}
function initRosterCharV2(cid){
  if(SESSION.campaignState.roster[cid]){
    if(!SESSION.campaignState.party.includes(cid)) SESSION.campaignState.party.push(cid); /* 이탈했던 동료 복귀 */
    return;
  }
  SESSION.campaignState.roster[cid]={cid, lvl:1, exp:0, stats:statObj(CHARS[cid].base)};
  SESSION.campaignState.party.push(cid);
}
function startCampaignV2(campId, useSave, ngBonus){
  B=null;
  const C=CAMPAIGNS[campId];
  const loaded=useSave&&v2LoadSave(campId);
  SESSION.activateCampaign(loaded||v2New(campId));
  SESSION.campaignState.attempted=SESSION.campaignState.attempted||{};
  SESSION.campaignState.supports=SESSION.campaignState.supports||{}; SESSION.campaignState.supportLock=SESSION.campaignState.supportLock||{}; /* 구 세이브 호환 */
  SESSION.campaignState.skillLoadouts=SESSION.campaignState.skillLoadouts||{}; SESSION.campaignState.internalLoadouts=SESSION.campaignState.internalLoadouts||{}; SESSION.campaignState.history=SESSION.campaignState.history||[];
  SESSION.campaignState.reputation=SESSION.campaignState.reputation||{hyeop:0,jeong:0,se:0}; SESSION.campaignState.factions=SESSION.campaignState.factions||{};
  SESSION.campaignState.trusts=SESSION.campaignState.trusts||{}; SESSION.campaignState.choiceMemory=SESSION.campaignState.choiceMemory||{};
  if(!loaded&&C.inherit){ /* 전권 세이브에서 플래그·보너스 계승 */
    const src=v2LoadSave(C.inherit.from);
    if(src){
      for(const f of (C.inherit.flags||[])) if(src.flags&&src.flags[f]) SESSION.campaignState.flags[f]=src.flags[f];
      if(src.cleared&&src.cleared.includes('end')){
        SESSION.campaignState.gold+=(C.inherit.clearBonusGold||0);
        SESSION.campaignState.flags.prevClear=1;
      }
    }
  }
  if(!SESSION.campaignState.party.length){ for(const cid of C.party) initRosterCharV2(cid); }
  if(!loaded){
    if(C.startLvl){ for(const cid of SESSION.campaignState.party){ const r=SESSION.campaignState.roster[cid]; while(r.lvl<C.startLvl) rosterLevelUp(r); } }
    if(C.startInv) for(const k in C.startInv) SESSION.campaignState.inv[k]=(SESSION.campaignState.inv[k]||0)+C.startInv[k];
    if(C.startSkills) for(const k in C.startSkills) SESSION.campaignState.extraSkills[k]=[...(C.startSkills[k]||[])];
    if(campId==='jinfinal'){
      const {record}=syncEndgameStore(),blessing=endgameBlessing(record);
      SESSION.campaignState.flags.endgame_blessing=1;
      SESSION.campaignState.flags.endgame_seals=blessing.seals;
      if(blessing.perfect)SESSION.campaignState.flags.endgame_perfect=1;
      SESSION.campaignState.gold+=blessing.gold;
      for(const [item,count] of Object.entries(blessing.items))SESSION.campaignState.inv[item]=(SESSION.campaignState.inv[item]||0)+count;
    }
    /* 회차(New Game+) 계승 보너스 */
    if(ngBonus){
      SESSION.campaignState.ngPlus=true; unlockAchv('ng_plus');
      if(ngBonus==='gold') SESSION.campaignState.gold += 2000;
      else if(ngBonus==='item'){ SESSION.campaignState.inv.bogeom=(SESSION.campaignState.inv.bogeom||0)+1; SESSION.campaignState.inv.daehwandan=(SESSION.campaignState.inv.daehwandan||0)+3; SESSION.campaignState.inv.yeonwoogap=(SESSION.campaignState.inv.yeonwoogap||0)+1; }
      else if(ngBonus==='bond'){ for(const p of SUPPORTS.pairs){ if(SESSION.campaignState.party.includes(p.a)&&SESSION.campaignState.party.includes(p.b)) SESSION.campaignState.supports[pairKey(p.a,p.b)]=2; } }
    }
  }
  v2Bind();
  v2Save(); /* 시작 즉시 저장 → 통합 이어하기 허브에 노출 */
  showRouteMap();
}
function curNode(){ return SESSION.campaignState?CAMPAIGNS[SESSION.campaignState.camp].stages[SESSION.campaignState.stageId]:null; }
function v2Lines(lines){
  return (lines||[]).filter(l=>{
    if(l.ifNot&&SESSION.campaignState.flags[l.ifNot]) return false;
    if(('if' in l)&&l.if!==null&&l.if!==undefined&&!SESSION.campaignState.flags[l.if]) return false;
    return true;
  });
}
function v2BattleDef(n){
  const stage=applyBattleVariant(n,SESSION.campaignState.flags);
  const battles=SESSION.campaignState.cleared.filter(id=>{const st=CAMPAIGNS[SESSION.campaignState.camp].stages[id];return st&&st.kind==='battle';}).length;
  return { no:battles+1, joins:[], title:stage.title, map:stage.map, spawns:stage.spawns, enemies:stage.enemies,
    reinforce:stage.reinforce, win:stage.win, lose:stage.lose||'수령이 쓰러지면 패배', defeat:stage.defeat||null, pre:[], post:[],
    treasures:stage.treasures||[], goldReward:stage.goldReward||0, deploy:stage.deploy||null,
    learn:stage.learn||null, objective:stage.objective||null, bossPhases:stage.bossPhases||null,
    sceneTheme:stage.sceneTheme||null, environment:stage.environment||null,battleVariant:stage.battleVariant||null };
}
function v2Enter(){
  if(!SESSION.campaignState) return;
  v2Save();
  const n=curNode();
  if(!n){ toTitle(); return; }
  (n.joins||[]).forEach(cid=>{
    initRosterCharV2(cid);
    const target=Math.max(1,n.joinLevel||1), r=SESSION.campaignState.roster[cid];
    while(r.lvl<target) rosterLevelUp(r);
  });
  (n.leave||[]).forEach(cid=>{
    const i=SESSION.campaignState.party.indexOf(cid); if(i>=0) SESSION.campaignState.party.splice(i,1);
    if(SESSION.campaignState.deploy){ const j=SESSION.campaignState.deploy.indexOf(cid); if(j>=0) SESSION.campaignState.deploy.splice(j,1); }
  });
  /* 첫 진입 시 컷신 → 대사 순으로 (재도전 시 생략) */
  const firstTime = !SESSION.campaignState.attempted[SESSION.campaignState.stageId] && !SESSION.campaignState.cleared.includes(SESSION.campaignState.stageId);
  const withCut = (after)=>{ if(firstTime && n.cut) showCutscene(n.cut, after); else after(); };
  if(n.kind==='talk'){
    const go=()=>v2Advance(n);
    if(SESSION.campaignState.attempted[SESSION.campaignState.stageId]) go();
    else { SESSION.campaignState.attempted[SESSION.campaignState.stageId]=1; withCut(()=>showDialogue(v2Lines(n.pre), go, n.title)); }
    return;
  }
  if(n.kind==='battle'){
    const dep=()=>v2Deploy(n);
    if(SESSION.campaignState.attempted[SESSION.campaignState.stageId]) dep();
    else { SESSION.campaignState.attempted[SESSION.campaignState.stageId]=1; withCut(()=>showDialogue(v2Lines(n.pre), dep, n.title)); }
  }else if(n.kind==='camp'){
    const go=()=>showCamp(n,'route');
    if(n.pre&&!SESSION.campaignState.cleared.includes(SESSION.campaignState.stageId)&&!SESSION.campaignState.attempted[SESSION.campaignState.stageId]){ SESSION.campaignState.attempted[SESSION.campaignState.stageId]=1; showDialogue(v2Lines(n.pre), go, n.title); }
    else go();
  }else if(n.kind==='choice'){
    showChoiceNode(n);
  }else if(n.kind==='end'){
    showV2End(n);
  }
}
function v2Deploy(n){
  saveCampaignCheckpoint('deploy',`${n.title} · 출전 직전`);
  SESSION.campaignState.curBattle=v2BattleDef(n);
  G.deploy=SESSION.campaignState.deploy;
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
  if(n&&n.set) Object.assign(SESSION.campaignState.flags,n.set); /* 노드 완료 시 플래그 */
  if(nx&&typeof nx==='object'&&nx.cond){ /* 플래그 조건/비교 분기 */
    let to=nx.else;
    for(const c of nx.cond){
      if(c.and){ if(c.and.every(f=>SESSION.campaignState.flags[f])){ to=c.to; break; } }
      else if(c.gte){ if((SESSION.campaignState.flags[c.gte[0]]||0)>=(SESSION.campaignState.flags[c.gte[1]]||0)){ to=c.to; break; } }
      else if(c.if&&SESSION.campaignState.flags[c.if]){ to=c.to; break; }
    }
    nx=to;
  }
  if(!nx){ toTitle(); return; }
  if(!SESSION.campaignState.cleared.includes(SESSION.campaignState.stageId)) SESSION.campaignState.cleared.push(SESSION.campaignState.stageId);
  SESSION.campaignState.stageId=nx; v2Save(); v2Enter();
}
function showChoiceNode(n){
  saveCampaignCheckpoint('choice',`${n.title} · 선택 직전`);
  const memory=SESSION.campaignState.choiceMemory?.[SESSION.campaignState.stageId];
  app().innerHTML=`<div class="result-screen" style="padding:44px 0">
    ${journeyTrail('aftermath')}
    <h2 style="font-size:26px">${n.title}</h2>
    <p>${n.prompt}</p>
    ${n.options.map((o,i)=>({o,i})).filter(x=>!(x.o.hideIf&&SESSION.campaignState.flags[x.o.hideIf])).map(x=>`<div class="choice-route ${memory?(memory.seen||[]).includes(x.i)?'seen':'unseen':''}">
      <button class="btn" style="min-width:min(480px,88vw)" onclick="pickChoice(${x.i})">${x.o.label}${memory?` <small>${(memory.seen||[]).includes(x.i)?'✓ 확인한 분기':'◆ 미확인 분기'}</small>`:''}</button>
      <div style="color:var(--dim);font-size:12.5px;margin-top:4px">${x.o.desc||''}</div></div>`).join('')}
  </div>`;
}
function pickChoice(i){
  const n=curNode(), o=n.options[i];
  const stageId=SESSION.campaignState.stageId;
  SESSION.campaignState.choiceMemory=SESSION.campaignState.choiceMemory||{};
  const memory=SESSION.campaignState.choiceMemory[stageId]||{title:n.title,prompt:n.prompt,options:n.options.map(x=>x.label),seen:[]};
  if(!memory.seen.includes(i)) memory.seen.push(i);
  SESSION.campaignState.choiceMemory[stageId]=memory;
  const {history,curBattle,choiceMemory,...snapshot}=SESSION.campaignState;
  SESSION.campaignState.history=SESSION.campaignState.history||[];
  SESSION.campaignState.history.push({stageId,title:n.title,label:o.label,optionIndex:i,options:n.options.map(x=>x.label),at:Date.now(),state:deepClone(snapshot)});
  if(o.set) Object.assign(SESSION.campaignState.flags,o.set);
  if(o.add) for(const k in o.add) SESSION.campaignState.flags[k]=(SESSION.campaignState.flags[k]||0)+o.add[k];
  if(o.rep) for(const k in o.rep) SESSION.campaignState.reputation[k]=(SESSION.campaignState.reputation[k]||0)+o.rep[k];
  if(o.faction) for(const k in o.faction) SESSION.campaignState.factions[k]=(SESSION.campaignState.factions[k]||0)+o.faction[k];
  if(o.trust) for(const k in o.trust) SESSION.campaignState.trusts[k]=(SESSION.campaignState.trusts[k]||0)+o.trust[k];
  if(!SESSION.campaignState.cleared.includes(SESSION.campaignState.stageId)) SESSION.campaignState.cleared.push(SESSION.campaignState.stageId);
  SESSION.campaignState.stageId=o.to; v2Save(); v2Enter();
}
function showV2End(n){
  if(!SESSION.campaignState.cleared.includes(SESSION.campaignState.stageId)) SESSION.campaignState.cleared.push(SESSION.campaignState.stageId);
  const firstFinal=SESSION.campaignState.camp==='jinfinal'&&!SESSION.campaignState.flags.r25_final_recorded;
  if(firstFinal)SESSION.campaignState.flags.r25_final_recorded=1;
  v2Save();
  const endgame=syncEndgameStore();
  if(firstFinal){endgame.record.finalClears=(endgame.record.finalClears||0)+1;V3STORE.challenges.endgame=endgame.record;V3STORE=writeV3(V3STORE);}
  recordCampaignClear(SESSION.campaignState.camp, SESSION.campaignState.stageId);
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
  if(!SESSION.campaignState) return [];
  return Object.keys(SESSION.campaignState.inv).filter(id=>SESSION.campaignState.inv[id]>0&&ITEMS[id]&&ITEMS[id].kind==='use');
}
function openToolMenu(u){
  const list=v2Usables();
  const html=`<div class="modal-back" id="tool-modal">
    <div class="modal"><h3>도구 사용 — ${u.name}</h3>
    ${list.map(id=>{const it=ITEMS[id];return `<div style="margin:6px 0"><button class="btn small" style="width:100%;text-align:left" onclick="v2UseTool('${id}')">${it.name} ×${SESSION.campaignState.inv[id]} <span style="color:var(--dim);font-size:12px">— ${it.desc}</span></button></div>`;}).join('')}
    <div class="btnrow"><button class="btn" onclick="closeToolMenu()">취소</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function closeToolMenu(){ const m=document.getElementById('tool-modal'); if(m) m.remove(); backToMenu(); }
function v2UseTool(id){
  const m=document.getElementById('tool-modal'); if(m) m.remove();
  const u=B.sel, it=ITEMS[id];
  if(!u||!it||(SESSION.campaignState.inv[id]||0)<=0){ backToMenu(); return; }
  SESSION.campaignState.inv[id]--; if(SESSION.campaignState.inv[id]<=0) delete SESSION.campaignState.inv[id];
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
function ownedCount(id){ return SESSION.campaignState.inv[id]||0; }
function renderCamp(){
  const n=CAMP_CTX.node;
  let body='';
  if(CAMP_TAB==='unit') body=campUnitHTML();
  else if(CAMP_TAB==='shop') body=campShopHTML();
  else if(CAMP_TAB==='support') body=campSupportHTML();
  else body=campBagHTML();
  const nSup=campSupportAvail().filter(p=>(SESSION.campaignState.supports[pairKey(p.a,p.b)]||0)<3 && SESSION.campaignState.supportLock[pairKey(p.a,p.b)]!==SESSION.campaignState.stageId).length;
  app().innerHTML=`<div id="camp">
    ${journeyTrail('camp')}
    <h2>${n?n.title:'거점 — 부대 정비'}</h2>
    <div class="camp-head"><span>소지금 <b style="color:var(--gold2)">${SESSION.campaignState.gold}냥</b></span><span>부대 ${SESSION.campaignState.party.length}명</span></div>
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
  if(!SESSION.campaignState.cleared.includes(SESSION.campaignState.stageId)) SESSION.campaignState.cleared.push(SESSION.campaignState.stageId);
  v2Advance(n);
}
function campEquipOptions(cid,slot){
  const eq=SESSION.campaignState.equips[cid]=SESSION.campaignState.equips[cid]||{w:null,a:null},kind=slot==='w'?'weapon':'acc';
  let html='<option value="">— 없음 —</option>';
  for(const id in ITEMS){
    if(ITEMS[id].kind!==kind)continue;
    if(eq[slot]===id)html+=`<option value="${id}" selected>${ITEMS[id].name} (장착)</option>`;
    else if(ownedCount(id)>0)html+=`<option value="${id}">${ITEMS[id].name} ×${ownedCount(id)}</option>`;
  }
  return html;
}
function campLoadoutStats(cid){
  const r=SESSION.campaignState.roster[cid],c=CHARS[cid],after={...r.stats},eq=SESSION.campaignState.equips[cid]||{};
  let attackBonus=0;
  for(const slot of ['w','a']){const item=ITEMS[eq[slot]];if(!item)continue;attackBonus+=item.atk||0;for(const key of ['hp','def','res','mov'])after[key]=(after[key]||0)+(item[key]||0);}
  const inner=internalById(selectedInternal(cid));for(const [key,value] of Object.entries(inner?.effects?.stats||{}))after[key]=(after[key]||0)+value;
  const attackKey=c.type==='내'?'int':'str';after.attack=(after[attackKey]||0)+attackBonus;
  return {before:{hp:r.stats.hp,attack:r.stats[attackKey],def:r.stats.def,res:r.stats.res,mov:r.stats.mov},after,inner};
}
function loadoutDelta(label,before,after){return `<span>${label} <b>${before}</b>${after!==before?`<i>→ ${after}</i>`:''}</span>`;}
function autoCampLoadout(cid,role){
  const c=CHARS[cid],campaign=SESSION.campaignState,all=[...new Set([...c.skills,...(campaign.extraSkills[cid]||[])])];
  const skillScore=sid=>{const sk=SKILLS[sid];if(role==='attack')return (sk.mult||0)*20+(sk.poison?5:0)-(sk.heal?20:0);if(role==='defense')return (sk.heal?40:0)+(sk.hit||0)*.2;return (sk.hit||0)+(sk.mult||0)*8+(sk.poison?4:0);};
  campaign.skillLoadouts[cid]=all.sort((a,b)=>skillScore(b)-skillScore(a)).slice(0,3);
  const innerScore=id=>{const e=INTERNALS[id].effects||{};if(role==='attack')return (e.damage||0)+(e.stationaryDamage||0)+(e.comboDamage||0)+(e.crit||0)/100;if(role==='defense')return (e.damageTaken||0)+(e.lowHpReduction||0)+(e.avoid||0)/100+(e.stats?.def||0)/10;return (e.guardDamage||0)+(e.hit||0)/10+(e.vsInnerHit||0)/10;};
  const options=[...availableInternalOptions(cid)].sort((a,b)=>innerScore(b)-innerScore(a));if(options.length)campaign.internalLoadouts[cid]=options[0];
  SFX.play('equip');v2Save();renderCamp();
}
function campUnitHTML(){
  return `<div class="formation-intro"><div><b>통합 출전 편성</b><span>장비·무공·내공을 한 카드에서 비교합니다.</span></div><small>자동 편성은 보유 무공과 해금된 심법만 변경하며 장비는 이동시키지 않습니다.</small></div><div class="formation-grid">`+
  SESSION.campaignState.party.map(cid=>{
    const r=SESSION.campaignState.roster[cid],c=CHARS[cid],promo=c.promo,stats=campLoadoutStats(cid),inner=stats.inner,skills=(SESSION.campaignState.skillLoadouts[cid]||[]).length||Math.min(3,c.skills.length+(SESSION.campaignState.extraSkills[cid]||[]).length);
    let promotion=`<span class="formation-muted">승급 정보 없음</span>`;
    if(SESSION.campaignState.promoted[cid])promotion=`<span class="promoted">${SESSION.campaignState.promoted[cid]} 승급 완료</span>`;
    else if(promo){
      const status=promotionStatus(promo,{level:r.lvl,inventory:SESSION.campaignState.inv,campaign:SESSION.campaignState});
      const reqs=promotionRequirementParts(promo,{itemName:promo.item?ITEMS[promo.item]?.name:'',status});
      promotion=`<button class="btn small" ${status.available?'':'disabled'} onclick="v2Promote('${cid}')">승급</button><small class="promotion-detail"><span class="promotion-reqs">${reqs.map(req=>`<i class="${req.met?'met':'unmet'}">${req.met?'✓':'○'} ${req.text}</i>`).join('')}</span><b>${promotionEffectText(promo)}</b></small>`;
    }
    return `<article class="formation-card" data-cid="${cid}"><header><div class="formation-portrait">${ptSVG(cid)}</div><div><h3>${c.name}</h3><p>Lv.${r.lvl} · ${SESSION.campaignState.promoted[cid]||c.cls} · ${TYPE_NAME[c.type]}</p></div></header>
      <div class="formation-stats">${loadoutDelta('HP',stats.before.hp,stats.after.hp)}${loadoutDelta('공격',stats.before.attack,stats.after.attack)}${loadoutDelta('방어',stats.before.def,stats.after.def)}${loadoutDelta('정신',stats.before.res,stats.after.res)}${loadoutDelta('이동',stats.before.mov,stats.after.mov)}</div>
      <div class="formation-equips"><label>병기<select aria-label="${c.name} 병기" onchange="v2Equip('${cid}','w',this.value)">${campEquipOptions(cid,'w')}</select></label><label>보구<select aria-label="${c.name} 보구" onchange="v2Equip('${cid}','a',this.value)">${campEquipOptions(cid,'a')}</select></label></div>
      <div class="formation-actions"><button class="btn small" onclick="openSkillLoadout('${cid}')">무공 ${skills}/3</button>${internalOptions(cid).length?`<button class="btn small" onclick="openInternalLoadout('${cid}')">${inner?inner.name:'무학 미해금'}</button>`:'<span class="formation-muted">고유 심법 없음</span>'}</div>
      <div class="formation-inner">${inner?`<b>${inner.kind} · ${inner.role}</b><span>${internalEffectText(selectedInternal(cid))}</span>`:'<span>원작 사건을 진행하면 고유 무학이 열립니다.</span>'}</div>
      <div class="formation-auto"><span>무공·심법 자동</span><button onclick="autoCampLoadout('${cid}','attack')">공격</button><button onclick="autoCampLoadout('${cid}','defense')">수비</button><button onclick="autoCampLoadout('${cid}','break')">파훼</button></div>
      <footer>${promotion}</footer></article>`;
  }).join('')+`</div>`;
}
function promotionEffectText(promo){
  const names={hp:'HP',str:'힘',int:'내공',def:'방어',res:'정신',spd:'속도',skl:'기술',mov:'이동',ki:'기'};
  const stats=Object.entries(promo.bonus||{}).map(([k,v])=>`${names[k]||k} +${v}`);
  if(promo.skill&&SKILLS[promo.skill]) stats.push(`${SKILLS[promo.skill].name} 습득`);
  return `${promo.cls} · ${stats.join(' · ')}`;
}
function v2Equip(cid, slot, id){
  SFX.play('equip');
  const eq=SESSION.campaignState.equips[cid]=SESSION.campaignState.equips[cid]||{w:null,a:null};
  if(eq[slot]){ SESSION.campaignState.inv[eq[slot]]=(SESSION.campaignState.inv[eq[slot]]||0)+1; eq[slot]=null; }
  if(id){
    if((SESSION.campaignState.inv[id]||0)<=0){ v2Save(); renderCamp(); return; }
    SESSION.campaignState.inv[id]--; if(SESSION.campaignState.inv[id]<=0) delete SESSION.campaignState.inv[id];
    eq[slot]=id;
  }
  v2Save(); renderCamp();
}
function v2Promote(cid){
  const c=CHARS[cid], promo=c.promo, r=SESSION.campaignState.roster[cid];
  const status=promotionStatus(promo,{level:r?.lvl||0,inventory:SESSION.campaignState.inv,campaign:SESSION.campaignState,promoted:!!SESSION.campaignState.promoted[cid]});
  if(!status.available) return;
  if(promo.item){SESSION.campaignState.inv[promo.item]--; if(SESSION.campaignState.inv[promo.item]<=0) delete SESSION.campaignState.inv[promo.item];}
  for(const k in (promo.bonus||{})) r.stats[k]=(r.stats[k]||0)+promo.bonus[k];
  SESSION.campaignState.promoted[cid]=promo.cls;
  unlockAchv('promote');
  if(promo.skill){
    SESSION.campaignState.extraSkills[cid]=SESSION.campaignState.extraSkills[cid]||[];
    if(!SESSION.campaignState.extraSkills[cid].includes(promo.skill)) SESSION.campaignState.extraSkills[cid].push(promo.skill);
  }
  v2Save(); renderCamp();
}
function campShopHTML(){
  const list=campShopList();
  const buy=list.map(id=>{const it=ITEMS[id],price=shopPrice(it);return `<tr><td style="text-align:left"><b>${it.name}</b><div style="font-size:11px;color:var(--dim)">${it.desc}</div></td><td>${price}냥${price<it.price?` <del style="color:var(--dim);font-size:10px">${it.price}</del>`:''}</td><td><button class="btn small" ${SESSION.campaignState.gold>=price?'':'disabled'} onclick="v2Buy('${id}')">구입</button></td></tr>`;}).join('');
  const inv=Object.keys(SESSION.campaignState.inv);
  const sell=inv.length?inv.map(id=>{const it=ITEMS[id];return `<tr><td style="text-align:left">${it.name} ×${SESSION.campaignState.inv[id]}</td><td>${Math.floor(it.price/2)}냥</td><td><button class="btn small" onclick="v2Sell('${id}')">매각</button></td></tr>`;}).join(''):`<tr><td colspan="3" style="color:var(--dim)">매각할 물건이 없습니다</td></tr>`;
  return `<div class="camp-cols"><div><h3>구입</h3><table class="camptable">${buy}</table></div>
  <div><h3>매각 <span style="font-size:11px;color:var(--dim)">(정가의 절반)</span></h3><table class="camptable">${sell}</table></div></div>`;
}
function shopPrice(it){ return shopPriceFor(it.price,SESSION.campaignState.reputation); }
function v2Buy(id){ const it=ITEMS[id],price=it?shopPrice(it):0; if(!it||SESSION.campaignState.gold<price) return; SESSION.campaignState.gold-=price; SESSION.campaignState.inv[id]=(SESSION.campaignState.inv[id]||0)+1; SFX.play('gold'); v2Save(); renderCamp(); }
function v2Sell(id){ if((SESSION.campaignState.inv[id]||0)<=0) return; SESSION.campaignState.inv[id]--; if(SESSION.campaignState.inv[id]<=0) delete SESSION.campaignState.inv[id]; SESSION.campaignState.gold+=Math.floor(ITEMS[id].price/2); SFX.play('gold'); v2Save(); renderCamp(); }
function campBagHTML(){
  return `<table class="camptable">${invRowsHTML()}</table>`;
}
/* ── 지원 대화(인연) 탭 ── */
function campSupportAvail(){
  return SUPPORTS.pairs.filter(p=>SESSION.campaignState.party.includes(p.a)&&SESSION.campaignState.party.includes(p.b));
}
function campSupportHTML(){
  const avail=campSupportAvail();
  if(!avail.length) return `<p style="color:var(--dim);padding:10px 4px">아직 인연을 나눌 동료가 모이지 않았습니다. 이야기가 진행되면 새 인연이 열립니다.</p>`;
  const rows=avail.map(p=>{
    const key=pairKey(p.a,p.b), rank=SESSION.campaignState.supports[key]||0;
    const locked=SESSION.campaignState.supportLock[key]===SESSION.campaignState.stageId;
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
  const rank=SESSION.campaignState.supports[key]||0;
  if(rank>=3||SESSION.campaignState.supportLock[key]===SESSION.campaignState.stageId) return;
  const conv=p.convs[SUPPORTS.ranks[rank]];
  SFX.play('ui');
  const done=()=>{
    SESSION.campaignState.supports[key]=rank+1;
    SESSION.campaignState.supportLock[key]=SESSION.campaignState.stageId;
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
  const C=CAMPAIGNS[SESSION.campaignState.camp];
  const rows=C.order.map(id=>{
    const n=C.stages[id];
    const cleared=SESSION.campaignState.cleared.includes(id);
    const cur=SESSION.campaignState.stageId===id;
    const icon=cleared?'✓':(cur?'▶':'·');
    const cls=cleared?'done':(cur?'cur':'lock');
    const kindTxt={battle:'전투',camp:'거점',choice:'분기',talk:'이야기',end:'종막'}[n.kind]||'';
    const sourceTxt=n.source==='canon'?' · 정사 보강':n.source==='original'?' · 창작':'';
    return `<button type="button" class="route-row ${cls}" ${cur?'aria-current="step" onclick="v2Enter()"':'disabled'}>
      <span class="ri">${icon}</span><span class="rt">${n.title||id}</span><span class="rk">${kindTxt}${sourceTxt}</span></button>`;
  }).join('');
  const rep=SESSION.campaignState.reputation||{hyeop:0,jeong:0,se:0};
  const perks=reputationPerks(rep);
  const factionEntries=Object.entries(SESSION.campaignState.factions||{}).filter(([,v])=>v).sort((a,b)=>b[1]-a[1]);
  const trustEntries=Object.entries(SESSION.campaignState.trusts||{}).filter(([,v])=>v).sort((a,b)=>b[1]-a[1]);
  const factionLead=factionEntries[0], trustLead=trustEntries[0];
  app().innerHTML=`<div id="routemap">
    ${journeyTrail('route')}
    <h2>${C.name}</h2>
    <div class="reputation-strip"><span>俠 협 <b>${rep.hyeop||0}</b></span><span>情 정 <b>${rep.jeong||0}</b></span><span>勢 세 <b>${rep.se||0}</b></span>${factionLead?`<span>문파 <b>${escHtml(factionLead[0])}·${factionRelationTier(factionLead[1]).label}</b></span>`:''}${trustLead?`<span>신뢰 <b>${escHtml(CHARS[trustLead[0]]?.name||trustLead[0])}·${characterTrustTier(trustLead[1]).label}</b></span>`:''}<button class="btn small" onclick="showRelationshipLedger()">강호 관계록</button>${SESSION.campaignState.history&&SESSION.campaignState.history.length?`<button class="btn small" onclick="showRewindHistory()">강호 회고 ${SESSION.campaignState.history.length}</button>`:''}</div>
    ${perks.length?`<div class="reputation-perks">강호의 반향 · ${perks.join(' · ')}</div>`:''}
    <div class="camp-head"><span>소지금 <b style="color:var(--gold2)">${SESSION.campaignState.gold}냥</b></span><span>부대 ${SESSION.campaignState.party.length}명</span><span>행적 ${Object.keys(SESSION.campaignState.flags).length}건</span></div>
    <div class="route-list">${rows}</div>
    <div style="text-align:center;margin-top:14px">
      <button class="btn" onclick="v2Enter()">진행 ▶</button>
      <button class="btn small" style="margin-left:8px" onclick="campFromRoute()">거점 (장비·승급)</button>
      <button class="btn small danger" style="margin-left:8px" onclick="toTitle()">타이틀로</button>
    </div>
  </div>`;
  window.scrollTo(0,0);
}

function showRelationshipLedger(){
  const state=SESSION.campaignState;
  const factions=Object.entries(state.factions||{}).sort((a,b)=>b[1]-a[1]);
  const trusts=Object.entries(state.trusts||{}).sort((a,b)=>b[1]-a[1]);
  const factionRows=factions.map(([name,score])=>{const tier=factionRelationTier(score);return `<div class="relation-row"><b>${escHtml(name)}</b><span>${tier.label}</span><small>${score}점</small></div>`;}).join('');
  const trustRows=trusts.map(([cid,score])=>{const tier=characterTrustTier(score);return `<div class="relation-row"><b>${escHtml(CHARS[cid]?.name||cid)}</b><span>${tier.label}</span><small>${score}점</small></div>`;}).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="relation-modal"><div class="modal relation-modal"><h3>강호 관계록</h3><p class="modal-note">선택이 쌓이면 문파의 지원과 인물의 신뢰가 전투에 반영됩니다. 신뢰 2부터 해당 인물 명중 +3, 4부터 공격 +1, 6부터 방어 +1입니다.</p><div class="relation-columns"><section><h4>문파 관계</h4>${factionRows||'<p class="empty-relation">아직 맺은 문파 인연이 없습니다.</p>'}</section><section><h4>인물 신뢰</h4>${trustRows||'<p class="empty-relation">아직 쌓인 개인 신뢰가 없습니다.</p>'}</section></div><div class="btnrow"><button class="btn" onclick="document.getElementById('relation-modal').remove()">닫기</button></div></div></div>`);
}

function showRewindHistory(){
  const history=SESSION.campaignState.history||[];
  const memory=SESSION.campaignState.choiceMemory||{};
  const rows=history.map((h,i)=>{
    const seen=memory[h.stageId]?.seen||[];
    const branches=(h.options||[]).map((label,j)=>`<em class="branch-memory ${seen.includes(j)?'seen':'unseen'}">${seen.includes(j)?'✓':'◆'} ${escHtml(label)}</em>`).join('');
    return `<div class="rewind-row"><div><b>${h.title}</b><small>선택: ${h.label}</small><div class="branch-list">${branches}</div></div><button class="btn small" onclick="rewindHistory(${i})">이 지점으로</button></div>`;
  }).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="rewind-modal"><div class="modal"><h3>강호 회고</h3><p class="modal-note">선택 직전의 상태로 돌아갑니다. 이후에 만든 행적은 현재 기기에 덮어씁니다.</p><div class="rewind-list">${rows||'<p>기록된 분기가 없습니다.</p>'}</div><div class="btnrow"><button class="btn" onclick="document.getElementById('rewind-modal').remove()">닫기</button></div></div></div>`);
}
function rewindHistory(i){
  const h=SESSION.campaignState.history&&SESSION.campaignState.history[i]; if(!h) return;
  const kept=SESSION.campaignState.history.slice(0,i);
  const choiceMemory=deepClone(SESSION.campaignState.choiceMemory||{});
  SESSION.activateCampaign(deepClone(h.state)); SESSION.campaignState.history=kept; SESSION.campaignState.stageId=h.stageId;
  SESSION.campaignState.reputation=SESSION.campaignState.reputation||{hyeop:0,jeong:0,se:0}; SESSION.campaignState.factions=SESSION.campaignState.factions||{};
  SESSION.campaignState.trusts=SESSION.campaignState.trusts||{}; SESSION.campaignState.choiceMemory=choiceMemory;
  SESSION.campaignState.curBattle=null; B=null; v2Bind(); v2Save();
  const m=document.getElementById('rewind-modal'); if(m)m.remove();
  v2Enter();
}

/* ── 캠페인 선택 ── */
function campCleared(id){
  const sv=v2LoadSave(id);
  return !!(sv&&sv.cleared&&sv.cleared.some(x=>String(x).startsWith('end')));
}
function currentEndgameProgress(){
  const campaignClears=Object.fromEntries(['sajo','sinjo','uicheon','chunryong'].map(id=>[id,campCleared(id)]));
  return endgameProgress({campaignClears,lunjian:V3STORE.challenges.lunjian||{},trialMedals:V3STORE.challenges.trials?.medals||{},finalCleared:campCleared('jinfinal')});
}
function syncEndgameStore(){
  const progress=currentEndgameProgress(),synced=syncEndgameRecord(V3STORE.challenges.endgame||{},progress);
  V3STORE.challenges.endgame=synced.record;V3STORE=writeV3(V3STORE);
  return {...synced,progress};
}
function showEndgameRecord(){
  const {record,progress}=syncEndgameStore(),blessing=endgameBlessing(record);
  const rows=ENDGAME_SEALS.map(seal=>{const item=progress.seals.find(entry=>entry.id===seal.id),claimed=record.claimed?.[seal.id];return `<div class="endgame-record-row ${item.complete?'complete':''}"><i>${item.complete?'印':seal.short}</i><div><b>${seal.name}</b><span>${item.value}/${seal.target} · ${seal.desc}</span><small>${claimed?`${new Date(claimed).toLocaleDateString('ko-KR')} 획득`:'아직 미완성'}</small></div></div>`;}).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="endgame-record"><div class="modal endgame-record"><h3>무림 종장록</h3><p class="modal-note">인장은 조건을 한 번 달성하면 영구히 남습니다. 진최종전 새 여정에는 인장당 200냥과 대환단 1개가 지급됩니다.</p><div class="endgame-record-list">${rows}</div><div class="endgame-legacy"><b>계승 인장 ${blessing.seals}/3</b><span>최종 가호 ${blessing.gold}냥 · 대환단 ${blessing.items.daehwandan}개</span><small>진최종전 완주 ${record.finalClears||0}회${record.perfect?' · 완전 제패 달성':''}</small></div><div class="btnrow"><button class="btn" onclick="document.getElementById('endgame-record').remove()">닫기</button></div></div></div>`);
}
function lockedCard(id, badge){
  const C=CAMPAIGNS[id], meta=CAMPAIGN_META[id]||{};
  const req=C.requireAll||[];
  const done=req.filter(campCleared).length;
  const reqNames=req.map(r=>`${CAMPAIGNS[r]?CAMPAIGNS[r].name.replace(/^(해금 외전|외전.·|외전.|사조삼부곡 [^—]*—) /,'').trim():r}${campCleared(r)?' ✓':''}`).join(' · ');
  const endgame=id==='jinfinal'?currentEndgameProgress():null;
  return `<div class="camp-card lock"><div class="camp-meta"><span>${meta.canon||'잠김'}</span><span>${meta.era||''}</span></div><h3>🔒 ${C.name} ${badge?`<span style="font-size:12px;color:var(--gold2)">${badge}</span>`:''}</h3>
    <p>${C.desc}</p>
    <p style="color:var(--gold2);font-size:12.5px">해금 조건 (${done}/${req.length}): ${reqNames}</p>${endgame?`<p class="endgame-lock">무림 종장 인장 ${endgame.completed}/3 · ${endgame.seals.map(seal=>`${seal.short} ${seal.value}/${seal.target}`).join(' · ')}</p>`:''}</div>`;
}
function openSkillLoadout(cid){
  const c=CHARS[cid], all=[...new Set([...c.skills,...(SESSION.campaignState.extraSkills[cid]||[])])];
  const selected=(SESSION.campaignState.skillLoadouts[cid]&&SESSION.campaignState.skillLoadouts[cid].filter(s=>all.includes(s)))||all.slice(0,3);
  SESSION.campaignState.skillLoadouts[cid]=selected;
  const rows=all.map(sid=>{const sk=SKILLS[sid], on=selected.includes(sid);return `<label class="skill-pick ${on?'on':''}"><input type="checkbox" ${on?'checked':''} onchange="toggleSkillLoadout('${cid}','${sid}',this.checked)"><span><b>${sk.name}</b><small>${sk.desc} · 기 ${masteryCost(sid)}<br>${masteryProgress(sid)} · 실제 효과: ${masteryEffectText(sid)}</small></span></label>`;}).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="skill-modal"><div class="modal"><h3>무공 편성 — ${c.name}</h3><p class="modal-note">출전 무공은 최대 3개입니다. 서로 다른 초식을 잇으면 연계 피해가 상승합니다.</p><div class="skill-picks">${rows}</div><div class="btnrow"><button class="btn" onclick="closeSkillLoadout()">완료</button></div></div></div>`);
}
function openInternalLoadout(cid){
  const c=CHARS[cid],options=internalOptions(cid);if(!options.length)return;
  const available=availableInternalOptions(cid),selected=selectedInternal(cid);
  if(selected)SESSION.campaignState.internalLoadouts[cid]=selected;
  const level=SESSION.campaignState.roster[cid]?.lvl||1;
  const rows=options.map(id=>{const item=INTERNALS[id],on=id===selected,state=internalUnlockState(item,SESSION.campaignState),locked=!available.includes(id);return `<label class="skill-pick internal-pick ${on?'on':''} ${locked?'locked':''}"><input type="radio" name="inner-${cid}" ${on?'checked':''} ${locked?'disabled':''} onchange="setInternalLoadout('${cid}','${id}')"><span><b>${item.kind} · ${item.name}</b><em>${locked?`사건 해금`:item.role}</em><small>${item.desc}<br><strong>실제 효과: ${internalEffectText(id)}</strong><br>${locked?`<mark>해금 조건: ${state.label}</mark><br>`:''}원작 근거: ${item.source}</small></span></label>`;}).join('');
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-back" id="internal-modal"><div class="modal internal-modal"><h3>내공·특성 편성 — ${c.name}</h3><p class="modal-note">현재 Lv.${level}. 레벨이 아니라 원작 사건을 완료한 순서대로 무학이 열립니다. ‘특성’은 가공 내공명이 아닙니다.</p><div class="skill-picks">${rows}</div><div class="btnrow"><button class="btn" onclick="closeInternalLoadout()">완료</button></div></div></div>`);
}
function setInternalLoadout(cid,id){
  if(!availableInternalOptions(cid).includes(id))return;
  SESSION.campaignState.internalLoadouts[cid]=id;v2Save();
  const m=document.getElementById('internal-modal');if(m)m.remove();openInternalLoadout(cid);
}
function closeInternalLoadout(){const m=document.getElementById('internal-modal');if(m)m.remove();v2Save();renderCamp();}
function toggleSkillLoadout(cid,sid,on){
  const list=SESSION.campaignState.skillLoadouts[cid]=SESSION.campaignState.skillLoadouts[cid]||[];
  if(on&&!list.includes(sid)){ if(list.length>=3){ SFX.play('miss'); openSkillLoadoutRefresh(cid); return; } list.push(sid); }
  if(!on){ const i=list.indexOf(sid); if(i>=0) list.splice(i,1); }
  if(!list.length) list.push(sid);
  v2Save(); openSkillLoadoutRefresh(cid);
}
function openSkillLoadoutRefresh(cid){ const m=document.getElementById('skill-modal'); if(m)m.remove(); openSkillLoadout(cid); }
function closeSkillLoadout(){ const m=document.getElementById('skill-modal'); if(m)m.remove(); v2Save(); renderCamp(); }
function unlocked(id){
  const base=(CAMPAIGNS[id].requireAll||[]).every(campCleared);
  if(id!=='jinfinal'||!base)return base;
  return !!v2LoadSave('jinfinal')||currentEndgameProgress().ready;
}
function campCard(id, badge){
  const C=CAMPAIGNS[id], sv=v2LoadSave(id), meta=CAMPAIGN_META[id]||{};
  const cleared=campCleared(id);
  return `<div class="camp-card">
    <div class="camp-meta"><span>${meta.canon||'캠페인'}</span><span>${meta.era||''}</span></div>
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
  const reportRows=BATTLE_REPORTS.slice(0,6).map(report=>{const ace=report.members?.[0];return `<div class="battle-report-row"><b>${escHtml(report.title)}</b><span>${report.turn}턴 · ${ace?`최고 기여 ${ace.name} ${ace.score}`:'기록 없음'}</span><small>${new Date(report.at).toLocaleString('ko-KR')}</small></div>`;}).join('');
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
    <section class="battle-report-box"><div><h3>최근 전투 분석</h3><p>피해·강기 파훼·회복 기여도를 최근 30전까지 기기에 저장합니다.</p></div><button class="btn small" onclick="exportBattleReports()" ${BATTLE_REPORTS.length?'':'disabled'}>JSON 내보내기</button><div class="battle-report-list">${reportRows||'<p>아직 완료한 전투 기록이 없습니다.</p>'}</div></section>
    <div class="achv-grid">${rows}</div>
    <div style="text-align:center;margin-top:14px"><button class="btn small" onclick="toTitle()">돌아가기</button></div>
  </div>`;
}
function showCampaignSelect(groupId='chronicles'){
  const group=CAMPAIGN_GROUPS.find(g=>g.id===groupId)||CAMPAIGN_GROUPS[0];
  const tabs=CAMPAIGN_GROUPS.filter(g=>g.id!=='archive').map(g=>
    `<button class="btn small ${g.id===group.id?'on':''}" onclick="showCampaignSelect('${g.id}')">${g.name}</button>`
  ).join('');
  const cards=group.campaigns.map(id=>unlocked(id)?campCard(id):lockedCard(id)).join('');
  app().innerHTML=`<div id="campsel" class="chronicle-screen">
    <div class="chronicle-head"><div><div class="eyebrow">江湖年代記</div><h2>${group.name}</h2><p>${group.desc}</p></div>
      <button class="btn small danger" onclick="toTitle()">타이틀</button></div>
    <div class="campaign-tabs">${tabs}</div>
    <div class="timeline-rail">${cards}</div>
  </div>`;
  requestAnimationFrame(animateChronicleScreen);
}
function showChallengeSelect(){
  const endgame=syncEndgameStore(),progress=endgame.progress,record=endgame.record;
  const best=bestWave();
  const roam=V3STORE.challenges.roam||{};
  const lunjian=V3STORE.challenges.lunjian||{};
  const trialMedals=V3STORE.challenges.trials?.medals||{};
  const trialGold=TRIALS.filter(trial=>trialMedals[trial.id]==='gold').length;
  app().innerHTML=`<div id="campsel" class="chronicle-screen">
    <div class="chronicle-head"><div><div class="eyebrow">武林 終章</div><h2>무림 종장과 도전</h2><p>본편·논검·파훼의 세 길을 완성해 마지막 시공 전장을 엽니다.</p></div>
      <button class="btn small danger" onclick="toTitle()">타이틀</button></div>
    <section class="endgame-board ${progress.ready?'ready':''}"><div class="endgame-board-head"><div><small>三印 集結</small><h3>영웅집결의 세 인장</h3><p>${progress.ready?'세 길의 증명이 모였습니다. 진최종전에서 강호의 마지막 장막을 여십시오.':`인장 ${progress.completed}/3 · 각 도전의 기록은 자동으로 합쳐집니다.`}</p></div><button class="btn small" onclick="showEndgameRecord()">종장록</button></div><div class="endgame-seals">${progress.seals.map(seal=>`<div class="endgame-seal ${seal.complete?'complete':''}"><i>${seal.complete?'印':seal.short}</i><b>${seal.name}</b><span>${seal.value}/${seal.target}</span><small>${seal.desc}</small></div>`).join('')}</div><div class="endgame-call"><span>계승 가호 ${Math.min(3,record.legacyPoints||0)*200}냥 · 대환단 ${Math.min(3,record.legacyPoints||0)}개${progress.perfect?' · 완전 제패':''}</span><button class="btn" onclick="showCampaignSelect('finale')" ${progress.ready?'':'disabled'}>${progress.ready?'진최종전으로':'인장 3개 필요'}</button></div></section>
    <div class="challenge-grid">
      <div class="camp-card challenge-card"><div class="camp-meta"><span>반복 도전</span><span>비정사</span></div><h3>영웅집결 무한 모드</h3>
        <p>전 영웅을 이끌고 강해지는 적의 파도에 맞섭니다. 3파마다 강적이 출현합니다.</p>
        <button class="btn" onclick="startEndless()">도전하기${best?` · 최고 ${best}파`:''}</button></div>
      <div class="camp-card"><div class="camp-meta"><span>8관 연전</span><span>비정사</span></div><h3>천하논검</h3><p>네 협객을 편성해 여덟 관주의 전용 초식을 파훼합니다. 관문마다 심법을 골라 자신만의 논검 부대를 완성합니다.</p><button class="btn" onclick="showLunjianStart()">${lunjian.current?'이어하기 / 새 논검':'논검 시작'}${lunjian.bestRound?` · 최고 ${lunjian.bestRound}/8관`:''}</button>${lunjian.records?.length?`<button class="btn small" onclick="showLunjianRecords()">논검록 ${lunjian.records.length}</button>`:''}</div>
      <div class="camp-card"><div class="camp-meta"><span>고정 전술 10제</span><span>비정사</span></div><h3>전투 수수께끼</h3><p>고정된 협객과 확정 명중 규칙으로 파훼·제압·점거·탈출의 해법을 찾습니다. 금·은·동 최고 기록이 보존됩니다.</p><button class="btn" onclick="showTrialSelect()">수수께끼 풀기 · 금 ${trialGold}/${TRIALS.length}</button></div>
      ${campCard('chronicle','19전 압축')}
      <div class="camp-card challenge-card"><div class="camp-meta"><span>시드 원정</span><span>비정사</span></div><h3>강호유람</h3><p>네 협객으로 12~15개 노드의 격전·기연·객잔·장터·문파 사건을 지나 천하 고수에게 도전합니다. 완주 기록은 별호와 흉터를 지닌 강호전설로 남습니다.</p><button class="btn" onclick="showRoamStart()">${roam.current?'이어하기 / 새 유람':'유람 시작'}${roam.best?` · 최고 ${roam.best}노드`:''}</button>${roam.legends?.length?`<button class="btn small" onclick="showRoamLegends()">강호전설 ${roam.legends.length}</button>`:''}</div>
    </div>
  </div>`;
  requestAnimationFrame(animateChronicleScreen);
}


/* ── 행낭(인벤토리) 모달 ── */
function invRowsHTML(){
  const eqBy={};
  for(const cid in (SESSION.campaignState.equips||{})){
    const e=SESSION.campaignState.equips[cid];
    for(const k of ['w','a']) if(e[k]) (eqBy[e[k]]=eqBy[e[k]]||[]).push(CHARS[cid].name);
  }
  const ids=[...new Set([...Object.keys(SESSION.campaignState.inv),...Object.keys(eqBy)])];
  if(!ids.length) return `<tr><td colspan="2" style="color:var(--dim)">행낭이 비었습니다</td></tr>`;
  const kindName={weapon:'병기',acc:'보구',use:'영약',key:'비급'};
  return ids.map(id=>{
    const it=ITEMS[id];
    return `<tr><td style="text-align:left;white-space:nowrap"><b>${it.name}</b>${SESSION.campaignState.inv[id]?` ×${SESSION.campaignState.inv[id]}`:''}<div style="font-size:11px;color:var(--dim)">${kindName[it.kind]||''}</div></td>
      <td style="text-align:left;font-size:12.5px;color:var(--dim)">${it.desc}${eqBy[id]?`<br><span style="color:var(--gold2)">장착 중: ${eqBy[id].join(' · ')}</span>`:''}</td></tr>`;
  }).join('');
}
function openInvModal(){
  if(!SESSION.campaignState) return;
  const html=`<div class="modal-back" id="inv-modal" onclick="if(event.target===this)this.remove()">
    <div class="modal"><h3>행낭 · 소지금 <span style="color:var(--gold2)">${SESSION.campaignState.gold}냥</span></h3>
    <table class="camptable">${invRowsHTML()}</table>
    <div class="btnrow"><button class="btn" onclick="document.getElementById('inv-modal').remove()">닫기</button></div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

/* ── 전투 중 장비 교체 (즉시 반영, 행동 미소모) ── */
function equipOpts(cid,k){
  const kind=k==='w'?'weapon':'acc';
  const eq=SESSION.campaignState.equips[cid]=SESSION.campaignState.equips[cid]||{w:null,a:null};
  let o=`<option value="">— 없음 —</option>`;
  for(const id in ITEMS){
    if(ITEMS[id].kind!==kind) continue;
    if(eq[k]===id) o+=`<option value="${id}" selected>${ITEMS[id].name} (장착 중)</option>`;
    else if((SESSION.campaignState.inv[id]||0)>0) o+=`<option value="${id}">${ITEMS[id].name} ×${SESSION.campaignState.inv[id]}</option>`;
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
  const eq=SESSION.campaignState.equips[cid]=SESSION.campaignState.equips[cid]||{w:null,a:null};
  const oldId=eq[slot]||null;
  if(oldId===(id||null)) return;
  if(oldId){ SESSION.campaignState.inv[oldId]=(SESSION.campaignState.inv[oldId]||0)+1; eq[slot]=null; }
  if(id){
    if((SESSION.campaignState.inv[id]||0)<=0) return;
    SESSION.campaignState.inv[id]--; if(SESSION.campaignState.inv[id]<=0) delete SESSION.campaignState.inv[id];
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
  importClassicAsChronicle();
  buildPortraitDefs();
  initModalAccessibility();
  showTitle();
}
/* 자동 테스트용 디버그 훅 (게임 로직에는 미사용) */
export const DEBUG = {
  get B(){ return B; },
  get campaignState(){ return SESSION.campaignState; },
  get challengeState(){ return SESSION.challengeState; },
  get G(){ return G; },
  winCheck(){ return checkEnd(); },
  calc(a,d,skill){ return calcStrike(a,d,skill); },
  adjBond(u){ return adjBond(u); },
  runtimeContext(){ return runtimeContext(); },
  portraitMarkup(cid='gj',expression='calm'){ return ptSVG(cid,'',expression); },
  premiumPortraitURL(cid='gj',size='hero',expression='calm'){ return premiumPortraitURL(cid,size,expression); },
  objectiveProbe(objective,context){ return {won:resolveObjectiveWon(objective,context),progress:resolveObjectiveProgress(objective,context)}; },
  reputationProbe(reputation,factions={}){ return {
    combat:reputationCombatEffects(reputation,factions), price:shopPriceFor(100,reputation),
    loot:lootMultiplier(reputation), bond:bondRankWithReputation(1,reputation), perks:reputationPerks(reputation),
  }; },
  relationshipProbe(score=2,cid='gj'){ return {faction:factionRelationTier(score),trust:characterTrustTier(score),effects:characterTrustEffects({[cid]:score},cid)}; },
  masteryProbe(sid='seoncheon',uses=0){ return masteryInfo(sid,uses); },
  internalProbe(cid='gj',id=null){const selected=validInternal(cid,id);return {selected,item:internalById(selected),options:internalOptions(cid),effectText:internalEffectText(selected)};},
  internalUnlockProbe(id,campaign){return internalUnlockState(internalById(id),campaign);},
  growthRewardsProbe(before,after,roster=[]){return newlyUnlockedInternals(before,after,roster).map(({cid,id,item})=>({cid,id,name:item.name,effectText:internalEffectText(id)}));},
  promotionStatusProbe(cid,campaign,level=99,inventory={}){const promo=CHARS[cid]?.promo,status=promotionStatus(promo,{level,inventory,campaign});return {status,requirements:promotionRequirementParts(promo,{itemName:promo?.item?ITEMS[promo.item]?.name:'',status}),text:promo?promotionEffectText(promo):''};},
  promotionRewardsProbe(before,after,roster=[]){return newlyUnlockedPromotions(before,after,CHARS,roster).map(({cid,promo})=>({cid,cls:promo.cls,text:promotionEffectText(promo)}));},
  environmentProbe(definition,bounds={w:10,h:8},units=[]){const initial=createBattleEnvironment(definition,bounds),next=advanceBattleEnvironment(initial,{passable:(x,y)=>x>=0&&y>=0&&x<bounds.w&&y<bounds.h});return {initial,next,effects:resolveEnvironmentEffects(next,units,{passable:(x,y)=>x>=0&&y>=0&&x<bounds.w&&y<bounds.h}),summary:environmentSummary(next)};},
  installEnvironment(definition){if(!B)return null;B.environment=createBattleEnvironment(definition,{w:B.w,h:B.h});refreshEnemyIntents();renderBattle();return deepClone(B.environment);},
  advanceEnvironment(){if(!B)return null;const effects=applyBattleEnvironmentRound();refreshEnemyIntents();renderBattle();return {effects:deepClone(effects),environment:deepClone(B.environment)};},
  damageEnvironmentGate(gateId,amount=1){if(!B)return null;const result=damageEnvironmentGate(B.environment,gateId,amount);B.environment=result.environment;refreshEnemyIntents();renderBattle();return deepClone(result);},
  enemyMartialProbe(cid='oyb',context={}){const style=enemyMartialByCid(cid);return {style,counter:enemyMartialCounter(style,context),effectText:enemyMartialEffectText(style)};},
  martialRuleProbe(context){return martialModifiers(context);},
  bossActionProbe(action={},context={}){
    const unit=context.unit||{uid:'boss-probe',cid:'boss',name:'강적',boss:true,x:6,y:3};
    const targets=context.targets||[{uid:'hero-probe',cid:'hero',name:'협객',team:'P',alive:true,x:2,y:3,hp:20,maxhp:20}];
    const plan=createBossActionPlan({unit,action,targets,bounds:context.bounds||{w:10,h:7},turn:context.turn||1,sequence:0});
    const first=bossPlanIntent(plan),charged=advanceBossPlan(plan),ready=charged.plan?bossPlanIntent(charged.plan):null;
    const counter=applyBossCounter(charged.plan||plan,context.reason||'간파 시험');
    return {plan,first,charged,ready,counter:{...counter,intent:counter.plan?bossPlanIntent(counter.plan):null}};
  },
  installBossActions(cid,actions){
    const unit=B?.units.find(item=>item.cid===cid&&item.team==='E');if(!unit)return null;
    unit.boss=true;unit.wait=0;unit.bossActions=deepClone(actions||[]);unit.bossActionState={index:0,pending:null,cooldown:0};
    refreshEnemyIntents();renderBattle();return deepClone(enemyIntent(unit));
  },
  disruptBossAction(cid,reason='간파 시험'){
    const unit=B?.units.find(item=>item.cid===cid&&item.team==='E');if(!unit)return null;
    const result=disruptBossAction(unit,reason);refreshEnemyIntents();renderBattle();
    return {...result,intent:deepClone(enemyIntent(unit)),state:deepClone(unit.bossActionState)};
  },
  async performBossAction(cid){
    const unit=B?.units.find(item=>item.cid===cid&&item.team==='E');if(!unit)return null;
    ensureBossActionPlan(unit);await performBossActionTurn(unit);refreshEnemyIntents();renderBattle();
    return deepClone(unit.bossActionState);
  },
  inspectUnit(cid){const u=B?.units.find(item=>item.cid===cid);if(!u)return false;UCARD_HIDE=false;B.inspect=u;B.tileSel={x:u.x,y:u.y};renderSide();return true;},
  previewImpactFeedback(){if(!B)return [];const unit=players()[0]||foes()[0];if(!unit)return [];const samples=[['17','damage'],['31','crit'],['+12','heal'],['회피!','miss'],['강기 -4','guard'],['破 파훼!','break']];samples.forEach(([text,kind],index)=>fx(unit.x+(index%3)*.28,unit.y-Math.floor(index/3)*.35,text,kind));return samples.map(([text,kind])=>({text,kind}));},
  battleReports(){return deepClone(BATTLE_REPORTS);},
  promotionProbe(cid='wjy'){ const p=CHARS[cid]&&CHARS[cid].promo; return p?{...p,text:promotionEffectText(p)}:null; },
  saveValidation(input){ const result=validateV3(input); return {valid:result.valid,issues:result.issues,store:result.store}; },
  backupProbe(){ return createBackupPayload(localStorage); },
  backupInspection(input){ const result=inspectBackupPayload(input); return {ok:result.ok,count:result.count,issues:result.issues}; },
  backupRestore(input){ const result=restoreBackupPayload(input,localStorage); return {ok:result.ok,count:result.count,issues:result.issues}; },
  checkpointProbe(){ return deepClone(V3STORE.checkpoints||{latest:null,history:[]}); },
  roamProbe(){ return deepClone(V3STORE.challenges.roam||{}); },
  challengeProbe(){ return {lunjian:deepClone(V3STORE.challenges.lunjian||{}),trials:deepClone(V3STORE.challenges.trials||{}),rounds:LUNJIAN_ROUNDS.length,trialCount:TRIALS.length}; },
  endgameProbe(){const progress=currentEndgameProgress(),record=deepClone(V3STORE.challenges.endgame||{});return {progress,record,blessing:endgameBlessing(record)};},
  sessionContext(){ return {context:runtimeContext(),outcome:SESSION.outcome(),campaign:SESSION.campaign()?.camp||null,challenge:SESSION.challenge()?.mode||null}; },
  openCurrentDeploy(){ const node=curNode(); if(node?.kind==='battle') v2Deploy(node); },
  forceDefeat(){ if(B){ B.over=true; showDefeat(); } },
  previewCutin(){ const a=players()[0],sid=a&&a.skills[0]; if(a&&sid) void showMartialCutin(a,SKILLS[sid]); },
  CHAPTERS, CHARS, SKILLS, ITEMS, SUPPORTS, INTERNALS, HERO_INTERNALS, ENEMY_MARTIALS, CAMPAIGNS, DISCOVERED_CAMPAIGN_IDS,
};

export const GLOBALS = {
  menuAct, confirmAttack, cancelForecast, endPlayerPhase, showHelp, confirmToTitle,
  uiCancel, cycleZoom, toggleThreats, toggleDeploy, startBattle, newGame, continueGame,
  showChapterSelect, jumpChapter, startEndless, nextWave, toTitle, retryChapter, afterVictory,
  showRoamStart, startRoamFromInput, resumeRoam, showRoamMap, enterRoamNode, roamChoice,
  showRoamShop, roamBuyRelic, showRoamFaction, roamFactionChoice, advanceRoamNode, showRoamLegends,
  showLunjianStart, toggleLunjianPick, setLunjianInternal, beginLunjian, resumeLunjian, showLunjianMap, enterLunjianRound, saveLunjian, lunjianChoose, showLunjianRecords,
  showTrialSelect, showTrialBrief, startTrial,
  showCampaignSelect, showChallengeSelect, showEndgameRecord, startCampaignV2, showRouteMap, v2Enter, pickChoice,
  v2Buy, v2Sell, v2Equip, v2Promote, v2Depart, v2AfterBattle, v2UseTool, closeToolMenu,
  campTab, campBack, campFromDeploy, campFromRoute,
  openSkillLoadout, toggleSkillLoadout, closeSkillLoadout, openInternalLoadout, setInternalLoadout, closeInternalLoadout, autoCampLoadout, showRewindHistory, rewindHistory,
  showRelationshipLedger,
  openInvModal, closeEquipModal, battleEquip, sndToggleUI,
  toggleInfoPop, hideUcard, showSaveHub, hubContinue, saveHubResume, resumeLastSession, showSaveHealth, restoreCampaignCheckpoint, viewSupport,
  showSettings, setDiff, setSpeed, toggleFastEnemy, toggleReducedFx,
  showAchievements, chooseNgPlus, ngStart,
  exportSave, exportBattleReports, triggerImport,
};
