import { expect, test } from '@playwright/test';
import {
  advanceBossPlan,applyBossCounter,bossPlanIntent,createBossActionPlan,patternTiles,
} from '../src/boss-actions.js';
import { resolveBossImpact,resolveGuardHit,resolveHealthHit } from '../src/combat-resolution.js';
import { chooseEnemyAction } from '../src/enemy-ai.js';

const bounds={w:11,h:9};
const boss={uid:'boss-1',cid:'boss',name:'강적',boss:true,x:7,y:4,range:[1]};
const hero={uid:'hero-1',cid:'hero',name:'협객',team:'P',alive:true,x:2,y:4,hp:20,maxhp:20,ki:5,maxki:5};

test('R20 four boss shapes are deterministic and clipped to the board',()=>{
  const shapes=Object.fromEntries(['line','cross','cone','radius'].map(type=>[type,patternTiles({
    shape:{type,range:3,origin:type==='radius'?'target':'self'},origin:boss,target:hero,bounds,
  })]));
  expect(shapes.line).toEqual([{x:4,y:4},{x:5,y:4},{x:6,y:4}]);
  expect(shapes.cross).toHaveLength(12);
  expect(shapes.cone.length).toBeGreaterThan(shapes.line.length);
  expect(shapes.radius).toContainEqual({x:2,y:4});
  for(const tiles of Object.values(shapes))for(const tile of tiles){
    expect(tile.x).toBeGreaterThanOrEqual(0);expect(tile.x).toBeLessThan(bounds.w);
    expect(tile.y).toBeGreaterThanOrEqual(0);expect(tile.y).toBeLessThan(bounds.h);
  }
});

test('R20 telegraph tiles are the exact execution tiles after a charge turn',()=>{
  const plan=createBossActionPlan({
    unit:boss,targets:[hero],bounds,turn:3,
    action:{id:'line',name:'직선 시험',charge:{turns:1},target:'nearest',shape:{type:'line',range:5,origin:'self'}},
  });
  const first=bossPlanIntent(plan),charged=advanceBossPlan(plan),ready=bossPlanIntent(charged.plan),executed=advanceBossPlan(charged.plan);
  expect(first.kind).toBe('boss-charge');
  expect(charged.event).toBe('charge');
  expect(ready.kind).toBe('boss-execute');
  expect(ready.warningKeys).toEqual(first.warningKeys);
  expect(executed.event).toBe('execute');
  expect(executed.execution.tiles.map(tile=>`${tile.x},${tile.y}`)).toEqual(first.warningKeys);
});

test('R19 counter cancels or weakens a pending R20 action without retargeting',()=>{
  const cancelPlan=createBossActionPlan({unit:boss,targets:[hero],bounds,action:{
    id:'cancel',name:'취소 시험',charge:{turns:1},shape:{type:'cone',range:4},counter:{mode:'cancel'},
  }});
  const cancelled=applyBossCounter(cancelPlan,'외공 상성');
  expect(cancelled).toMatchObject({changed:true,outcome:'cancel'});
  expect(bossPlanIntent(cancelled.plan)).toMatchObject({kind:'boss-cancelled',warningKeys:[]});
  expect(advanceBossPlan(cancelled.plan)).toMatchObject({event:'cancelled',plan:null});

  const weakenPlan=createBossActionPlan({unit:boss,targets:[hero],bounds,action:{
    id:'weaken',name:'약화 시험',charge:{turns:0},shape:{type:'line',range:5},
    counter:{mode:'weaken',damageMultiplier:.5,shrink:2},
  }});
  const before=bossPlanIntent(weakenPlan),weakened=applyBossCounter(weakenPlan,'연계 1단'),after=bossPlanIntent(weakened.plan);
  expect(weakened).toMatchObject({changed:true,outcome:'weaken'});
  expect(after.targetTile).toEqual(before.targetTile);
  expect(after.warningTiles.length).toBe(before.warningTiles.length-2);
  const full=resolveBossImpact({hp:20,maxhp:20,baseDamage:10,power:1,hitChance:100,hitRoll:0,status:'normal'});
  const reduced=resolveBossImpact({hp:20,maxhp:20,baseDamage:10,power:1,hitChance:100,hitRoll:0,status:'weakened',counterDamageMultiplier:.5});
  expect(full.damage).toBe(10);expect(reduced.damage).toBe(5);
});

