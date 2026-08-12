export async function exerciseSkillFixture({battle,skills,players,foes,masteryUses,useSkill},sid){
  const skill=skills[sid],actor=players[0],ally=players[1],sentinel=players[2],enemy=foes.find(unit=>!unit.boss)||foes[0];
  if(!battle||!skill||!actor||!ally||!sentinel||!enemy)return {accepted:false,ok:false,reason:'missing-fixture'};
  players.forEach(unit=>{unit.acted=true;unit.alive=true;});actor.acted=false;sentinel.acted=false;actor.hp=actor.maxhp;actor.ki=Math.max(actor.maxki,99);actor.skills=[sid];actor.x=2;actor.y=2;
  Object.assign(ally,{alive:true,hp:Math.max(1,ally.maxhp-12),x:2,y:3});Object.assign(sentinel,{x:1,y:1});
  Object.assign(enemy,{alive:true,hp:999,maxhp:999,guard:0,guardMax:0,broken:true,poison:0,range:[],martial:null,x:3,y:2});
  Object.assign(battle,{phase:'P',busy:false,over:false,actionLock:null,pending:null,sel:actor,joints:{}});
  const target=skill.heal?ally:enemy,before={hp:target.hp,uses:masteryUses()[sid]||0},outcome=await useSkill(actor,target,sid);
  return {accepted:outcome.accepted,ok:outcome.ok,reason:outcome.reason||null,sid,heal:!!skill.heal,busy:battle.busy,locked:!!battle.actionLock,acted:actor.acted,beforeHp:before.hp,afterHp:target.hp,
    masteryDelta:(masteryUses()[sid]||0)-before.uses,cutins:document.querySelectorAll('.martial-cutin,.boss-reveal').length};
}

export async function actionFailureFixture({battle,players,runAction}){
  const actor=players[0],sentinel=players[1];if(!battle||!actor||!sentinel)return null;
  players.forEach(unit=>{unit.acted=true;});actor.acted=false;sentinel.acted=false;Object.assign(battle,{phase:'P',busy:false,over:false,actionLock:null});
  const overlay=document.createElement('div');overlay.className='martial-cutin';document.getElementById('battlebody')?.appendChild(overlay);
  const outcome=await runAction(actor,'failure-probe',async()=>{throw new Error('R26 intentional recovery probe');});
  return {accepted:outcome.accepted,ok:outcome.ok,busy:battle.busy,locked:!!battle.actionLock,acted:actor.acted,cutins:document.querySelectorAll('.martial-cutin,.boss-reveal').length,
    recoveryLogged:battle.log.some(entry=>String(entry.msg).includes('안전하게 종료'))};
}
