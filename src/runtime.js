export function resolveRuntimeContext({campaign,challenge,classic,settings}){
  const mode=challenge?.mode||challenge?.wave?'challenge':(campaign?'campaign':'classic');
  const campaignId=campaign?.camp||null;
  const stageId=campaign?.stageId??classic?.chapterIdx??0;
  const difficulty=campaign?.diff||challenge?.diff||classic?.diff||settings?.diff||'std';
  return {
    mode,
    campaignId,
    stageId,
    difficulty,
    sceneKey:`${campaignId||mode}_${stageId}`,
  };
}