test('pure combat resolution and extracted generic enemy AI preserve safe fallbacks',()=>{
  expect(resolveGuardHit({guard:3,guardMax:8,damage:5})).toMatchObject({guard:0,guardDamage:3,broke:true});
  expect(resolveHealthHit({hp:9,maxhp:12,damage:20,floor:2})).toMatchObject({hp:2,damage:7,defeated:false});
  const unit={uid:'e',cid:'e',x:4,y:2,range:[1],tactic:'hunter'};
  const target={uid:'p',cid:'p',x:1,y:2,hp:8,maxhp:10,alive:true};
  const action=chooseEnemyAction({
    unit,players:[target],moveTiles:new Map([['4,2',0],['3,2',1],['2,2',2]]),
    canStop:()=>true,selectSkill:()=>null,terrainAt:()=>0,
    previewStrike:()=>({dmg:4,hit:100}),
  });
  expect(action).toMatchObject({kind:'attack',x:2,y:2,targetUid:'p'});
  expect(chooseEnemyAction({unit,players:[],moveTiles:[]})).toEqual({kind:'wait',x:4,y:2});
});

test('R20 live telegraph stays readable and executes the warned tiles on desktop and mobile',async({page},testInfo)=>{
  await page.goto('./');await page.evaluate(()=>localStorage.clear());await page.reload();
  const coverage=await page.evaluate(()=>({
    martials:Object.keys(window.__dbg.ENEMY_MARTIALS).length,
    actionBosses:Object.values(window.__dbg.ENEMY_MARTIALS).filter(style=>style.actions?.length).length,
  }));
  expect(coverage).toEqual({martials:20,actionBosses:8});
  await page.evaluate(()=>{
    window.startCampaignV2('sajo',false);window.__dbg.campaignState.stageId='s5';window.__dbg.openCurrentDeploy();
  });
  await page.getByRole('button',{name:/출 전/}).click();
  /* 원거리 대기 보스는 각성 전 초기 배치를 표적으로 고정하지 않는다. */
  await expect(page.locator('#boss-intent-hud')).toBeHidden();
  await expect(page.locator('.boss-warning-tile')).toHaveCount(0);
  await page.evaluate(()=>window.__dbg.installBossActions('ygang',[{
    id:'telegraph-proof',name:'예고 일치 시험',charge:{turns:1,label:'시험 축력',stance:'축력'},
    target:'nearest',shape:{type:'line',range:6,origin:'self'},power:.1,hitBonus:100,
    counter:{mode:'weaken',damageMultiplier:.5,shrink:1},
  }]));
  await expect(page.locator('#boss-intent-hud')).toBeVisible();
  await expect(page.locator('#boss-intent-hud')).toContainText('양강');
  await expect(page.locator('.boss-warning-tile')).not.toHaveCount(0);
  const layout=await page.locator('#boss-intent-hud').evaluate(element=>{
    const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,width:rect.width,viewport:innerWidth};
  });
  expect(layout.left).toBeGreaterThanOrEqual(0);expect(layout.right).toBeLessThanOrEqual(layout.viewport);
  if(testInfo.project.name==='mobile-chromium')expect(layout.width).toBeLessThanOrEqual(layout.viewport-8);

  const result=await page.evaluate(async()=>{
    const boss=window.__dbg.B.units.find(unit=>unit.cid==='ygang');
    const first=structuredClone(window.__dbg.B.intents[boss.uid]);
    await window.__dbg.performBossAction('ygang');
    const ready=structuredClone(window.__dbg.B.intents[boss.uid]);
    const state=await window.__dbg.performBossAction('ygang');
    return {first,ready,last:state.lastExecution};
  });
  expect(result.first.kind).toBe('boss-charge');expect(result.ready.kind).toBe('boss-execute');
  expect(result.ready.warningKeys).toEqual(result.first.warningKeys);
  expect(result.last.tiles.map(tile=>`${tile.x},${tile.y}`)).toEqual(result.first.warningKeys);
});
