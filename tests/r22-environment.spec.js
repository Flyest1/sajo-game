import {test,expect} from '@playwright/test';
import {
  advanceBattleEnvironment,createBattleEnvironment,damageEnvironmentGate,
  environmentBlocked,environmentSummary,resolveEnvironmentEffects,
} from '../src/battle-environment.js';

const passable=(x,y)=>x>=0&&y>=0&&x<8&&y<6;

test('R22 fire spread and moving hazards advance deterministically',()=>{
  const definition={hazards:[
    {id:'fire',type:'fire',tiles:[[2,2]],damage:3,spreadEvery:1,maxTiles:3},
    {id:'ice',type:'moving',path:[[5,1],[5,2],[5,3]],damage:4},
  ]};
  const initial=createBattleEnvironment(definition,{w:8,h:6});
  const a=advanceBattleEnvironment(initial,{passable}),b=advanceBattleEnvironment(initial,{passable});
  expect(a).toEqual(b);expect(a.hazards[0].tiles).toHaveLength(2);expect(a.hazards[1].tiles).toEqual([{x:5,y:2}]);
  expect(initial.hazards[0].tiles).toHaveLength(1);
});

test('R22 hazards judge allies and enemies by the same rules while currents respect occupancy',()=>{
  const environment=createBattleEnvironment({hazards:[
    {id:'poison',type:'poison',tiles:[[1,1],[2,1]],damage:1,kiDrain:2,poison:2},
    {id:'river',type:'current',tiles:[[3,2]],push:[1,0]},
  ]},{w:8,h:6});
  const units=[
    {uid:'p',team:'P',alive:true,x:1,y:1},{uid:'e',team:'E',alive:true,x:2,y:1},
    {uid:'river',team:'P',alive:true,x:3,y:2},{uid:'block',team:'E',alive:true,x:4,y:2},
  ];
  const effects=resolveEnvironmentEffects(environment,units,{passable});
  expect(effects.filter(effect=>effect.type==='poison').map(effect=>({uid:effect.uid,damage:effect.damage,ki:effect.kiDrain,poison:effect.poison}))).toEqual([
    {uid:'p',damage:1,ki:2,poison:2},{uid:'e',damage:1,ki:2,poison:2},
  ]);
  expect(effects.find(effect=>effect.uid==='river').pushTo).toBeNull();
});

test('R22 cliffs and gates block paths until the gate is destroyed',()=>{
  const initial=createBattleEnvironment({cliffs:[[1,1]],gates:[{id:'door',x:2,y:1,hp:2}]},{w:8,h:6});
  expect(environmentBlocked(initial,1,1)).toBe(true);expect(environmentBlocked(initial,2,1)).toBe(true);
  const struck=damageEnvironmentGate(initial,'door',1);expect(struck.gate.hp).toBe(1);expect(environmentBlocked(struck.environment,2,1)).toBe(true);
  const opened=damageEnvironmentGate(struck.environment,'door',1);expect(opened.destroyed).toBe(true);expect(environmentBlocked(opened.environment,2,1)).toBe(false);
  expect(environmentSummary(initial)).toEqual(['절벽','파괴문']);
});

test('R22 campaign battlefield renders readable hazards and applies them on desktop and mobile',async({page},testInfo)=>{
  await page.goto('./');await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.evaluate(()=>{window.startCampaignV2('sinjo',false);window.__dbg.campaignState.stageId='s10';window.__dbg.openCurrentDeploy();});
  await page.getByRole('button',{name:/출 전/}).click();
  await expect(page.locator('.env-fire')).toHaveCount(1);await expect(page.locator('.environment-gate')).toHaveCount(1);
  await page.evaluate(()=>window.__dbg.installBossActions('gwd',[{id:'environment-overlap',name:'환경 중첩 시험',charge:{turns:1,label:'시험 축력'},target:'nearest',shape:{type:'radius',range:1,origin:'target'},power:.1,counter:{mode:'cancel'}}]));
  expect(await page.locator('.boss-warning-tile').count()).toBeGreaterThan(0);await expect(page.locator('.env-fire')).toHaveCount(1);
  await page.locator('[data-battle-action="detail"]:visible').click();await expect(page.locator('#info-pop')).toContainText('불길 · 파괴문');
  const applied=await page.evaluate(()=>{
    const unit=window.__dbg.B.units.find(item=>item.team==='P');
    window.__dbg.installEnvironment({name:'환경 실전 시험',hazards:[
      {id:'fire',type:'fire',label:'시험 불길',tiles:[[unit.x,unit.y]],damage:2,spreadEvery:1,maxTiles:2},
      {id:'mist',type:'poison',label:'시험 독무',tiles:[[unit.x,unit.y]],kiDrain:2,poison:2},
    ],gates:[{id:'door',x:unit.x+1,y:unit.y,hp:2,label:'시험 문'}]});
    const before={hp:unit.hp,ki:unit.ki};const result=window.__dbg.advanceEnvironment();
    const live=window.__dbg.B.units.find(item=>item.uid===unit.uid);window.__dbg.damageEnvironmentGate('door',2);
    return {before,after:{hp:live.hp,ki:live.ki,poison:live.poison},result};
  });
  expect(applied.after).toEqual({hp:applied.before.hp-2,ki:applied.before.ki-2,poison:2});
  expect(applied.result.environment.hazards.find(item=>item.id==='fire').tiles).toHaveLength(2);
  await expect(page.locator('.environment-gate')).toHaveCount(0);await expect(page.locator('.env-fire')).toHaveCount(2);
  if(process.env.R22_VISUAL)await page.screenshot({path:`test-results/r22-environment-${testInfo.project.name}.png`,fullPage:true});
});
