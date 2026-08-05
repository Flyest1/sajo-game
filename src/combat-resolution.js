/* 전투 수치 적용을 UI/애니메이션에서 분리한 순수 판정 모듈. */

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

export function resolveGuardHit({guard=0,guardMax=0,broken=false,damage=0}={}){
  const before=clamp(Math.round(finite(guard)),0,Math.max(0,Math.round(finite(guardMax))));
  const requested=Math.max(0,Math.round(finite(damage)));
  if(broken||before<=0||requested<=0){
    return {guard:before,guardDamage:0,requested,broke:false,broken:!!broken};
  }
  const after=Math.max(0,before-requested),applied=before-after;
  return {guard:after,guardDamage:applied,requested,broke:before>0&&after===0,broken:after===0};
}

export function resolveHealthHit({hp=0,maxhp=0,damage=0,floor=0}={}){
  const rawHp=Math.max(0,Math.round(finite(hp))),declaredMax=Math.round(finite(maxhp));
  const maximum=declaredMax>0?declaredMax:rawHp;
  const before=clamp(rawHp,0,maximum);
  const minimum=clamp(Math.round(finite(floor)),0,before);
  const requested=Math.max(0,Math.round(finite(damage)));
  const after=Math.max(minimum,before-requested);
  return {hp:after,damage:before-after,requested,defeated:after<=0,before,floor:minimum};
}

/*
 * 범위 초식은 기존 1:1 예상 피해를 입력으로 받아 별도의 순수 판정을 거친다.
 * roll 값은 호출자가 제공하므로 테스트에서 완전히 결정론적으로 검증할 수 있다.
 */
export function resolveBossImpact({
  hp=0,maxhp=0,baseDamage=0,power=1,hitChance=100,hitRoll=0,
  critChance=0,critRoll=100,critMultiplier=1.6,
  status='normal',counterDamageMultiplier=.55,floor=0,
}={}){
  const chance=clamp(finite(hitChance,100),0,100);
  const hit=finite(hitRoll,0)<chance;
  if(!hit){
    const health=resolveHealthHit({hp,maxhp,damage:0,floor});
    return {...health,hit:false,crit:false,damage:0,rawDamage:0,damageMultiplier:0};
  }
  const crit=finite(critRoll,100)<clamp(finite(critChance),0,100);
  const weakened=status==='weakened';
  const damageMultiplier=Math.max(0,finite(power,1))*(weakened?clamp(finite(counterDamageMultiplier,.55),0,1):1)*(crit?Math.max(1,finite(critMultiplier,1.6)):1);
  const rawDamage=Math.max(0,Math.round(finite(baseDamage)*damageMultiplier));
  const health=resolveHealthHit({hp,maxhp,damage:rawDamage,floor});
  return {...health,hit:true,crit,rawDamage,damageMultiplier};
}
