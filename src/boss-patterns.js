const DEFAULT_PHASES={
  '외':[
    {at:.68,name:'강공 전환',stats:{str:.14,skl:.08},guardRatio:.18,tactic:'leader'},
    {at:.32,name:'사력 필살',stats:{str:.2,spd:.1},guardRatio:.22,tactic:'execute'},
  ],
  '경':[
    {at:.7,name:'유영신법',stats:{spd:.16,skl:.1},guardRatio:.17,tactic:'hunter'},
    {at:.35,name:'잔영 추격',stats:{spd:.2,str:.1},guardRatio:.21,tactic:'execute'},
  ],
  '내':[
    {at:.66,name:'내력 개방',stats:{int:.15,res:.1},guardRatio:.2,tactic:'leader'},
    {at:.3,name:'진기 폭발',stats:{int:.22,skl:.1},guardRatio:.24,tactic:'execute'},
  ],
};

export function bossPhaseDefs(unit,customDefs){
  if(!unit||!unit.boss) return [];
  if(Array.isArray(customDefs)){
    const matched=customDefs.filter(phase=>!phase.target||phase.target===unit.cid);
    if(matched.length) return matched;
  }
  return DEFAULT_PHASES[unit.type]||DEFAULT_PHASES['내'];
}

export function applyBossPhaseStats(unit,phase){
  const changes=phase.stats||Object.fromEntries(['str','int','spd','skl'].map(key=>[key,phase.boost||.1]));
  for(const [key,boost] of Object.entries(changes)){
    if(key in unit.stats) unit.stats[key]=Math.max(1,Math.round(unit.stats[key]*(1+boost)));
  }
  unit.tactic=phase.tactic||unit.tactic||'leader';
  unit.ki=unit.maxki;
  if(phase.guard!==false){
    unit.guardMax=Math.max(unit.guardMax,Math.round(unit.maxhp*(phase.guardRatio||.2)));
    unit.guard=unit.guardMax;
    unit.broken=false;
  }
  return changes;
}
