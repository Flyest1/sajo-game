/*
 * 전투 행동의 잠금과 해제를 전투/연출 구현에서 분리한다.
 * 행동 함수가 예외를 던져도 finally에서 busy와 actionLock을 반드시 복구한다.
 */

let actionSequence=0;

export function beginBattleAction(battle,{actorUid=null,kind='action'}={}){
  if(!battle)return {accepted:false,reason:'missing-battle',lock:null};
  if(battle.over)return {accepted:false,reason:'battle-over',lock:null};
  if(battle.actionLock)return {accepted:false,reason:'action-locked',lock:battle.actionLock};
  const lock={id:`action-${++actionSequence}`,actorUid,kind};
  battle.actionLock=lock;
  battle.busy=true;
  return {accepted:true,reason:null,lock};
}

export function ownsBattleAction(battle,lock){
  return !!(battle&&lock&&battle.actionLock?.id===lock.id);
}

export function finishBattleAction(battle,lock,{busyAfter=false}={}){
  if(!ownsBattleAction(battle,lock))return false;
  battle.actionLock=null;
  if(!battle.over)battle.busy=!!busyAfter;
  return true;
}

export async function executeBattleAction({battle,actorUid=null,kind='action',busyAfter=false,task}={}){
  const started=beginBattleAction(battle,{actorUid,kind});
  if(!started.accepted)return {...started,ok:false,value:undefined,error:null};
  try{
    const value=await task(started.lock);
    return {...started,ok:true,value,error:null};
  }catch(error){
    return {...started,ok:false,value:undefined,error};
  }finally{
    finishBattleAction(battle,started.lock,{busyAfter});
  }
}

export async function runGuardedPlayerAction({battle,actor,kind,task,cleanup,onError,onFinish}={}){
  if(!battle||battle.over||battle.phase!=='P'||!actor||!actor.alive||actor.acted)return {accepted:false,ok:false,reason:'invalid-player-action'};
  const outcome=await executeBattleAction({battle,actorUid:actor.uid,kind,task});
  if(!outcome.accepted)return outcome;
  cleanup?.();
  if(outcome.ok===false)onError?.(outcome.error);
  if(!battle.over&&actor.alive)onFinish?.(actor);
  return outcome;
}
