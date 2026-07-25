export function bondRankWithReputation(base,reputation={}){
  return Math.min(3,(base||0)+((reputation.jeong||0)>=2?1:0));
}

export function reputationCombatEffects(reputation={},factions={}){
  const effects={repDef:0,repAtk:0,repHit:0,labels:[]};
  if((reputation.hyeop||0)>=2){ effects.repDef=1; effects.labels.push('俠 동료 보호 · 받는 피해 -1'); }
  if((reputation.se||0)>=2){ effects.repAtk=1; effects.labels.push('勢 기세 장악 · 주는 피해 +1'); }
  const faction=Object.entries(factions).sort((a,b)=>b[1]-a[1])[0];
  if(faction&&faction[1]>=2){ effects.repHit=4; effects.labels.push(`${faction[0]} 지원 · 명중 +4`); }
  return effects;
}

export function shopPriceFor(basePrice,reputation={}){
  const discount=Math.min(.2,(reputation.hyeop||0)*.04);
  return Math.max(1,Math.round(basePrice*(1-discount)));
}

export function lootMultiplier(reputation={}){
  return 1+Math.min(.2,(reputation.se||0)*.05);
}

export function reputationPerks(reputation={}){
  return [
    (reputation.hyeop||0)>=2?'俠 상점 할인·피해 경감':'',
    (reputation.jeong||0)>=2?'情 인연 전투 등급 +1':'',
    (reputation.se||0)>=2?'勢 공격·전리품 보정':'',
  ].filter(Boolean);
}
