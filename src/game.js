import { TS, TILE, SKILLS, CHARS, CHAPTERS, ENDING, ENEMY_IDS, TYPE_NAME, triangle } from './data.js';
import { buildPortraitDefs, ptSVG, tileSVG, unitSVG, titleArtSVG } from './gfx.js';

/* ============================================================
   전투 엔진
   ============================================================ */

const G = { chapterIdx:0, roster:{}, party:[], snapshot:null, extraSkills:{}, deploy:null };
let B = null;       // 현재 전투 상태
let ENDLESS = null; // 영웅집결 무한 모드 상태 {wave, ch}
let uidSeq = 0;

/* 현재 챕터(스토리) 또는 현재 웨이브(무한 모드) 정의 반환 */
function curCh(){ return ENDLESS ? ENDLESS.ch : CHAPTERS[G.chapterIdx]; }

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
  return {uid:'u'+(uidSeq++), cid, name:c.name, cls:c.cls, type:c.type, range:c.range,
    skills:[...c.skills, ...extra], healer:!!c.healer, leader:!!c.leader, team:'P',
    x, y, stats:deepClone(r.stats), maxhp:r.stats.hp, hp:r.stats.hp,
    maxki:r.stats.ki, ki:r.stats.ki, lvl:r.lvl, exp:r.exp, acted:false, alive:true, boss:false, poison:0};
}
function mkEnemyUnit(def){
  const c=CHARS[def.cid], st=statObj(c.base);
  if(def.boost) for(const k in st) st[k]=Math.round(st[k]*def.boost);
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
  let dmg=Math.max(0, Math.round(atk*(sk&&sk.mult?sk.mult:1)) + tri*2 + supA - mit - dT.def);
  let hit=Math.max(10, Math.min(100, 82 + a.stats.skl*2 + tri*10 + (sk&&sk.hit?sk.hit:0) + supA*4 - supD*3 - d.stats.spd*2 - dT.avoid));
  let crit=Math.max(0, 4 + a.stats.skl - d.stats.skl);
  const dbl=!sk && (a.stats.spd>=d.stats.spd+4);
  return {dmg,hit,crit,dbl,tri,supA,supD};
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
  b.textContent=txt; b.className='show'+(enemy?' enemy':'');
  await sleep(950); b.className='';
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
  u.exp+=amt;
  while(u.exp>=100){
    u.exp-=100; u.lvl++;
    const ups=rollLevel(u);
    fx(u.x,u.y,'LEVEL UP!','label');
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
  if(sk&&!followup){ a.ki-=sk.cost; fx(a.x,a.y,sk.name,'label'); await sleep(420); }
  const roll=Math.random()*100;
  document.getElementById('mapwrap').classList.add('shake');
  setTimeout(()=>{const m=document.getElementById('mapwrap'); if(m) m.classList.remove('shake');},380);
  if(roll<c.hit){
    let dmg=c.dmg;
    const isCrit=Math.random()*100<c.crit;
    if(isCrit) dmg=Math.round(dmg*1.6);
    d.hp=Math.max(0,d.hp-dmg);
    fx(d.x,d.y,dmg,isCrit?'crit':'');
    if(isCrit) log(`${a.name}의 <b>필살!</b> ${d.name}에게 ${dmg} 피해`);
    else log(`${a.name} → ${d.name} ${dmg} 피해`);
    grantExp(a, 8 + (sk?2:0));
    if(sk&&sk.poison&&d.hp>0&&!d.poison){
      d.poison=3; fx(d.x,d.y,'중독!','label');
      log(`${d.name}이(가) <b>중독</b>되었다! (3턴간 지속 피해)`,true);
    }
    if(d.hp<=0){
      d.alive=false;
      fx(d.x,d.y,'격파!','label');
      if(d.team==='E'){
        grantExp(a, 30 + Math.max(0,(d.lvl-a.lvl))*4 + (d.boss?40:0));
        log(`<b>${d.name} 격파!</b>`,true);
      }else{
        log(`<b>${d.name}이(가) 부상으로 이탈했다…</b>`,true);
      }
    }
  }else{
    fx(d.x,d.y,'회피!','miss');
    log(`${a.name}의 공격, ${d.name}이(가) 회피`);
  }
  renderBattle(true);
  await sleep(520);
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
  const sk=SKILLS[skillId||a.skills[0]];
  a.ki-=sk.cost;
  const amt=a.stats.int+sk.healPow;
  t.hp=Math.min(t.maxhp,t.hp+amt);
  fx(a.x,a.y,sk.name,'label');
  await sleep(380);
  fx(t.x,t.y,'+'+amt,'heal');
  log(`${a.name}의 ${sk.name} — ${t.name} ${amt} 회복`);
  grantExp(a,14);
  renderBattle(true);
  await sleep(450);
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
      if(pos){ B.sel.x=pos.x; B.sel.y=pos.y; B.mode='menu'; renderBattle(); openForecast(B.sel,u,null); return; }
      clearSel(); inspectEnemy(u); return;
    }
    if(B.mr.has(k)&&stoppable(B.sel,x,y)){
      B.sel.x=x; B.sel.y=y; B.mode='menu'; renderBattle(); openMenu();
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
    if(u.ki<sk.cost) return;
    if(sk.heal){
      const hurt=players().filter(p=>p!==u&&u.range.includes(dist(u,p))&&p.hp<p.maxhp);
      if(hurt.length) html+=`<button class="btn" onclick="menuAct('heal',${i})">${sk.name} <span style="color:#6ab0ce;font-size:12px">기${sk.cost}</span></button>`;
    }else if(enemiesNear.length){
      html+=`<button class="btn" onclick="menuAct('skill',${i})">${sk.name} <span style="color:#6ab0ce;font-size:12px">기${sk.cost}</span></button>`;
    }
  });
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
  const u=B.sel;
  if(act==='cancel'){ clearSel(); return; }
  if(act==='wait'){ hideMenu(); finishUnit(u); return; }
  hideMenu();
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
  const html=`
  <div class="modal-back" id="fc-modal">
    <div class="modal">
      <h3>전투 예측 ${sk?`— ${sk.name}`:''}</h3>
      <div class="fc-grid">
        <div class="hd">${a.name}${my.supA?` <span style="font-size:11px;color:#8fce6a">협공+${my.supA}</span>`:''}</div><div class="lbl">상성 ${triTxt}</div><div class="hd">${d.name}${my.supD?` <span style="font-size:11px;color:#8fce6a">협공+${my.supD}</span>`:''}</div>
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
      if(best.x!==u.x||best.y!==u.y){ u.x=best.x; u.y=best.y; renderBattle(true); await sleep(300); }
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
        if(bt&&(bt.x!==u.x||bt.y!==u.y)){ u.x=bt.x; u.y=bt.y; renderBattle(true); await sleep(220); }
      }
    }
  }
  if(B&&!B.over) startPlayerPhase(false);
}

/* ── 전투 시작 ── */
function startBattle(){
  const ch=curCh();
  const map=ch.map.map(r=>{
    let s=r;
    while(s.length<14) s+='.';
    return s.slice(0,14);
  });
  B={
    map, w:14, h:map.length,
    units:[], turn:1, phase:'P', mode:'idle',
    sel:null, orig:null, mr:null, targets:null, inspect:null, tileSel:null,
    busy:true, over:false, log:[], pending:null, reinfDone:[], skillIdx:null,
  };
  const cap=Math.min(ch.spawns.length,12);
  const lineup=(G.deploy&&G.deploy.length?G.deploy:G.party).filter(cid=>G.roster[cid]).slice(0,cap);
  lineup.forEach((cid,i)=>{
    const [x,y]=ch.spawns[i];
    B.units.push(mkPlayerUnit(cid,x,y));
  });
  for(const def of ch.enemies) B.units.push(mkEnemyUnit(def));
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
  let sc = MAPZOOM===0 ? fit : Math.min(2, fit*MAPZOOM);
  CURSCALE=sc;
  wrap.style.transform=`scale(${sc})`;
  sizer.style.width=(mw*sc)+'px';
  sizer.style.height=(mh*sc)+'px';
}
function cycleZoom(){
  MAPZOOM = MAPZOOM===0 ? 1.5 : (MAPZOOM===1.5 ? 2 : 0);
  const z=document.getElementById('tb-zoom');
  if(z) z.textContent = MAPZOOM===0 ? '자동' : ('×'+MAPZOOM);
  fitMap();
}
function uiCancel(){
  if(!B||B.busy) return;
  if(B.mode!=='idle') clearSel();
  else if(B.inspect){ B.inspect=null; B.mr=null; renderBattle(); }
}
window.addEventListener('resize',()=>{ if(B) fitMap(); });

/* ── 전투 화면 골격 ── */
function renderScreenBattle(){
  const mw=14*TS, mh=curCh().map.length*TS;
  app().innerHTML=`
  <div id="battle">
    <div id="mapcol">
      <div id="topbar">
        <span id="tb-info"></span>
        <span style="flex:1"></span>
        <button class="btn small" id="tb-cancel" onclick="uiCancel()">취소</button>
        <button class="btn small" onclick="cycleZoom()">배율 <span id="tb-zoom">${MAPZOOM===0?'자동':'×'+MAPZOOM}</span></button>
        <button class="btn small" id="tb-end" onclick="endPlayerPhase()">턴 종료</button>
      </div>
      <div id="mapscroll"><div id="mapsizer">
        <div id="mapwrap" style="width:${mw}px;height:${mh}px">
          <svg id="mapsvg" width="${mw}" height="${mh}"></svg>
          <div id="fx"></div>
          <div id="banner"></div>
        </div>
      </div></div>
    </div>
    <div id="side"></div>
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
  fitMap();
  renderBattle();
}

