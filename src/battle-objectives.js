/* 전투 승패 규칙을 DOM과 전역 상태에서 분리한 순수 모듈. */
export function objectiveLeaves(objective){
  if((objective.type==='all'||objective.type==='any')&&Array.isArray(objective.objectives)){
    return objective.objectives.flatMap(objectiveLeaves);
  }
  return [objective];
}

export function objectiveTiles(objective){
  return (objective.tiles||objective.zones||[]).map(tile=>Array.isArray(tile)?{x:tile[0],y:tile[1]}:tile);
}

function living(units,team){ return units.filter(unit=>unit.team===team&&unit.alive); }

export function objectiveWon(objective,context){
  const units=context.units||[], players=living(units,'P'), foes=living(units,'E');
  if(objective.type==='all') return (objective.objectives||[]).every(child=>objectiveWon(child,context));
  if(objective.type==='any') return (objective.objectives||[]).some(child=>objectiveWon(child,context));
  if(objective.type==='boss') return !units.some(unit=>unit.team==='E'&&unit.cid===objective.boss&&unit.alive);
  if(objective.type==='survive') return context.turn>objective.turns || (objective.boss&&!units.some(unit=>unit.team==='E'&&unit.cid===objective.boss&&unit.alive));
  if(objective.type==='seize') return objectiveTiles(objective).every(tile=>players.some(unit=>unit.x===tile.x&&unit.y===tile.y));
  if(objective.type==='escape'){
    const tiles=objectiveTiles(objective);
    return players.filter(unit=>tiles.some(tile=>unit.x===tile.x&&unit.y===tile.y)&&(objective.cids?objective.cids.includes(unit.cid):true)).length>=(objective.min||1);
  }
  if(objective.type==='subdue') return units.some(unit=>unit.cid===objective.target&&unit.subdued);
  return foes.length===0&&!context.pendingReinf;
}

export function objectiveProgress(objective,context){
  const units=context.units||[], players=living(units,'P');
  if((objective.type==='all'||objective.type==='any')&&Array.isArray(objective.objectives)){
    const done=objective.objectives.filter(child=>objectiveWon(child,context)).length;
    return `${done}/${objective.objectives.length} 조건 · ${objective.objectives.map(child=>`${objectiveWon(child,context)?'✓':'○'} ${child.text||child.type}`).join(' / ')}`;
  }
  if(objective.type==='survive') return `${Math.max(0,objective.turns-context.turn+1)}턴`;
  if(objective.type==='seize'){
    const tiles=objectiveTiles(objective), held=tiles.filter(tile=>players.some(unit=>unit.x===tile.x&&unit.y===tile.y)).length;
    return `${held}/${tiles.length} 지점`;
  }
  if(objective.type==='escape'){
    const tiles=objectiveTiles(objective), escaped=players.filter(unit=>tiles.some(tile=>unit.x===tile.x&&unit.y===tile.y)).length;
    return `${escaped}/${objective.min||1}명`;
  }
  if(objective.type==='subdue'){
    const target=units.find(unit=>unit.cid===objective.target&&unit.alive);
    return target?(target.subdued?'제압 완료':`대상 HP ${target.hp}/${target.maxhp}`):'대상 이탈';
  }
  return '';
}
