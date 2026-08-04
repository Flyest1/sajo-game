/* 전투 수치의 조건부 무학 계산을 DOM·세션에서 분리한 순수 모듈. */
export function martialModifiers({
  attackerEffects={},defenderEffects={},adjacentAttackers=0,adjacentDefenders=0,adjacentEnemies=0,
  attackerMoved=0,attackerHpRatio=1,defenderHpRatio=1,defenderKiRatio=1,defenderType='',hasBond=false,hasSkill=false,comboStep=0,
}={}){
  let attackMultiplier=1+(attackerEffects.damage||0)+adjacentAttackers*(attackerEffects.adjacentDamage||0);
  if(attackerMoved===0)attackMultiplier+=attackerEffects.stationaryDamage||0;
  if(hasBond)attackMultiplier+=attackerEffects.bondDamage||0;
  if(attackerHpRatio<=.5)attackMultiplier+=attackerEffects.lowHpDamage||0;
  if(defenderHpRatio<=.5)attackMultiplier+=attackerEffects.vsLowHpDamage||0;
  if(defenderKiRatio<=.35)attackMultiplier+=attackerEffects.vsLowKiDamage||0;
  if(defenderType==='내')attackMultiplier+=attackerEffects.vsInnerDamage||0;
  if(hasSkill)attackMultiplier+=attackerEffects.skillDamage||0;
  if(comboStep)attackMultiplier+=attackerEffects.comboDamage||0;
  attackMultiplier+=adjacentEnemies*(attackerEffects.surroundedDamage||0);
  let reduction=(defenderEffects.damageTaken||0)+adjacentDefenders*(defenderEffects.adjacentReduction||0);
  if(defenderHpRatio<=.5)reduction+=defenderEffects.lowHpReduction||0;
  return {
    attackMultiplier,
    reduction:Math.min(.4,reduction),
    hit:(attackerEffects.hit||0)+adjacentAttackers*(attackerEffects.adjacentHit||0)+(defenderType==='내'?(attackerEffects.vsInnerHit||0):0)-(defenderEffects.avoid||0),
    crit:attackerEffects.crit||0,
    guardDamage:attackerEffects.guardDamage||0,
  };
}

/* 적 무학은 제시된 파훼법 중 하나만 만족해도 간파된다. */
export function enemyMartialCounter(style,{attackerType='',adjacentAllies=0,comboStep=0,defenderBroken=false}={}){
  if(!style||defenderBroken)return {active:false,reasons:[]};
  const c=style.counter||{},reasons=[];
  if((c.types||[]).includes(attackerType))reasons.push(`${attackerType}공 상성`);
  if(c.minAllies&&adjacentAllies>=c.minAllies)reasons.push(`협공 ${adjacentAllies}명`);
  if(c.combo&&comboStep>0)reasons.push(`${comboStep}단 연계`);
  const active=reasons.length>0;
  return {active,reasons,mult:active?(c.mult||.12):0,hit:active?(c.hit||8):0,guardDamage:active?(c.guardDamage||2):0};
}
