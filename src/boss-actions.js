/*
 * R20 보스 행동 엔진.
 *
 * 이 모듈은 DOM, 전투 세션, 난수에 의존하지 않는다. 보스의 표적과 경고 범위를
 * 한 번 고정한 뒤 같은 계획을 축력/발동 단계에서 재사용하므로, 화면에 보인 예고와
 * 실제 판정 타일이 달라지지 않는다.
 *
 * 데이터 스키마 (적 무학의 `actions`, 또는 스테이지의 `bossActions`):
 * {
 *   id: 'toad-burst', name: '합마축력',
 *   charge: { turns: 1, label: '독기를 모은다', stance: '축력' },
 *   target: 'nearest' | 'lowestHp' | 'leader',
 *   shape: { type: 'line'|'cross'|'cone'|'radius', range: 4,
 *            origin: 'self'|'target', spread: .5 },
 *   skill: 'optional-skill-id', power: 1.15, hitBonus: 10, cooldown: 1,
 *   counter: { mode: 'cancel'|'weaken', damageMultiplier: .55,
 *              shrink: 1, label: '경맥이 흐트러진다' }
 * }
 */

export const BOSS_SHAPES=Object.freeze(['line','cross','cone','radius']);

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const int=(value,fallback=0)=>Number.isFinite(Number(value))?Math.trunc(Number(value)):fallback;
const num=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const tile=(value,fallback={x:0,y:0})=>({
  x:int(value?.x??(Array.isArray(value)?value[0]:fallback.x),fallback.x),
  y:int(value?.y??(Array.isArray(value)?value[1]:fallback.y),fallback.y),
});
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const tileKey=value=>`${value.x},${value.y}`;

function defaultRange(type){
  return type==='line'||type==='cone'?4:2;
}

export function normalizeBossAction(raw={},index=0){
  const rawShape=typeof raw.shape==='string'?{type:raw.shape}:(raw.shape||{});
  const type=BOSS_SHAPES.includes(rawShape.type)?rawShape.type:'radius';
  const rawCharge=typeof raw.charge==='number'?{turns:raw.charge}:(raw.charge||{});
  const rawCounter=typeof (raw.counter??raw.onCounter)==='string'
    ?{mode:raw.counter??raw.onCounter}
    :(raw.counter||raw.onCounter||{});
  const mode=rawCounter.mode==='cancel'?'cancel':'weaken';
  const defaultOrigin=type==='line'||type==='cone'?'self':'target';
  return {
    id:String(raw.id||`boss-action-${index+1}`),
    name:String(raw.name||raw.label||'보스 초식'),
    charge:{
      turns:clamp(int(rawCharge.turns,1),0,9),
      label:String(rawCharge.label||raw.telegraph||'기세를 모은다'),
      stance:String(rawCharge.stance||raw.stance||'축력'),
    },
    target:typeof (raw.targetRule??raw.target)==='string'
      ?(raw.targetRule??raw.target)
      :String((raw.targetRule??raw.target)?.rule||'nearest'),
    shape:{
      type,
      range:clamp(int(rawShape.range??raw.range,defaultRange(type)),1,12),
      origin:rawShape.origin==='self'||rawShape.origin==='target'?rawShape.origin:defaultOrigin,
      spread:clamp(num(rawShape.spread,.5),.25,1),
      metric:rawShape.metric==='chebyshev'?'chebyshev':'manhattan',
      includeCenter:rawShape.includeCenter!==false,
    },
    skill:raw.skill||null,
    power:clamp(num(raw.power,1.15),.1,5),
    hitBonus:clamp(int(raw.hitBonus,10),-50,100),
    cooldown:clamp(int(raw.cooldown,1),0,4),
    counter:{
      mode,
      damageMultiplier:clamp(num(rawCounter.damageMultiplier??rawCounter.multiplier,.55),0,1),
      shrink:clamp(int(rawCounter.shrink,1),0,8),
      label:String(rawCounter.label||(mode==='cancel'?'초식이 끊겼다':'위력과 범위가 약해졌다')),
    },
  };
}

/* 스테이지 오버라이드는 평면 배열과 [{target, actions:[...]}] 양쪽을 허용한다. */
export function bossActionDefs(unit,{stageActions,unitActions,martialActions}={}){
  if(!unit?.boss)return [];
  const cid=unit.cid;
  const fromStage=[];
  for(const entry of Array.isArray(stageActions)?stageActions:[]){
    const nested=Array.isArray(entry?.actions);
    const selector=entry?.boss??entry?.cid??(nested?entry?.target:null);
    if(selector&&selector!==cid)continue;
    if(nested)fromStage.push(...entry.actions);
    else if(entry?.target===cid)fromStage.push({...entry,target:entry.targetRule||'nearest'});
    else fromStage.push(entry);
  }
  const source=fromStage.length
    ?fromStage
    :(Array.isArray(unitActions)&&unitActions.length?unitActions:
      (Array.isArray(martialActions)?martialActions:[]));
  return source.filter(Boolean).map(normalizeBossAction);
}