/* ── 전투 렌더 (svg + 사이드) ── */
function renderBattle(light){
  if(!B) return;
  const svg=document.getElementById('mapsvg');
  if(!svg) return;
  let s='';
  for(let y=0;y<B.h;y++) for(let x=0;x<B.w;x++) s+=tileSVG(tileChar(x,y),x,y);

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
  if(B.sel&&B.sel.alive) s+=unitSVG(B.sel);
  svg.innerHTML=s;
  renderSide();
}

function statRow(lbl,val){ return `<div>${lbl} <b>${val}</b></div>`; }
function renderSide(){
  const side=document.getElementById('side');
  if(!side) return;
  const ch=curCh();
  const u=B.sel||B.inspect||(B.tileSel?unitAt(B.tileSel.x,B.tileSel.y):null);
  let card='<div style="color:var(--dim);padding:14px 4px;text-align:center;">유닛을 선택하세요</div>';
  if(u){
    const hpPct=Math.round(u.hp/u.maxhp*100), kiPct=Math.round(u.ki/u.maxki*100);
    card=`
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
      ${statRow('방어',u.stats.def)}${statRow('정신',u.stats.res)}${statRow('속도',u.stats.spd)}
      ${statRow('이동',u.stats.mov)}${statRow('사거리',u.range.join('·'))}<div></div>
    </div>
    ${u.skills.map(sid=>{const sk=SKILLS[sid];return `<div class="uc-skill">◆ ${sk.name} — ${sk.desc} (기 ${sk.cost})</div>`;}).join('')}`;
  }
  let terr='';
  if(B.tileSel){
    const T=TILE[tileChar(B.tileSel.x,B.tileSel.y)];
    terr=`지형: <b>${T.name}</b> — 회피 +${T.avoid} · 방어 +${T.def}${T.heal?' · 매턴 HP 회복':''}`;
  }
  const surviveTxt = ch.win.type==='survive' ? `<div class="row"><span>남은 방어</span><b>${Math.max(0,ch.win.turns-B.turn+1)}턴</b></div>` : '';
  side.innerHTML=`
  <div class="panel" id="chinfo">
    <div class="ch-t">${ch.title}</div>
    <div class="row"><span>턴</span><b>${B.turn}</b></div>
    <div class="row"><span>페이즈</span><b>${B.phase==='P'?'아군':'적군'}</b></div>
    <div class="row"><span>승리</span><b>${ch.win.text}</b></div>
    ${surviveTxt}
    <div class="row"><span>패배</span><b>${ch.lose}</b></div>
    <div class="row"><span>병력</span><b>아군 ${players().length} · 적 ${foes().length}</b></div>
  </div>
  <div class="panel" id="unitcard">${card}</div>
  <div class="panel" id="terrinfo">${terr||'타일을 클릭하면 지형 정보가 표시됩니다'}</div>
  <div id="sidebtns">
    <button class="btn small" onclick="endPlayerPhase()" ${B.phase!=='P'||B.busy?'disabled':''}>턴 종료</button>
    <button class="btn small" onclick="showHelp()">도움말</button>
    <button class="btn small danger" onclick="confirmToTitle()">타이틀로</button>
  </div>
  <div class="panel"><div id="log">${B.log.map(l=>`<div class="${l.imp?'imp':''}">${l.msg}</div>`).join('')}</div></div>`;
  /* 상단 바 갱신 */
  const tbi=document.getElementById('tb-info');
  if(tbi) tbi.innerHTML=`${B.turn}턴 · ${B.phase==='P'?'아군':'<span style="color:#e09080">적군</span>'} 페이즈 · 적 ${foes().length}`;
  const te=document.getElementById('tb-end'); if(te) te.disabled=(B.phase!=='P'||B.busy);
  const tc=document.getElementById('tb-cancel'); if(tc) tc.disabled=(B.mode==='idle'&&!B.inspect);
}

