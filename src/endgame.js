export const ENDGAME_SEALS=Object.freeze([
  {id:'chronicle',name:'연대기의 인장',short:'本',target:4,desc:'사조·신조·의천·천룡 본편 완주'},
  {id:'lunjian',name:'논검의 인장',short:'劍',target:4,desc:'천하논검 4관 이상 도달'},
  {id:'trials',name:'파훼의 인장',short:'解',target:5,desc:'전투 수수께끼 은메달 이상 5개'},
]);

const medalRank={none:0,bronze:1,silver:2,gold:3};
const clone=value=>JSON.parse(JSON.stringify(value||{}));

export function endgameProgress({campaignClears={},lunjian={},trialMedals={},finalCleared=false}={}){
  const mainIds=['sajo','sinjo','uicheon','chunryong'];
  const values={
    chronicle:mainIds.filter(id=>campaignClears[id]).length,
    lunjian:Math.min(8,Math.max(lunjian.bestRound||0,lunjian.clears?8:0)),
    trials:Object.values(trialMedals).filter(medal=>(medalRank[medal]||0)>=medalRank.silver).length,
  };
  const seals=ENDGAME_SEALS.map(seal=>({...seal,value:values[seal.id],complete:values[seal.id]>=seal.target}));
  const gold=Object.values(trialMedals).filter(medal=>medal==='gold').length;
  return {
    seals,completed:seals.filter(seal=>seal.complete).length,ready:seals.every(seal=>seal.complete),
    perfect:(lunjian.bestRound||0)>=8&&gold>=10,finalCleared:!!finalCleared,gold,
  };
}

export function syncEndgameRecord(record={},progress,now=Date.now()){
  const next={claimed:{},legacyPoints:0,finalClears:0,...clone(record)};
  next.claimed={...(record.claimed||{})};const newlyClaimed=[];
  for(const seal of progress.seals)if(seal.complete&&!next.claimed[seal.id]){
    next.claimed[seal.id]=now;newlyClaimed.push(seal.id);
  }
  next.legacyPoints=Object.keys(next.claimed).filter(id=>ENDGAME_SEALS.some(seal=>seal.id===id)).length;
  next.perfect=!!progress.perfect;next.updatedAt=now;
  return {record:next,newlyClaimed};
}

export function endgameBlessing(record={}){
  const seals=Math.min(ENDGAME_SEALS.length,Math.max(0,record.legacyPoints||0));
  return {seals,gold:seals*200,items:{daehwandan:seals},perfect:!!record.perfect};
}
