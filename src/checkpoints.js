const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

export function emptyCheckpoints(){ return {latest:null,history:[]}; }

export function makeCampaignCheckpoint({kind,label,campaign}){
  if(!campaign?.camp) return null;
  const {curBattle,...state}=campaign;
  const at=Date.now();
  return {
    id:`${campaign.camp}-${campaign.stageId}-${kind}-${at}`,
    kind,
    label:label||campaign.stageId,
    campaignId:campaign.camp,
    stageId:campaign.stageId,
    at,
    state:clone(state),
  };
}

export function appendCheckpoint(store,checkpoint,limit=12){
  if(!checkpoint) return store;
  store.checkpoints=store.checkpoints||emptyCheckpoints();
  const history=Array.isArray(store.checkpoints.history)?store.checkpoints.history:[];
  const latest=history[0];
  if(latest&&latest.kind===checkpoint.kind&&latest.campaignId===checkpoint.campaignId&&latest.stageId===checkpoint.stageId){
    history[0]=checkpoint;
  }else history.unshift(checkpoint);
  store.checkpoints.history=history.slice(0,limit);
  store.checkpoints.latest=checkpoint.id;
  return store;
}

export function checkpointById(store,id){
  const checkpoint=store?.checkpoints?.history?.find(item=>item.id===id);
  return checkpoint?clone(checkpoint):null;
}
