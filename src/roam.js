export const ROAM_RELICS = Object.freeze({
  tiger: {name:'백호패',cost:4,desc:'힘 +3 · 기술 +1',stats:{str:3,skl:1}},
  cloud: {name:'유운화',cost:5,desc:'이동 +1 · 속도 +2',stats:{mov:1,spd:2}},
  jade: {name:'청옥호심경',cost:4,desc:'HP +8 · 정신 +2',stats:{hp:8,res:2}},
  flame: {name:'적염단',cost:4,desc:'내공 +3 · 기력 +6',stats:{int:3,ki:6}},
  iron: {name:'현철완갑',cost:4,desc:'방어 +3 · 힘 +1',stats:{def:3,str:1}},
  crane: {name:'학령',cost:3,desc:'기술 +2 · 속도 +2',stats:{skl:2,spd:2}},
  pearl: {name:'야명주',cost:3,desc:'HP +5 · 기력 +5',stats:{hp:5,ki:5}},
  seal: {name:'협객의 인장',cost:5,desc:'전 능력 +1',stats:{hp:3,str:1,int:1,def:1,res:1,spd:1,skl:1,ki:3}},
});

export const ROAM_NODE_META = Object.freeze({
  battle:{label:'격전',action:'격전으로'}, event:{label:'기연',action:'기연으로'},
  camp:{label:'객잔',action:'객잔으로'}, shop:{label:'장터',action:'장터로'},
  faction:{label:'문파',action:'문파 사건으로'}, boss:{label:'고수',action:'고수에게'},
});

export function buildRoamNodes(rng){
  const length=12+Math.floor(rng()*4);
  const middle=['shop','faction','camp','event'];
  const weighted=['battle','battle','event','camp','shop','faction'];
  while(middle.length<length-2) middle.push(weighted[Math.floor(rng()*weighted.length)]);
  for(let i=middle.length-1;i>0;i--){
    const j=Math.floor(rng()*(i+1));
    [middle[i],middle[j]]=[middle[j],middle[i]];
  }
  return ['battle',...middle,'boss'];
}

export function relicOffers(rng,owned=[]){
  const ids=Object.keys(ROAM_RELICS).filter(id=>!owned.includes(id));
  for(let i=ids.length-1;i>0;i--){
    const j=Math.floor(rng()*(i+1));
    [ids[i],ids[j]]=[ids[j],ids[i]];
  }
  return ids.slice(0,3);
}

export function applyRelic(stats,relicId){
  const relic=ROAM_RELICS[relicId];
  if(!relic) return stats;
  for(const [key,value] of Object.entries(relic.stats)) stats[key]=Math.max(1,(stats[key]||0)+value);
  return stats;
}

export function legendFor(cid,character,run){
  const titles={외:'파진검객',경:'유운협객',내:'현심고수'};
  const faction=Object.entries(run.factions||{}).sort((a,b)=>b[1]-a[1])[0];
  const title=faction&&faction[1]>=2?`${faction[0]}의 ${titles[character.type]||'유협'}`:(titles[character.type]||'강호유협');
  const scar=(run.scars||[]).includes(cid)
    ? ((run.falls||0)>=2?'백전의 흉터':'패전의 흉터')
    : '무흠의 귀환';
  return {cid,name:character.name,title,scar,seed:run.seed,nodes:run.nodes.length,relics:[...(run.relics||[])],at:Date.now()};
}