function stableTargetKey(target){
  return `${String(target.uid||target.cid||'').padStart(24,'0')}|${String(target.y).padStart(3,'0')}|${String(target.x).padStart(3,'0')}`;
}

export function selectBossTarget(unit,targets=[],rule='nearest'){
  const living=targets.filter(target=>target&&target.alive!==false);
  if(!living.length)return null;
  const score=target=>{
    const d=distance(unit,target),hpRatio=(target.maxhp||target.hp||1)>0?target.hp/(target.maxhp||target.hp||1):1;
    if(rule==='lowestHp')return [hpRatio,d,target.leader?0:1,stableTargetKey(target)];
    if(rule==='leader')return [target.leader?0:1,d,hpRatio,stableTargetKey(target)];
    if(rule==='highestKi')return [-((target.ki||0)/(target.maxki||target.ki||1)),d,hpRatio,stableTargetKey(target)];
    return [d,hpRatio,target.leader?0:1,stableTargetKey(target)];
  };
  return living.slice().sort((a,b)=>{
    const aa=score(a),bb=score(b);
    for(let i=0;i<aa.length;i++){
      if(aa[i]===bb[i])continue;
      return typeof aa[i]==='string'?String(aa[i]).localeCompare(String(bb[i])):aa[i]-bb[i];
    }
    return 0;
  })[0];
}

export function directionToward(origin,target){
  const dx=target.x-origin.x,dy=target.y-origin.y;
  if(Math.abs(dx)>=Math.abs(dy)&&dx!==0)return {x:Math.sign(dx),y:0};
  if(dy!==0)return {x:0,y:Math.sign(dy)};
  return {x:-1,y:0};
}

function inBounds(value,bounds){
  return value.x>=0&&value.y>=0&&value.x<bounds.w&&value.y<bounds.h;
}

function uniqueTiles(values,bounds){
  const seen=new Map();
  for(const value of values){
    const next=tile(value);
    if(inBounds(next,bounds))seen.set(tileKey(next),next);
  }
  return [...seen.values()].sort((a,b)=>a.y-b.y||a.x-b.x);
}

export function patternTiles({shape,origin,target,bounds}){
  const spec=normalizeBossAction({shape,charge:{turns:0}}).shape;
  const self=tile(origin),aim=tile(target,self),dir=directionToward(self,aim),perp={x:-dir.y,y:dir.x};
  const center=spec.origin==='self'?self:aim,values=[];
  if(spec.type==='line'){
    for(let step=1;step<=spec.range;step++)values.push({x:self.x+dir.x*step,y:self.y+dir.y*step});
  }else if(spec.type==='cross'){
    if(spec.includeCenter)values.push(center);
    for(const arm of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]){
      for(let step=1;step<=spec.range;step++)values.push({x:center.x+arm.x*step,y:center.y+arm.y*step});
    }
  }else if(spec.type==='cone'){
    for(let step=1;step<=spec.range;step++){
      const half=Math.floor(step*spec.spread);
      for(let lateral=-half;lateral<=half;lateral++){
        values.push({x:self.x+dir.x*step+perp.x*lateral,y:self.y+dir.y*step+perp.y*lateral});
      }
    }
  }else{
    for(let dy=-spec.range;dy<=spec.range;dy++)for(let dx=-spec.range;dx<=spec.range;dx++){
      const inside=spec.metric==='chebyshev'?Math.max(Math.abs(dx),Math.abs(dy))<=spec.range:Math.abs(dx)+Math.abs(dy)<=spec.range;
      if(inside&&(spec.includeCenter||dx!==0||dy!==0))values.push({x:center.x+dx,y:center.y+dy});
    }
  }
  /* 자기 중심 범위라도 보스가 선 칸은 피해 판정에서 제외한다. */
  return uniqueTiles(values,bounds).filter(value=>value.x!==self.x||value.y!==self.y);
}

export function shrinkBossShape(shape,amount=1){
  return {...shape,range:Math.max(1,int(shape?.range,1)-Math.max(0,int(amount,0)))};
}

