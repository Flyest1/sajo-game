const clone=value=>JSON.parse(JSON.stringify(value));

function flagValue(flags,key){
  return flags&&Object.prototype.hasOwnProperty.call(flags,key)?flags[key]:0;
}

export function battleVariantConditionMatches(condition,flags={}){
  if(!condition)return true;
  if(condition.if&&!flagValue(flags,condition.if))return false;
  if(condition.ifNot&&flagValue(flags,condition.ifNot))return false;
  if(condition.gte){
    const [key,value]=condition.gte;
    if(Number(flagValue(flags,key))<Number(value))return false;
  }
  if(condition.eq){
    const [key,value]=condition.eq;
    if(flagValue(flags,key)!==value)return false;
  }
  if(condition.all&&!condition.all.every(rule=>typeof rule==='string'?!!flagValue(flags,rule):battleVariantConditionMatches(rule,flags)))return false;
  if(condition.any&&!condition.any.some(rule=>typeof rule==='string'?!!flagValue(flags,rule):battleVariantConditionMatches(rule,flags)))return false;
  return true;
}

function mergeReinforcements(base,added){
  return [...clone(base||[]),...clone(added||[])];
}

export function applyBattleVariant(stage,flags={}){
  const resolved=clone(stage);
  const variants=resolved.battleVariants||[];
  const selected=variants.find(variant=>variant.default||battleVariantConditionMatches(variant.when,flags));
  delete resolved.battleVariants;
  if(!selected){resolved.battleVariant=null;return resolved;}
  const effects=selected.effects||{};
  if(effects.enemyBoost){
    resolved.enemies=(resolved.enemies||[]).map(enemy=>({...enemy,boost:Number(((enemy.boost||1)*effects.enemyBoost).toFixed(3))}));
  }
  if(effects.removeEnemyCids?.length){
    const removed=new Set(effects.removeEnemyCids);
    resolved.enemies=(resolved.enemies||[]).filter(enemy=>!removed.has(enemy.cid));
  }
  if(effects.addEnemies?.length)resolved.enemies=[...(resolved.enemies||[]),...clone(effects.addEnemies)];
  if(effects.addReinforce?.length)resolved.reinforce=mergeReinforcements(resolved.reinforce,effects.addReinforce);
  if(effects.addTreasures?.length)resolved.treasures=[...(resolved.treasures||[]),...clone(effects.addTreasures)];
  if(Number.isFinite(effects.goldDelta))resolved.goldReward=Math.max(0,(resolved.goldReward||0)+effects.goldDelta);
  if(effects.environment)resolved.environment=clone(effects.environment);
  resolved.battleVariant={id:selected.id,label:selected.label,desc:selected.desc||'',effects:clone(effects)};
  return resolved;
}