/* ── 대화 화면 ── */
function dlgBgSVG(){
  return `<svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
  <defs><linearGradient id="dsky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2a2440"/><stop offset=".6" stop-color="#4a3a50"/><stop offset="1" stop-color="#8a6248"/>
  </linearGradient></defs>
  <rect width="1000" height="600" fill="url(#dsky)"/>
  <circle cx="780" cy="110" r="55" fill="#f0e0b8" opacity=".75"/>
  <path d="M0,430 L160,300 L300,410 L430,280 L580,440 L1000,420 L1000,600 L0,600 Z" fill="#332a44" opacity=".9"/>
  <path d="M300,470 L520,340 L700,460 L850,380 L1000,470 L1000,600 L300,600 Z" fill="#241e30"/>
  <path d="M0,500 Q500,470 1000,505 L1000,600 L0,600 Z" fill="#171220"/>
  <g stroke="#171220" stroke-width="3" opacity=".7">
    <path d="M120,470 q0,-45 6,-60 M126,410 q-14,10 -24,8 M126,410 q12,8 22,6" fill="none"/>
    <ellipse cx="126" cy="398" rx="16" ry="10" fill="#243020" stroke="none"/>
  </g>
  </svg>`;
}
let DLG=null;
function showDialogue(lines, done, titleCard){
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
  const tc=document.getElementById('dlg-tc');
  if(tc){ tc.remove(); if(DLG.idx===-1){ DLG.idx=0; showDlgLine(); } return; }
  DLG.idx++;
  if(DLG.idx>=DLG.lines.length){ const d=DLG.done; DLG=null; d(); return; }
  showDlgLine();
}
function showDlgLine(){
  const L=DLG.lines[DLG.idx];
  const nameEl=document.getElementById('dlg-name'), textEl=document.getElementById('dlg-text');
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
  ENDLESS=null;
  G.chapterIdx=idx;
  const ch=CHAPTERS[idx];
  for(const cid of ch.joins) initRosterChar(cid);
  G.snapshot=deepClone({roster:G.roster, party:G.party, extra:G.extraSkills});
  const go=()=>{ if(idx===0) startBattle(); else showDeploy(); };
  if(skipPre) go();
  else showDialogue(ch.pre, go, ch.title);
}

