const key=(x,y)=>`${x},${y}`;
const at=(units,x,y)=>units.find(unit=>unit.alive&&unit.x===x&&unit.y===y);

export function movementRange({unit,map,tileDefs,units=[],blocked=()=>false}){
  const height=map.length,width=map[0]?.length||0,inBounds=(x,y)=>x>=0&&y>=0&&x<width&&y<height;
  const result=new Map([[key(unit.x,unit.y),0]]),queue=[[0,unit.x,unit.y]];
  while(queue.length){
    queue.sort((a,b)=>a[0]-b[0]);
    const [spent,x,y]=queue.shift();
    if(spent>(result.get(key(x,y))??Infinity))continue;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy;if(!inBounds(nx,ny)||blocked(nx,ny))continue;
      let cost=tileDefs[map[ny][nx]]?.cost??99;if(cost>=99)continue;
      if(unit.type==='경'&&cost>1)cost-=1;
      const occupant=at(units,nx,ny);if(occupant&&occupant.team!==unit.team)continue;
      const next=spent+cost;if(next>unit.stats.mov)continue;
      if(next<(result.get(key(nx,ny))??Infinity)){result.set(key(nx,ny),next);queue.push([next,nx,ny]);}
    }
  }
  return result;
}

export function stoppableTile({unit,x,y,units=[],blocked=()=>false}){
  const occupant=at(units,x,y);
  return !blocked(x,y)&&(!occupant||occupant===unit);
}
