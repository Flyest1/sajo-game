import {test,expect} from '@playwright/test';
import BATTLE_EXPANSIONS from '../src/data/battle_expansions.json' with {type:'json'};
import {applyBattleVariant,battleVariantConditionMatches} from '../src/campaign-battles.js';

const cases=[
  ['sajo','u5_sj_palace','r23_sj_wumu_pursuit',{jeonjin:1},'quanzhen-intel','palace-blindspot'],
  ['sinjo','u5_sn_father_truth','r23_sn_mongol_choice',{mv_gj:1},'guo-trust','revenge-hesitation'],
  ['uicheon','u5_yt_persia','r23_yt_persian_fleet',{mv_ming:1},'ming-formation','six-sect-delay'],
  ['chunryong','u5_tl_liao','r23_tl_liao_rebellion',{inui:1},'mercy-intel','unseen-flank'],
];

test('R23 campaign battle conditions support composite flag rules',()=>{
  expect(battleVariantConditionMatches({all:['a',{gte:['score',2]}]},{a:1,score:2})).toBe(true);
  expect(battleVariantConditionMatches({any:['a',{eq:['route','west']}]},{route:'west'})).toBe(true);
  expect(battleVariantConditionMatches({ifNot:'mercy'},{mercy:1})).toBe(false);
});

test('R23 four canonical battles resolve both choice outcomes without mutating source data',()=>{
  for(const [campaignId,anchorId,stageId,flags,chosenId,defaultId] of cases){
    const raw=BATTLE_EXPANSIONS.campaigns[campaignId].after[anchorId].find(stage=>stage.id===stageId);
    const layout=BATTLE_EXPANSIONS.layouts[raw.layout],stage={...layout,...raw};
    const before=JSON.stringify(stage),chosen=applyBattleVariant(stage,flags),fallback=applyBattleVariant(stage,{});
    expect(chosen.battleVariant.id).toBe(chosenId);expect(fallback.battleVariant.id).toBe(defaultId);
    expect(chosen.enemies.every(enemy=>enemy.boost===.94)).toBe(true);
    expect(fallback.reinforce.length).toBeGreaterThan(chosen.reinforce?.length||0);
    expect(JSON.stringify(stage)).toBe(before);
  }
});

test('R23 battle pack covers every main campaign with playable canonical definitions',()=>{
  for(const [campaignId,anchorId,stageId] of cases){
    const stage=BATTLE_EXPANSIONS.campaigns[campaignId].after[anchorId].find(item=>item.id===stageId),layout=BATTLE_EXPANSIONS.layouts[stage.layout];
    expect(stage.kind).toBe('battle');expect(stage.source).toBe('canon');expect(layout.map).toHaveLength(12);expect(stage.enemies.length).toBeGreaterThanOrEqual(5);
    expect(stage.pre.length).toBeGreaterThanOrEqual(3);expect(stage.post.length).toBeGreaterThanOrEqual(2);
  }
});

test('R23 selected history changes the live battle briefing on desktop and mobile',async({page},testInfo)=>{
  await page.goto('./');await page.evaluate(()=>localStorage.clear());await page.reload();
  const variants=await page.evaluate(()=>{
    window.startCampaignV2('sinjo',false);
    const state=window.__dbg.campaignState,campaign=window.__dbg.CAMPAIGNS.sinjo;
    if(campaign.stages.u5_sn_father_truth.next!=='r23_sn_mongol_choice')throw new Error('R23 stage insertion missing');
    state.stageId='r23_sn_mongol_choice';state.flags={};window.__dbg.openCurrentDeploy();
    const fallback={variant:state.curBattle.battleVariant,reinforce:state.curBattle.reinforce.length};
    state.flags={mv_gj:1};window.__dbg.openCurrentDeploy();
    return {fallback,chosen:{variant:state.curBattle.battleVariant,reinforce:state.curBattle.reinforce?.length||0,boosts:state.curBattle.enemies.map(enemy=>enemy.boost)}};
  });
  expect(variants.fallback.variant.id).toBe('revenge-hesitation');expect(variants.fallback.reinforce).toBe(1);
  expect(variants.chosen.variant.id).toBe('guo-trust');expect(variants.chosen.reinforce).toBe(0);expect(new Set(variants.chosen.boosts)).toEqual(new Set([.94]));
  await page.getByRole('button',{name:/출 전/}).click();
  await expect.poll(()=>page.evaluate(()=>window.__dbg.B?.log.some(item=>item.msg.includes('선택의 여파 · 직접 본 협의')))).toBe(true);
  await page.locator('[data-battle-action="detail"]:visible').click();
  await expect(page.locator('#log')).toContainText('선택의 여파 · 직접 본 협의');
  if(process.env.R23_VISUAL)await page.screenshot({path:`test-results/r23-choice-${testInfo.project.name}.png`,fullPage:true});
});