/* ── 출전 준비 화면 ── */
function showDeploy(){
  const ch=curCh();
  const cap=Math.min(ch.spawns.length,12);
  if(!G.deploy) G.deploy=[];
  G.deploy=G.deploy.filter(cid=>G.party.includes(cid));
  for(const cid of G.party){ if(G.deploy.length<cap&&!G.deploy.includes(cid)) G.deploy.push(cid); }
  const leader=G.party.find(cid=>CHARS[cid].leader);
  if(leader&&!G.deploy.includes(leader)){ G.deploy.unshift(leader); G.deploy=G.deploy.slice(0,cap); }
  renderDeploy(cap);
}
function renderDeploy(cap){
  const ch=curCh();
  app().innerHTML=`<div id="deploy">
    <h2>${ch.title} — 출전 준비</h2>
    <div class="dep-sub">출전할 협객을 선택하세요 (<b id="dep-n">${G.deploy.length}</b>/${cap}명) · ★곽정은 반드시 출전 · 승리 조건: ${ch.win.text}</div>
    <div class="dep-grid">${G.party.map(cid=>{
      const r=G.roster[cid], c=CHARS[cid], on=G.deploy.includes(cid), lock=!!c.leader;
      return `<div class="dep-card ${on?'on':'off'} ${lock?'lock':''}" onclick="toggleDeploy('${cid}',${cap})">
        <div class="pt">${ptSVG(cid)}</div>
        <div class="dep-name">${c.name}${lock?' ★':''}</div>
        <div class="dep-info">Lv.${r.lvl} · ${TYPE_NAME[c.type]}</div>
      </div>`;}).join('')}</div>
    <div style="text-align:center">
      <button class="btn" onclick="startBattle()">출 전 !</button>
      <button class="btn small" style="margin-left:8px" onclick="showHelp()">도움말</button>
    </div>
  </div>`;
}
function toggleDeploy(cid,cap){
  if(CHARS[cid].leader) return;
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
function showVictory(){
  const ch=curCh();
  applyRoster();
  /* 무한 모드: 웨이브 클리어 */
  if(ENDLESS){
    const w=ENDLESS.wave;
    setBestWave(w);
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
    <h2 style="color:#ffd94a">勝 利</h2>
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
  if(ENDLESS){
    const w=ENDLESS.wave;
    setBestWave(w-1);
    app().innerHTML=`<div class="result-screen">
      <h2 style="color:#e07a5a">敗 北</h2>
      <p>영웅들은 제${w}파의 파도에 삼켜졌다…<br>
      이번 도달: <b>${w-1}파 격퇴</b> · 역대 최고 기록: <b style="color:var(--gold2)">${bestWave()}파</b></p>
      <button class="btn" onclick="startEndless()">처음부터 재도전</button>
      <button class="btn danger" onclick="toTitle()">타이틀로</button>
    </div>`;
    return;
  }
  app().innerHTML=`<div class="result-screen">
    <h2 style="color:#e07a5a">敗 北</h2>
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
  app().innerHTML=`<div class="result-screen">
    <h2>終 幕</h2>
    <p>${ENDING.join('<br>')}</p>
    <button class="btn" onclick="toTitle()">타이틀로</button>
  </div>`;
}

/* ── 저장/불러오기 ── */
const SAVE_KEY='kimyong_srpg_save_v1';
function saveGame(nextCh){
  try{
    const prev=loadGame();
    const ch=Math.max(nextCh, prev?(prev.ch||0):0); /* 회상 재도전 시 진행도 후퇴 방지 */
    localStorage.setItem(SAVE_KEY, JSON.stringify({ch, roster:G.roster, party:G.party, extra:G.extraSkills, deploy:G.deploy}));
  }catch(e){}
}
function loadGame(){
  try{
    const s=localStorage.getItem(SAVE_KEY);
    return s?JSON.parse(s):null;
  }catch(e){ return null; }
}
function loadState(s){
  G.roster=s.roster; G.party=s.party;
  G.extraSkills=s.extra||{}; G.deploy=s.deploy||null;
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
  for(let y=0;y<base.map.length;y++)for(let x=7;x<14;x++){
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
  /* 전 영웅 집결: 스토리 진행과 무관하게 모든 아군을 Lv.10으로 소집 */
  ENDLESS=null;
  G.chapterIdx=0; G.roster={}; G.party=[]; G.deploy=null;
  const allies=Object.keys(CHARS).filter(id=>!ENEMY_IDS.has(id));
  for(const cid of allies) initRosterChar(cid);
  for(const cid of G.party){ const r=G.roster[cid]; for(let i=1;i<10;i++) rosterLevelUp(r); }
  G.extraSkills={gj:['jwauhobak'], jmk:['geongon']};
  nextWave(1);
}
function nextWave(w){
  ENDLESS={wave:w, ch:makeEndlessWave(w)};
  showDeploy();
}

/* ── 타이틀 ── */
function toTitle(){ B=null; ENDLESS=null; showTitle(); }
function confirmToTitle(){ if(confirm('전투를 포기하고 타이틀로 돌아갈까요? (진행 상황은 챕터 시작 시점으로 돌아갑니다)')) toTitle(); }
function showTitle(){
  const hasSave=!!loadGame();
  app().innerHTML=`<div id="title-screen">
    ${titleArtSVG()}
    <div class="title-main">사조영웅전<span style="font-size:24px;color:var(--dim)"> ─ </span>강호의 별</div>
    <div class="title-sub">射鵰英雄傳 · 김용 무협 시뮬레이션 RPG</div>
    <div class="title-menu">
      <div><button class="btn" onclick="newGame()">새로운 협객행 (새 게임)</button></div>
      <div><button class="btn" onclick="continueGame()" ${hasSave?'':'disabled'}>이어하기</button></div>
      <div><button class="btn" onclick="showChapterSelect()" ${hasSave?'':'disabled'}>장 선택 (회상)</button></div>
      <div><button class="btn" onclick="startEndless()">영웅집결 무한 모드${bestWave()?` <span style="font-size:12px;color:var(--dim)">최고 ${bestWave()}파</span>`:''}</button></div>
      <div><button class="btn" onclick="showHelp()">유파 안내 (도움말)</button></div>
    </div>
    <div class="title-note">
      본 게임은 AI(Claude)가 제작한 김용(金庸) 원작 팬메이드 데모입니다.<br>
      전 19장: 사조영웅전 → 신조협려 → 의천도룡기 → 천룡팔부 + 영웅집결 무한 모드<br>
      PC · 모바일(터치) 지원 — 진행 상황은 챕터 클리어 시 자동 저장
    </div>
  </div>`;
}
function newGame(){
  G.chapterIdx=0; G.roster={}; G.party=[]; G.extraSkills={}; G.deploy=null;
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

/* ── 부팅 ── */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    const fm=document.getElementById('fc-modal');
    if(fm){ cancelForecast(); return; }
    const hm=document.getElementById('help-modal');
    if(hm){ hm.remove(); return; }
    if(B&&!B.busy&&B.mode!=='idle') clearSel();
  }
});
/* 부팅은 main.js 의 boot() 에서 수행 */

/* ── 부팅 및 전역(인라인 onclick) 노출 ── */
export function boot(){
  buildPortraitDefs();
  showTitle();
}
export const GLOBALS = {
  menuAct, confirmAttack, cancelForecast, endPlayerPhase, showHelp, confirmToTitle,
  uiCancel, cycleZoom, toggleDeploy, startBattle, newGame, continueGame,
  showChapterSelect, jumpChapter, startEndless, nextWave, toTitle, retryChapter, afterVictory,
};
