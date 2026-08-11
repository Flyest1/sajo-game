import {test,expect} from '@playwright/test';
import {endgameProgress,syncEndgameRecord,endgameBlessing} from '../src/endgame.js';

const mainClears={sajo:true,sinjo:true,uicheon:true,chunryong:true};
const silverMedals=Object.fromEntries(Array.from({length:5},(_,i)=>[`trial-${i}`,'silver']));

test('R25 three endgame seals and perfect clear use exact thresholds',()=>{
  const ready=endgameProgress({campaignClears:mainClears,lunjian:{bestRound:4},trialMedals:silverMedals});
  expect(ready).toMatchObject({completed:3,ready:true,perfect:false});
  expect(ready.seals.map(seal=>[seal.id,seal.value,seal.complete])).toEqual([
    ['chronicle',4,true],['lunjian',4,true],['trials',5,true],
  ]);
  const perfect=endgameProgress({campaignClears:mainClears,lunjian:{bestRound:8},trialMedals:Object.fromEntries(Array.from({length:10},(_,i)=>[`trial-${i}`,'gold']))});
  expect(perfect).toMatchObject({ready:true,perfect:true,gold:10});
});

test('R25 seal claims and blessing are idempotent and bounded',()=>{
  const progress=endgameProgress({campaignClears:mainClears,lunjian:{bestRound:8},trialMedals:Object.fromEntries(Array.from({length:10},(_,i)=>[`trial-${i}`,'gold']))});
  const first=syncEndgameRecord({},progress,1000),second=syncEndgameRecord(first.record,progress,2000);
  expect(first.newlyClaimed).toEqual(['chronicle','lunjian','trials']);
  expect(first.record).toMatchObject({legacyPoints:3,perfect:true});
  expect(second.newlyClaimed).toEqual([]);expect(second.record.legacyPoints).toBe(3);
  expect(endgameBlessing(second.record)).toEqual({seals:3,gold:600,items:{daehwandan:3},perfect:true});
  expect(endgameBlessing({legacyPoints:99})).toMatchObject({seals:3,gold:600,items:{daehwandan:3}});
});

async function seedEndgame(page){
  await page.goto('./');
  await page.evaluate(()=>{
    localStorage.clear();
    const campaign=id=>({camp:id,stageId:'end',cleared:['end'],flags:{},roster:{},party:[],inv:{},extraSkills:{},equips:{}});
    const medals=Object.fromEntries(Array.from({length:5},(_,i)=>[`trial-${i}`,'silver']));
    localStorage.setItem('kimyong_save_v3',JSON.stringify({version:3,campaigns:Object.fromEntries(['sajo','sinjo','uicheon','chunryong','hwasan'].map(id=>[id,campaign(id)])),challenges:{lunjian:{bestRound:4,clears:0,records:[]},trials:{medals}}}));
  });
  await page.reload();
}

test('R25 common endgame board unlocks finale and never duplicates seal rewards',async({page},testInfo)=>{
  await seedEndgame(page);await page.evaluate(()=>window.showChallengeSelect());
  await expect(page.getByRole('heading',{name:'무림 종장과 도전'})).toBeVisible();
  await expect(page.locator('.endgame-seal.complete')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'진최종전으로'})).toBeEnabled();
  if(process.env.R25_VISUAL)await page.screenshot({path:`test-results/r25-board-${testInfo.project.name}.png`,fullPage:true});
  await page.evaluate(()=>window.showChallengeSelect());
  let probe=await page.evaluate(()=>window.__dbg.endgameProbe());
  expect(probe.record.legacyPoints).toBe(3);expect(Object.keys(probe.record.claimed)).toHaveLength(3);
  await page.reload();probe=await page.evaluate(()=>window.__dbg.endgameProbe());
  expect(probe.record.legacyPoints).toBe(3);expect(Object.keys(probe.record.claimed)).toHaveLength(3);
  await page.evaluate(()=>window.startCampaignV2('jinfinal',false));
  let state=await page.evaluate(()=>window.__dbg.campaignState);
  expect(state.gold).toBe(3600);expect(state.inv.daehwandan).toBe(7);expect(state.flags.endgame_seals).toBe(3);
  await page.evaluate(()=>window.startCampaignV2('jinfinal',true));state=await page.evaluate(()=>window.__dbg.campaignState);
  expect(state.gold).toBe(3600);expect(state.inv.daehwandan).toBe(7);
});

test('R25 finale is a live multi-stage objective with two rifts and two boss phases',async({page},testInfo)=>{
  await seedEndgame(page);
  const definition=await page.evaluate(()=>{
    window.startCampaignV2('jinfinal',false);const state=window.__dbg.campaignState;state.stageId='f2';window.__dbg.openCurrentDeploy();
    return {objective:state.curBattle.objective,environment:state.curBattle.environment,bossPhases:state.curBattle.bossPhases};
  });
  expect(definition.objective.objectives.map(item=>item.type)).toEqual(['boss','seize','survive']);
  expect(definition.environment.hazards).toHaveLength(2);expect(definition.bossPhases).toHaveLength(2);
  await page.getByRole('button',{name:/출 전/}).click();await expect(page.locator('#mapsvg')).toBeVisible();
  await expect(page.locator('.env-moving')).toHaveCount(2);
  await expect(page.locator('body')).toContainText('동·서 시공 인장 동시 확보');
  const probe=await page.evaluate(()=>window.__dbg.objectiveProbe(window.__dbg.campaignState.curBattle.objective,{turn:5,pendingReinf:false,units:[
    {team:'P',alive:true,x:2,y:10},{team:'P',alive:true,x:15,y:10},{team:'E',alive:false,cid:'oyb'},
  ]}));
  expect(probe.won).toBe(true);expect(probe.progress).toContain('3/3');
  if(process.env.R25_VISUAL)await page.screenshot({path:`test-results/r25-endgame-${testInfo.project.name}.png`,fullPage:true});
});