export function createBossActionPlan({unit,action,targets=[],bounds,turn=1,sequence=0}){
  if(!unit||!bounds?.w||!bounds?.h)return null;
  const normalized=normalizeBossAction(action,sequence),chosen=selectBossTarget(unit,targets,normalized.target);
  if(!chosen)return null;
  const origin=tile(unit),targetTile=tile(chosen);
  const tiles=patternTiles({shape:normalized.shape,origin,target:targetTile,bounds});
  const weakenedShape=shrinkBossShape(normalized.shape,normalized.counter.shrink);
  const weakenedTiles=patternTiles({shape:weakenedShape,origin,target:targetTile,bounds});
  return {
    id:`${unit.uid||unit.cid||'boss'}:${normalized.id}:${turn}:${sequence}`,
    action:normalized,
    sequence,
    createdTurn:turn,
    targetUid:chosen.uid||null,
    targetCid:chosen.cid||null,
    targetName:chosen.name||null,
    origin,
    targetTile,
    direction:directionToward(origin,targetTile),
    bounds:{w:int(bounds.w),h:int(bounds.h)},
    tiles,
    weakenedTiles,
    stage:normalized.charge.turns>0?'telegraph':'ready',
    chargeRemaining:normalized.charge.turns,
    status:'normal',
    counterReason:null,
  };
}

export function bossPlanTiles(plan){
  if(!plan||plan.status==='cancelled')return [];
  return (plan.status==='weakened'?plan.weakenedTiles:plan.tiles)||[];
}

export function bossPlanHasTarget(plan,targets=[]){
  const keys=new Set(bossPlanTiles(plan).map(tileKey));
  return targets.some(target=>target?.alive!==false&&keys.has(tileKey(target)));
}

export function bossPlanIntent(plan){
  if(!plan)return null;
  const action=plan.action,warningTiles=bossPlanTiles(plan);
  const kind=plan.status==='cancelled'?'boss-cancelled':(plan.stage==='ready'?'boss-execute':'boss-charge');
  return {
    kind,bossAction:true,planId:plan.id,actionId:action.id,actionName:action.name,
    targetUid:plan.targetUid,targetCid:plan.targetCid,targetName:plan.targetName,
    targetTile:{...plan.targetTile},x:plan.origin.x,y:plan.origin.y,
    warningTiles:warningTiles.map(value=>({...value})),
    warningKeys:warningTiles.map(tileKey),
    shape:action.shape.type,range:action.shape.range,skill:action.skill,sid:action.skill,
    stage:plan.stage,status:plan.status,chargeRemaining:plan.chargeRemaining,
    stance:action.charge.stance,chargeLabel:action.charge.label,
    counterLabel:plan.counterReason||action.counter.label,
  };
}

export function applyBossCounter(plan,reason=null){
  if(!plan||plan.status!=='normal')return {plan,changed:false,outcome:plan?.status||'none'};
  const mode=plan.action.counter.mode;
  return {
    plan:{...plan,status:mode==='cancel'?'cancelled':'weakened',counterReason:reason||plan.action.counter.label},
    changed:true,
    outcome:mode,
  };
}

/* 한 번의 적 페이즈에 계획이 어떻게 진행되는지 반환한다. */
export function advanceBossPlan(plan){
  if(!plan)return {event:'none',plan:null};
  if(plan.status==='cancelled')return {event:'cancelled',plan:null,execution:{...plan,tiles:[]}};
  if(plan.stage==='telegraph'){
    const remaining=Math.max(0,plan.chargeRemaining-1);
    return {event:'charge',plan:{...plan,chargeRemaining:remaining,stage:remaining===0?'ready':'telegraph'}};
  }
  return {event:'execute',plan:null,execution:{...plan,tiles:bossPlanTiles(plan).map(value=>({...value}))}};
}

export function nextBossActionIndex(index,actions){
  return actions?.length?(Math.max(0,int(index,0))+1)%actions.length:0;
}

export function bossShapeLabel(type){
  return {line:'직선',cross:'십자',cone:'부채꼴',radius:'범위'}[type]||'범위';
}

export function bossIntentDescription(intent,targetName=null){
  if(!intent?.bossAction)return '';
  const target=targetName||intent.targetName||'고정 지점',shape=bossShapeLabel(intent.shape);
  if(intent.kind==='boss-cancelled')return `${intent.actionName} · 간파로 취소됨 — ${intent.counterLabel}`;
  if(intent.kind==='boss-charge'){
    const turns=Math.max(1,int(intent.chargeRemaining,1));
    return `${intent.actionName} · ${intent.chargeLabel} (${turns}회 축력) → ${target} · ${shape} ${intent.warningTiles.length}칸`;
  }
  const weakened=intent.status==='weakened'?' · 간파로 약화':'';
  return `${intent.actionName}${weakened} 발동 → ${target} · ${shape} ${intent.warningTiles.length}칸`;
}
