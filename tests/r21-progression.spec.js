import {test,expect} from '@playwright/test';
import CHARS from '../src/data/characters.json' with {type:'json'};
import {newlyUnlockedPromotions,promotionRequirementParts,promotionStatus} from '../src/progression.js';

test('R21 event promotions stay locked until their canonical campaign event',()=>{
  const promo=CHARS.syn.promo;
  const before={camp:'sinjo',stageId:'s4',cleared:[]};
  const after={camp:'sinjo',stageId:'camp1',cleared:['s4']};
  expect(promotionStatus(promo,{level:8,campaign:before}).available).toBe(false);
  const ready=promotionStatus(promo,{level:8,campaign:after});
  expect(ready).toMatchObject({available:true,levelOk:true,itemOk:true,eventOk:true});
  expect(promotionRequirementParts(promo,{status:ready}).every(part=>part.met)).toBe(true);
  expect(newlyUnlockedPromotions(before,after,CHARS,['syn']).map(item=>item.cid)).toEqual(['syn']);
});

test('R21 legacy item promotions retain their inventory gate',()=>{
  const promo=CHARS.gj.promo,campaign={camp:'sajo',stageId:'camp1',cleared:['s3']};
  expect(promotionStatus(promo,{level:7,inventory:{},campaign}).available).toBe(false);
  expect(promotionStatus(promo,{level:7,inventory:{hangryongbi:1},campaign}).available).toBe(true);
});

test('R21 all twelve core heroes expose bounded promotion paths',()=>{
  const ids=['gj','hy','yg','syn','jmk','jomin','sb','dy','hj','zbt','wjy','ijy'];
  expect(ids.filter(cid=>CHARS[cid].promo)).toEqual(ids);
  expect(ids.filter(cid=>CHARS[cid].promo.unlock)).toHaveLength(7);
});

test('R21 formation shows event progress and promotes without consuming an item',async({page},testInfo)=>{
  await page.goto('/sajo-game/');
  await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.evaluate(()=>{
    window.startCampaignV2('sinjo',false);
    const state=window.__dbg.campaignState,c=window.__dbg.CHARS.syn,keys=['hp','str','int','def','res','spd','skl','mov','ki'];
    state.party=['syn'];state.stageId='camp1';state.cleared=[];
    state.roster.syn={cid:'syn',lvl:8,exp:0,stats:Object.fromEntries(keys.map((key,index)=>[key,c.base[index]]))};
    window.campFromRoute();
  });
  const card=page.locator('.formation-card[data-cid="syn"]'),button=card.getByRole('button',{name:'승급'});
  await expect(card).toContainText('○ 주백통에게 좌우호박');await expect(button).toBeDisabled();
  await page.evaluate(()=>{window.__dbg.campaignState.cleared.push('s4');window.campFromRoute();});
  await expect(card).toContainText('✓ 주백통에게 좌우호박');await expect(button).toBeEnabled();
  const before=await page.evaluate(()=>window.__dbg.campaignState.roster.syn.stats);
  await button.click();
  await expect(card).toContainText('옥녀심경 전인 승급 완료');
  const after=await page.evaluate(()=>({stats:window.__dbg.campaignState.roster.syn.stats,inv:window.__dbg.campaignState.inv,promoted:window.__dbg.campaignState.promoted.syn}));
  expect(after.inv).toEqual({});expect(after.promoted).toBe('옥녀심경 전인');expect(after.stats.spd-before.spd).toBe(2);
  if(process.env.R21_VISUAL)await page.screenshot({path:`test-results/r21-promotion-${testInfo.project.name}.png`,fullPage:true});
});
