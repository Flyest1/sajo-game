export const MASTERY_STEPS=Object.freeze([0,8,20,40,70]);

export function masteryTierForUses(uses=0){
  const count=Math.max(0,Number(uses)||0);
  for(let tier=MASTERY_STEPS.length-1;tier>=0;tier--)if(count>=MASTERY_STEPS[tier])return tier;
  return 0;
}

export function masteryBonuses(skill={},uses=0){
  const tier=masteryTierForUses(uses),baseCost=Math.max(0,skill.cost||0),cost=Math.max(1,baseCost-Math.floor(tier/2));
  return {tier,uses:Math.max(0,Number(uses)||0),power:skill.heal?0:tier*4,hit:skill.heal?0:tier*2,heal:skill.heal?tier:0,cost,costDown:Math.max(0,baseCost-cost)};
}

export function masteryLabelForUses(uses=0){
  const tier=masteryTierForUses(uses);
  return tier?`숙련 ${['','★','★★','★★★','極'][tier]}`:'';
}

export function masteryProgressForUses(uses=0){
  const count=Math.max(0,Number(uses)||0),tier=masteryTierForUses(count);
  return tier>=MASTERY_STEPS.length-1?`숙련 極 ${count}회`:`숙련 ${count}/${MASTERY_STEPS[tier+1]}`;
}

export function masteryEffectFor(skill={},uses=0){
  const result=masteryBonuses(skill,uses),parts=[];
  if(result.power)parts.push(`위력 +${result.power}%p`,`명중 +${result.hit}`);
  if(result.heal)parts.push(`회복 +${result.heal}`);
  if(result.costDown)parts.push(`기 소모 -${result.costDown}`);
  return parts.length?parts.join(' · '):'현재 보정 없음';
}
