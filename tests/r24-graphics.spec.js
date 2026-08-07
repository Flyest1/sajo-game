import {test,expect} from '@playwright/test';

async function openBattle(page,campaignId,stageId,flags={}){
  await page.goto('./');await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.evaluate(({campaignId,stageId,flags})=>{window.startCampaignV2(campaignId,false);const state=window.__dbg.campaignState;state.stageId=stageId;state.flags=flags;window.__dbg.openCurrentDeploy();},{campaignId,stageId,flags});
  await page.getByRole('button',{name:/출 전/}).click();
  await expect(page.locator('#mapsvg')).toBeVisible();
}

test('R24 dialogue uses one premium emotional portrait without legacy line overlap',async({page})=>{
  await page.goto('./');await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.evaluate(()=>{window.startCampaignV2('sajo',false);const state=window.__dbg.campaignState;state.stageId='r23_sj_wumu_pursuit';window.v2Enter();});
  await page.locator('.dlg-title-card').click();
  await page.locator('#dlg-screen').click();await page.locator('#dlg-screen').click();
  const portrait=page.locator('.dlg-pt[data-cid="gj"]');
  await expect(portrait).toHaveAttribute('data-expression','angry');
  await expect(portrait.locator('image')).toHaveAttribute('href',/portraits\/expressions\/gj-angry\.webp$/);
  await expect(page.locator('.portrait-vector-fallback:visible')).toHaveCount(0);
});

test('R24 regional scene depth and symbolic impact feedback render on desktop and mobile',async({page},testInfo)=>{
  await openBattle(page,'sinjo','r23_sn_mongol_choice',{mv_gj:1});
  const depth=page.locator('#battle-depth');await expect(depth).toHaveClass(/theme-grassland/);await expect(depth).toHaveAttribute('data-theme','grassland');
  await expect(depth.locator('.depth-layer')).toHaveCount(3);await expect(depth.locator('.scene-signature')).toContainText('몽골·요 초원');
  await expect(depth.locator('.steppe-camp')).toHaveCount(1);await expect(page.locator('.portrait-vector-fallback:visible')).toHaveCount(0);
  const samples=await page.evaluate(()=>window.__dbg.previewImpactFeedback());expect(samples).toHaveLength(6);
  await expect(page.locator('.dmgpop')).toHaveCount(6);
  const symbols=await page.locator('.dmgpop').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.kind,getComputedStyle(node,'::before').content.replaceAll('"','')])));
  expect(symbols).toMatchObject({damage:'傷',crit:'絶',heal:'生',miss:'虛',guard:'氣',break:'破'});
  const wrap=await page.locator('#mapwrap').boundingBox(),signature=await depth.locator('.scene-signature').boundingBox();
  expect(signature.x).toBeGreaterThanOrEqual(wrap.x);expect(signature.x+signature.width).toBeLessThanOrEqual(wrap.x+wrap.width+1);
  if(process.env.R24_VISUAL)await page.screenshot({path:`test-results/r24-graphics-${testInfo.project.name}.png`,fullPage:true});
});

test('R24 palace, coast, and grassland themes are registered and reduced effects keep information',async({page})=>{
  await openBattle(page,'uicheon','r23_yt_persian_fleet',{mv_ming:1});
  const themes=await page.evaluate(()=>['r23_sj_wumu_pursuit','r23_sn_mongol_choice','r23_yt_persian_fleet','r23_tl_liao_rebellion'].map(id=>Object.values(window.__dbg.CAMPAIGNS).flatMap(campaign=>Object.values(campaign.stages)).find(stage=>stage.id===id)?.sceneTheme));
  expect(themes).toEqual(['palace','grassland','coast','grassland']);
  await expect(page.locator('#battle-depth')).toHaveClass(/theme-coast/);await expect(page.locator('.island-coast')).toHaveCount(1);
  await page.evaluate(()=>window.toggleReducedFx());
  await expect(page.locator('#mapwrap')).toHaveClass(/reduced-fx/);await expect(page.locator('.scene-signature')).toContainText('영사도 해안');await expect(page.locator('#weather')).toBeEmpty();
});
