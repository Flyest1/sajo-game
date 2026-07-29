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

/* 모드별 전역을 전투 엔진에 노출하지 않는 단일 세션 어댑터. */
export function createSessionRuntime({classic,getCampaign,setCampaign,getChallenge,setChallenge}){
  const campaign=()=>getCampaign()||null;
  const challenge=()=>getChallenge()||null;
  return {
    campaign,
    challenge,
    activateCampaign(state){ setChallenge(null); setCampaign(state); return state; },
    activateChallenge(state){ setCampaign(null); setChallenge(state); return state; },
    useClassic(){ setCampaign(null); setChallenge(null); },
    clear(){ setCampaign(null); setChallenge(null); },
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
