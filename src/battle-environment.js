const DIRS=[[0,-1],[1,0],[0,1],[-1,0]];
const key=(x,y)=>`${x},${y}`;
const point=value=>Array.isArray(value)?{x:Number(value[0]),y:Number(value[1])}:{x:Number(value?.x),y:Number(value?.y)};
const inside=(p,bounds)=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<bounds.w&&p.y<bounds.h;

export const ENVIRONMENT_TYPES=Object.freeze({
  fire:{name:'불길',kind:'damage'},poison:{name:'독무',kind:'status'},
  current:{name:'급류',kind:'push'},moving:{name:'이동 위험',kind:'damage'},cliff:{name:'절벽',kind:'block'},
});

export function createBattleEnvironment(definition={},bounds={w:0,h:0}){
  const hazards=(definition.hazards||[]).map((raw,index)=>{
    const type=ENVIRONMENT_TYPES[raw.type]?raw.type:'fire';
    const tiles=(raw.tiles||[]).map(point).filter(p=>inside(p,bounds));
    const path=(raw.path||[]).map(point).filter(p=>inside(p,bounds));
    return {
      id:raw.id||`${type}-${index+1}`,type,label:raw.label||ENVIRONMENT_TYPES[type].name,
      tiles:type==='moving'?(path.length?[path[0]]:tiles):tiles,path,
      damage:Math.max(0,Math.min(8,Number(raw.damage)||0)),
      kiDrain:Math.max(0,Math.min(5,Number(raw.kiDrain)||0)),
      poison:Math.max(0,Math.min(4,Number(raw.poison)||0)),
      push:Array.isArray(raw.push)?[Math.sign(Number(raw.push[0])||0),Math.sign(Number(raw.push[1])||0)]:[0,0],
      spreadEvery:Math.max(0,Math.min(4,Number(raw.spreadEvery)||0)),
      maxTiles:Math.max(tiles.length,Math.min(18,Number(raw.maxTiles)||tiles.length)),phase:0,
    };
  });
  const cliffs=(definition.cliffs||[]).map(point).filter(p=>inside(p,bounds));
  const gates=(definition.gates||[]).map((raw,index)=>({
    id:raw.id||`gate-${index+1}`,x:Number(raw.x),y:Number(raw.y),label:raw.label||'파괴 가능한 문',
    hp:Math.max(1,Math.min(4,Number(raw.hp)||2)),maxHp:Math.max(1,Math.min(4,Number(raw.hp)||2)),
  })).filter(gate=>inside(gate,bounds));
  return {name:definition.name||'',round:0,hazards,cliffs,gates};
}

export function environmentBlocked(environment,x,y){
  if(!environment)return false;
  return environment.cliffs.some(p=>p.x===x&&p.y===y)||environment.gates.some(g=>g.hp>0&&g.x===x&&g.y===y);
}

export function environmentEffectsAt(environment,x,y){
  if(!environment)return [];
  return environment.hazards.filter(h=>h.tiles.some(p=>p.x===x&&p.y===y));
}

export function advanceBattleEnvironment(environment,{passable=()=>true}={}){
  if(!environment)return environment;
  const next=structuredClone(environment);next.round++;
  const occupied=new Set([
    ...next.cliffs.map(p=>key(p.x,p.y)),
    ...next.gates.filter(g=>g.hp>0).map(g=>key(g.x,g.y)),
  ]);
  for(const hazard of next.hazards){
    if(hazard.type==='moving'&&hazard.path.length){
      hazard.phase=(hazard.phase+1)%hazard.path.length;hazard.tiles=[hazard.path[hazard.phase]];
    }
    if(hazard.type==='fire'&&hazard.spreadEvery&&next.round%hazard.spreadEvery===0&&hazard.tiles.length<hazard.maxTiles){
      const existing=new Set(hazard.tiles.map(p=>key(p.x,p.y))),candidates=[];
      for(const tile of [...hazard.tiles].sort((a,b)=>a.y-b.y||a.x-b.x))for(const [dx,dy] of DIRS){
        const p={x:tile.x+dx,y:tile.y+dy},k=key(p.x,p.y);
        if(!existing.has(k)&&!occupied.has(k)&&passable(p.x,p.y))candidates.push(p);
      }
      const add=candidates.sort((a,b)=>a.y-b.y||a.x-b.x)[0];if(add)hazard.tiles.push(add);
    }
  }
  return next;
}

export function resolveEnvironmentEffects(environment,units,{passable=()=>true}={}){
  const living=(units||[]).filter(unit=>unit.alive),occupied=new Map(living.map(unit=>[key(unit.x,unit.y),unit.uid]));
  const effects=[];
  for(const unit of living){
    for(const hazard of environmentEffectsAt(environment,unit.x,unit.y)){
      const effect={uid:unit.uid,hazardId:hazard.id,type:hazard.type,label:hazard.label,damage:hazard.damage,kiDrain:hazard.kiDrain,poison:hazard.poison,pushTo:null};
      if(hazard.type==='current'&&(hazard.push[0]||hazard.push[1])){
        const x=unit.x+hazard.push[0],y=unit.y+hazard.push[1],k=key(x,y);
        if(passable(x,y)&&!environmentBlocked(environment,x,y)&&!occupied.has(k)){
          effect.pushTo={x,y};occupied.delete(key(unit.x,unit.y));occupied.set(k,unit.uid);
        }
      }
      effects.push(effect);
    }
  }
  return effects;
}

export function damageEnvironmentGate(environment,gateId,amount=1){
  const next=structuredClone(environment),gate=next?.gates?.find(item=>item.id===gateId);
  if(!gate||gate.hp<=0)return {environment:next,changed:false,destroyed:false,gate:null};
  gate.hp=Math.max(0,gate.hp-Math.max(1,amount));
  return {environment:next,changed:true,destroyed:gate.hp===0,gate};
}

export function adjacentEnvironmentGates(environment,unit){
  return (environment?.gates||[]).filter(gate=>gate.hp>0&&Math.abs(gate.x-unit.x)+Math.abs(gate.y-unit.y)===1);
}

export function environmentSummary(environment){
  if(!environment)return [];
  const types=[...new Set(environment.hazards.map(h=>h.type))].map(type=>ENVIRONMENT_TYPES[type].name);
  if(environment.cliffs.length)types.push('절벽');if(environment.gates.some(g=>g.hp>0))types.push('파괴문');
  return types;
}
