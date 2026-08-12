import {test,expect} from '@playwright/test';
import {masteryTierForUses,masteryBonuses,masteryProgressForUses,masteryEffectFor} from '../src/mastery.js';
import {movementRange,stoppableTile} from '../src/pathfinding.js';

test('U7 mastery module preserves every threshold and displayed effect',()=>{
  expect([0,7,8,19,20,39,40,69,70].map(masteryTierForUses)).toEqual([0,0,1,1,2,2,3,3,4]);
  expect(masteryBonuses({cost:5},70)).toEqual({tier:4,uses:70,power:16,hit:8,heal:0,cost:3,costDown:2});
  expect(masteryBonuses({cost:4,heal:12},40)).toMatchObject({tier:3,power:0,hit:0,heal:3,cost:3});
  expect(masteryProgressForUses(20)).toBe('숙련 20/40');expect(masteryProgressForUses(71)).toBe('숙련 極 71회');
  expect(masteryEffectFor({cost:5},70)).toBe('위력 +16%p · 명중 +8 · 기 소모 -2');
});

test('U7 pathfinding module keeps terrain, enemy, ally, and environment rules',()=>{
  const tiles={'.':{cost:1},'m':{cost:3},'#':{cost:99}},map=['.....','.m#..','.....'];
  const unit={team:'P',alive:true,type:'경',x:0,y:1,stats:{mov:4}},ally={team:'P',alive:true,x:1,y:0},enemy={team:'E',alive:true,x:1,y:2};
  const range=movementRange({unit,map,tileDefs:tiles,units:[unit,ally,enemy],blocked:(x,y)=>x===3&&y===1});
  expect(range.get('1,1')).toBe(2);expect(range.has('2,1')).toBe(false);expect(range.has('1,2')).toBe(false);expect(range.has('3,1')).toBe(false);
  expect(range.has('2,0')).toBe(true);expect(stoppableTile({unit,x:1,y:0,units:[unit,ally]})).toBe(false);expect(stoppableTile({unit,x:0,y:1,units:[unit,ally]})).toBe(true);
});

test('U7 live engine boots with split rules and exposes playable movement on desktop and mobile',async({page})=>{
  await page.goto('./');await page.evaluate(()=>localStorage.clear());await page.reload();
  expect(await page.evaluate(()=>window.__pwa.version)).toMatch(/^U8-/);
  const probe=await page.evaluate(()=>{
    window.startCampaignV2('sajo',false);const campaign=window.__dbg.CAMPAIGNS.sajo,state=window.__dbg.campaignState;
    state.stageId=Object.keys(campaign.stages).find(id=>campaign.stages[id].kind==='battle');window.__dbg.openCurrentDeploy();
    return {campaigns:window.__dbg.DISCOVERED_CAMPAIGN_IDS.length,stage:state.stageId};
  });
  expect(probe.campaigns).toBe(13);expect(probe.stage).toBeTruthy();
  await page.getByRole('button',{name:/출 전/}).click();await expect(page.locator('#mapsvg')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__dbg.movementProbe()?.length||0)).toBeGreaterThan(1);
});

test('U7 completion surface has no runtime console errors through the main product hubs',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.evaluate(()=>window.showCampaignSelect());await expect(page.getByRole('heading',{name:/강호연대기|본편/})).toBeVisible();
  await page.evaluate(()=>window.showChallengeSelect());await expect(page.getByRole('heading',{name:'무림 종장과 도전'})).toBeVisible();
  await page.evaluate(()=>window.showSettings());await expect(page.getByRole('heading',{name:'설정'})).toBeVisible();
  expect(errors).toEqual([]);
});
