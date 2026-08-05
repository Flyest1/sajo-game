/* 일반 적 행동 선택을 전투 화면에서 분리한 결정론적 순수 모듈. */

const manhattan=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

function normalizeMoveTiles(moveTiles=[]){
  if(moveTiles instanceof Map){
    return [...moveTiles.entries()].map(([key,cost])=>{
      const [x,y]=key.split(',').map(Number);return {x,y,cost};
    });
  }
  return moveTiles.map(value=>Array.isArray(value)?{x:value[0],y:value[1],cost:value[2]||0}:value);
}
export function scoreEnemyAttack({unit,target,position,preview,terrain=0,distance=manhattan}){
  const dd=distance(position,target);
  let score=preview.dmg*(preview.hit/100)+(preview.dmg>=target.hp?60:0)+terrain*.2+(target.leader?6:0);
  if(unit.tactic==='hunter')score+=(1-target.hp/target.maxhp)*34;
  if(unit.tactic==='leader'&&target.leader)score+=28;
  if(unit.tactic==='execute'&&target.hp<=target.maxhp*.45)score+=38;
  if(preview.retaliation)score-=preview.retaliation.dmg*(preview.retaliation.hit/100)*.5;
  return {score,distance:dd};
}

/*
 * previewStrike(attacker, defender, skillId, position)는 해당 위치에서의 예상치를 준다.
 * 게임 쪽 지형/무학 계산을 콜백으로 주입하여 AI 순회와 점수 계산 자체는 순수하게 유지한다.
 */
export function chooseEnemyAction({
  unit,players=[],moveTiles=[],ranges=unit?.range||[],canStop=()=>true,
  selectSkill=()=>null,previewStrike=()=>({dmg:0,hit:0}),terrainAt=()=>0,
  distance=manhattan,
}={}){
  if(!unit)return {kind:'wait',x:0,y:0};
  const moves=normalizeMoveTiles(moveTiles),living=players.filter(player=>player&&player.alive!==false);
  let best=null;
  for(const position of moves){
    if(!canStop(position.x,position.y))continue;
    for(const target of living){
      const dd=distance(position,target);
      if(!ranges.includes(dd))continue;
      const sid=selectSkill(unit,target,position)||null;
      const preview=previewStrike(unit,target,sid,position)||{dmg:0,hit:0};
      const scored=scoreEnemyAttack({unit,target,position,preview,terrain:terrainAt(position.x,position.y),distance});
      if(!best||scored.score>best.score){
        best={kind:'attack',x:position.x,y:position.y,targetUid:target.uid,targetCid:target.cid,score:scored.score,sid};
      }
    }
  }
  if(best)return best;
  let target=null;
  for(const player of living)if(!target||distance(player,unit)<distance(target,unit))target=player;
  if(!target)return {kind:'wait',x:unit.x,y:unit.y};
  let move=null;
  for(const position of moves){
    if(!canStop(position.x,position.y))continue;
    const dd=distance(position,target);
    if(!move||dd<move.dd)move={kind:'move',x:position.x,y:position.y,targetUid:target.uid,targetCid:target.cid,dd};
  }
  return move||{kind:'wait',x:unit.x,y:unit.y};
}
