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

/* 캠페인·도전 상태를 직접 소유하고 전투에는 문맥만 제공하는 단일 세션 저장소. */
export function createSessionRuntime({classic}){
  let campaignState=null, challengeState=null;
  const campaign=()=>campaignState;
  const challenge=()=>challengeState;
  return {
    get campaignState(){ return campaignState; },
    set campaignState(value){ campaignState=value||null; },
    get challengeState(){ return challengeState; },
    set challengeState(value){ challengeState=value||null; },
    campaign,
    challenge,
    activateCampaign(state){ challengeState=null; campaignState=state; return state; },
    activateChallenge(state){ campaignState=null; challengeState=state; return state; },
    useClassic(){ campaignState=null; challengeState=null; },
    clear(){ campaignState=null; challengeState=null; },
    isCampaign(){ return !!campaign(); },
    isChallenge(mode){ const state=challenge(); return !!state&&(!mode||state.mode===mode); },
    context(settings){ return resolveRuntimeContext({campaign:campaign(),challenge:challenge(),classic,settings}); },
    currentBattle(chapters){
      const run=challenge(), story=campaign();
      return run?.ch || story?.curBattle || chapters[classic.chapterIdx];
    },
    outcome(){
      const run=challenge(), story=campaign();
      if(story?.curBattle) return 'campaign';
      if(run?.mode==='roam') return 'roam';
      if(run) return 'endless';
      return 'classic';
    },
    campaignValue(key,fallback=null){ const state=campaign(); return state&&state[key]!==undefined?state[key]:fallback; },
    challengeValue(key,fallback=null){ const state=challenge(); return state&&state[key]!==undefined?state[key]:fallback; },
    sceneSeed(){
      const ctx=this.context({});
      return `${ctx.campaignId||ctx.mode}_${ctx.stageId}`;
    },
  };
}
