import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('v3 title has one canonical campaign entry', async ({ page }) => {
  await expect(page.getByText('江湖의 별 · v3 통합판')).toBeVisible();
  const titleOffset=await page.locator('.title-menu').evaluate(el=>{
    const box=el.getBoundingClientRect();
    return Math.abs((box.left+box.width/2)-window.innerWidth/2);
  });
  expect(titleOffset).toBeLessThanOrEqual(2);
  await expect(page.getByRole('button', { name: /강호연대기/ })).toBeVisible();
  await expect(page.getByText(/신규 캠페인|베타/)).toHaveCount(0);
  await page.getByRole('button', { name: /강호연대기/ }).click();
  await expect(page.getByRole('heading', { name: '강호연대기' })).toBeVisible();
  await expect(page.getByText('원작 본편').first()).toBeVisible();
});

test('title keeps native keyboard activation and recent campaign resumes in one click', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:/강호연대기/})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'강호연대기'})).toBeVisible();
  const sajoCard=page.locator('.camp-card').filter({hasText:'사조영웅전'});
  await sajoCard.getByRole('button',{name:'시작하기'}).click();
  const last=await page.evaluate(() => JSON.parse(localStorage.getItem('kimyong_save_v3')).lastSession);
  expect(last).toMatchObject({mode:'campaign',campaignId:'sajo'});
  await page.evaluate(() => window.toTitle());
  const resume=page.locator('.resume-btn');
  await expect(resume).toContainText('이어하기');
  await expect(resume).toContainText('사조영웅전');
  await resume.click();
  expect(await page.evaluate(() => window.__dbg.sessionContext().campaign)).toBe('sajo');
});

test('campaign route exposes keyboard-operable journey stages', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button',{name:/강호연대기/}).click();
  const sajoCard=page.locator('.camp-card').filter({hasText:'사조영웅전'});
  await sajoCard.getByRole('button',{name:'시작하기'}).click();
  await page.evaluate(() => window.showRouteMap());
  await expect(page.locator('.journey-trail [aria-current="step"]')).toHaveText('막 지도');
  const current=page.locator('.route-row[aria-current="step"]');
  await expect(current).toBeEnabled();
  await current.focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__dbg.sessionContext().campaign)).toBe('sajo');
});

test('canonical bridge scenes are visible on the campaign route', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: /강호연대기/ }).click();
  const sajoCard=page.locator('.camp-card').filter({ hasText: '사조영웅전' });
  await sajoCard.getByRole('button', { name: '시작하기' }).click();
  await expect(page.getByText('대막의 약속 — 두 개의 고향')).toBeVisible();
  await expect(page.getByText('이평의 마지막 가르침')).toBeVisible();
  await expect(page.getByText('이야기 · 정사 보강', { exact:true })).toHaveCount(13);
});

test('campaign JSON files are auto-discovered and manifest registered', async ({ page }) => {
  const registry=await page.evaluate(() => ({
    discovered:window.__dbg.DISCOVERED_CAMPAIGN_IDS,
    registered:Object.keys(window.__dbg.CAMPAIGNS).sort(),
  }));
  expect(registry.discovered).toHaveLength(11);
  expect(registry.registered).toEqual([...registry.discovered,'chronicle'].sort());
  expect(registry.discovered).toEqual(expect.arrayContaining(['sajo','sinjo','uicheon','chunryong','wolnyeo','jinfinal']));
});

test('v3 save quarantines damaged sections and backup carries validation metadata', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('kimyong_save_v3',JSON.stringify({
      version:3,
      profile:'damaged-profile',
      campaigns:{sajo:{camp:'sajo',stageId:'s2'},sinjo:'damaged-campaign'},
      challenges:{endless:{bestWave:4}},
      legacy:{importedV2:['sajo']},
    }));
  });
  await page.reload();
  const report=await page.evaluate(() => {
    const saved=JSON.parse(localStorage.getItem('kimyong_save_v3'));
    const backup=window.__dbg.backupProbe();
    const partial=window.__dbg.backupInspection({app:'kangho',formatVersion:2,schemaVersion:3,data:{
      kimyong_save_v3:localStorage.getItem('kimyong_save_v3'),
      kimyong_v2_sajo:'{damaged',
    }});
    return {saved,backup,partial};
  });
  expect(report.saved.campaigns.sajo.stageId).toBe('s2');
  expect(report.saved.campaigns.sinjo).toBeUndefined();
  expect(report.saved.profile.settings.diff).toBe('std');
  expect(report.saved.quarantine.issues.map(issue=>issue.path)).toEqual(expect.arrayContaining(['profile','campaigns.sinjo']));
  expect(report.backup).toMatchObject({app:'kangho',formatVersion:2,schemaVersion:3});
  expect(report.backup.validation.valid).toBe(false);
  expect(report.partial).toMatchObject({ok:true,count:1});
  expect(report.partial.issues.map(issue=>issue.path)).toEqual(expect.arrayContaining([
    'kimyong_save_v3.profile',
    'kimyong_save_v3.campaigns.sinjo',
    'kimyong_v2_sajo',
  ]));
});

test('legacy v2 migration keeps valid campaigns and quarantines damaged siblings', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('kimyong_v2_sajo',JSON.stringify({camp:'sajo',stageId:'s3',gold:777,roster:['gj']}));
    localStorage.setItem('kimyong_v2_sinjo','{damaged');
  });
  await page.reload();
  const saved=await page.evaluate(() => JSON.parse(localStorage.getItem('kimyong_save_v3')));
  expect(saved.campaigns.sajo).toMatchObject({camp:'sajo',stageId:'s3',gold:777});
  expect(saved.campaigns.sinjo).toBeUndefined();
  expect(saved.legacy.importedV2).toContain('sajo');
  expect(saved.quarantine.issues.map(issue=>issue.path)).toContain('legacy.campaigns.sinjo');
});

test('session runtime identifies campaign mode without battle-engine mode flags', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button',{name:/강호연대기/}).click();
  const card=page.locator('.camp-card').filter({hasText:'사조영웅전'});
  await card.getByRole('button',{name:'시작하기'}).click();
  const session=await page.evaluate(() => window.__dbg.sessionContext());
  expect(session.context).toMatchObject({mode:'campaign',campaignId:'sajo'});
  expect(session.campaign).toBe('sajo');
  expect(session.challenge).toBeNull();
});

test('U6 enriches all four main campaigns with the requested ensembles', async ({ page }) => {
  const report=await page.evaluate(() => {
    const ids=['sajo','sinjo','uicheon','chunryong'];
    const stages=Object.fromEntries(ids.map(id=>[id,Object.values(window.__dbg.CAMPAIGNS[id].stages)]));
    return {
      counts:Object.fromEntries(ids.map(id=>[id,stages[id].filter(stage=>stage.id?.startsWith('u6_')).length])),
      corpus:Object.values(stages).flat().flatMap(stage=>stage.pre||[]).map(line=>line.t).join('\n'),
      wolnyeo:window.__dbg.CAMPAIGNS.wolnyeo,
      heroine:window.__dbg.CHARS.hsy.base,
    };
  });
  expect(report.counts).toEqual({sajo:5,sinjo:4,uicheon:4,chunryong:8});
  for(const name of ['전진칠자','곡령풍','구천장','달이파','광명좌사 양소','육대파','사대악인','단정순','유탄지']) expect(report.corpus).toContain(name);
  expect(report.wolnyeo.startLvl).toBe(3);
  expect(report.wolnyeo.startInv.geumchang).toBe(3);
  expect(report.wolnyeo.stages.w2.enemies.find(enemy=>enemy.boss)).toMatchObject({guard:8,wait:2});
  expect(report.wolnyeo.stages.w3.enemies.find(enemy=>enemy.boss)).toMatchObject({boost:.85,guard:8,wait:2});
  expect(report.heroine.slice(0,7)).toEqual([30,10,6,8,7,11,10]);
});

test('U6 ensemble additions are playable battles, not dialogue-only scenes', async ({ page }) => {
  const report=await page.evaluate(() => {
    const ids=['sajo','sinjo','uicheon','chunryong'];
    const stages=Object.fromEntries(ids.map(id=>[id,Object.values(window.__dbg.CAMPAIGNS[id].stages)]));
    return {
      counts:Object.fromEntries(ids.map(id=>[id,stages[id].filter(stage=>stage.kind==='battle'&&stage.id?.startsWith('u6b_')).length])),
      deployed:Object.values(stages).flat().filter(stage=>stage.kind==='battle'&&stage.id?.startsWith('u6b_')).flatMap(stage=>[
        ...(stage.enemies||[]).map(enemy=>enemy.cid), ...(stage.joins||[]), ...(stage.deploy?.forced||[]),
      ]),
      named:['qjc','sbi','lsf','gcj','zjg','dlp','yso','ecj','yyn','ans','wjh','djs','aja','ytj','tst'].map(cid=>window.__dbg.CHARS[cid]?.name),
      aliasPortrait:window.__dbg.premiumPortraitURL('qjc','hero'),
    };
  });
  expect(report.counts).toEqual({sajo:4,sinjo:3,uicheon:3,chunryong:7});
  expect(report.deployed).toEqual(expect.arrayContaining(['qjc','sbi','gci','zjg','dlp','yso','yyn','ans','wjh','ytj','tst','jcc']));
  expect(report.named).toEqual(['구처기','손불이','육승풍','구천장','조지경','달이파','양소','은천정','엽이낭','악노삼','운중학','단정순','아자','유탄지','천산동모']);
  expect(report.aliasPortrait).toMatch(/portraits\/hero\/wjy\.webp$/);
});

test('Tianlong default ending is canon while survival endings stay IF-only', async ({ page }) => {
  const route=await page.evaluate(() => {
    const stages=window.__dbg.CAMPAIGNS.chunryong.stages;
    return {
      defaultEnding:stages.endgate.next.else,
      canonNext:stages.u5_tl_canon_end.next,
      conditionalEndings:stages.endgate.next.cond.map(branch => branch.to),
    };
  });
  expect(route.defaultEnding).toBe('u5_tl_canon_end');
  expect(route.canonNext).toBe('end_tragic');
  expect(route.conditionalEndings).not.toContain('u5_tl_canon_end');
});

test('campaign registry applies special objectives and runtime context', async ({ page }) => {
  const state=await page.evaluate(() => ({
    runtime:window.__dbg.runtimeContext(),
    sajo:window.__dbg.CAMPAIGNS.sajo.stages.s6.objective,
    sinjo:window.__dbg.CAMPAIGNS.sinjo.stages.s10.objective,
    uicheon:window.__dbg.CAMPAIGNS.uicheon.stages.s6b.objective,
    chunryong:window.__dbg.CAMPAIGNS.chunryong.stages.t6.objective,
  }));
  expect(state.runtime.mode).toBe('classic');
  expect(state.sajo.type).toBe('subdue');
  expect(state.sinjo.type).toBe('all');
  expect(state.sinjo.objectives).toHaveLength(2);
  expect(state.uicheon.type).toBe('survive');
  expect(state.chunryong.type).toBe('subdue');
});

test('main campaigns expose regional themes and at least three special battles each', async ({ page }) => {
  const report=await page.evaluate(() => {
    const ids=['sajo','sinjo','uicheon','chunryong'];
    const special=new Set(['survive','seize','escape','subdue','all','any']);
    return Object.fromEntries(ids.map(id=>{
      const stages=Object.values(window.__dbg.CAMPAIGNS[id].stages).filter(stage=>stage.kind==='battle');
      return [id,{special:stages.filter(stage=>special.has((stage.objective||stage.win||{}).type)).length,themes:stages.map(stage=>stage.sceneTheme).filter(Boolean)}];
    }));
  });
  for(const item of Object.values(report)) expect(item.special).toBeGreaterThanOrEqual(3);
  expect(report.sajo.themes).toEqual(expect.arrayContaining(['taohua','huashan']));
  expect(report.sinjo.themes).toContain('xiangyang');
  expect(report.uicheon.themes).toContain('guangming');
  expect(report.chunryong.themes).toContain('shaolin');
});

test('premium portraits and reputation consequences use the new systems', async ({ page }, testInfo) => {
  const result=await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',`<div id="portrait-probe">${window.__dbg.portraitMarkup('gj','awaken')}</div>`);
    return {
      hero:window.__dbg.premiumPortraitURL('gj','hero'),
      expression:window.__dbg.premiumPortraitURL('gj','hero','angry'),
      expanded:window.__dbg.premiumPortraitURL('oyb','hero'),
      fallback:window.__dbg.premiumPortraitURL('not-a-character','hero'),
      rep:window.__dbg.reputationProbe({hyeop:3,jeong:2,se:4},{개방:2}),
      objective:window.__dbg.objectiveProbe({type:'seize',tiles:[[2,3]]},{turn:1,pendingReinf:false,units:[{team:'P',alive:true,x:2,y:3}]}),
    };
  });
  expect(result.hero).toMatch(/portraits\/hero\/gj\.webp$/);
  expect(result.expression).toMatch(/portraits\/expressions\/gj-angry\.webp$/);
  expect(result.expanded).toMatch(/portraits\/hero\/oyb\.webp$/);
  expect(result.fallback).toBeNull();
  expect(result.rep.price).toBe(88);
  expect(result.rep.loot).toBe(1.2);
  expect(result.rep.bond).toBe(2);
  expect(result.rep.combat).toMatchObject({repDef:1,repAtk:1,repHit:4});
  expect(result.objective).toEqual({won:true,progress:'1/1 지점'});
  await expect(page.locator('#portrait-probe image')).toHaveAttribute('href',/portraits\/expressions\/gj-awaken\.webp$/);
  await expect(page.locator('#portrait-probe svg')).toHaveAttribute('data-expression','awaken');
  await expect(page.locator('#portrait-probe .portrait-vector-fallback')).toHaveCSS('display','none');
  await expect(page.locator('#portrait-probe svg > path, #portrait-probe svg > circle:not(:first-of-type)')).toHaveCount(0);
  if(process.env.R16_VISUAL){
    await page.locator('#portrait-probe').evaluate(el=>Object.assign(el.style,{position:'fixed',zIndex:'9999',width:'min(420px,90vw)',left:'50%',top:'50%',transform:'translate(-50%,-50%)',background:'#171411',padding:'18px',border:'1px solid #b99657',boxShadow:'0 20px 70px #000'}));
    await page.screenshot({path:`test-results/r16-${testInfo.project.name}-portrait.png`,fullPage:true});
  }
});

test('mastery, promotion, and scenario feasibility expose their real effects', async ({ page }) => {
  const result=await page.evaluate(() => ({
    mastery:[0,8,20,40,70].map(uses=>window.__dbg.masteryProbe('seoncheon',uses)),
    healing:window.__dbg.masteryProbe('jeonjin',70),
    promotion:window.__dbg.promotionProbe('wjy'),
    hwalsa:window.__dbg.CAMPAIGNS.hwalsa.stages.h3,
    tower:window.__dbg.CAMPAIGNS.uicheon.stages.s7,
  }));
  expect(result.mastery.map(m=>[m.tier,m.power,m.hit,m.costDown])).toEqual([
    [0,0,0,0],[1,4,2,0],[2,8,4,1],[3,12,6,1],[4,16,8,2],
  ]);
  expect(result.healing).toMatchObject({tier:4,heal:4,costDown:2});
  expect(result.promotion.text).toContain('중신통(中神通)');
  expect(result.promotion.text).toContain('일양지 습득');
  expect(result.hwalsa.enemies.find(e=>e.cid==='oyb')).toMatchObject({guard:8,wait:2});
  expect(result.hwalsa.bossPhases.every(p=>p.guard===false)).toBe(true);
  expect(result.tower.joins).toContain('mgyo');
  expect(result.tower.deploy.cap).toBe(4);
  expect(result.tower.deploy.forced).toHaveLength(4);
  expect(result.tower.objective.tiles).toHaveLength(4);
});

test('manual update prompt is readable and dismissible', async ({ page }) => {
  await page.evaluate(() => window.__pwa.showUpdateNotice({kind:'update'}));
  const notice=page.locator('#update-notice');
  await expect(notice).toBeVisible();
  await expect(notice.getByText('새 강호 기록이 도착했습니다')).toBeVisible();
  await expect(notice.getByRole('button', { name:'업데이트 적용' })).toBeVisible();
  await notice.getByRole('button', { name:'알림 닫기' }).click();
  await expect(notice).toHaveCount(0);
});

test('seeded roam creates a ten-node route and enters deployment', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: /도전과 회상/ }).click();
  await page.getByRole('button', { name: /유람 시작/ }).click();
  await page.getByLabel('시드 코드').fill('R17-SMOKE');
  await page.getByRole('button', { name: '새 유람' }).click();
  await expect(page.getByText('SEED R17-SMOKE')).toBeVisible();
  await expect(page.locator('.roam-node')).toHaveCount(10);
  await expect(page.locator('.roam-party span')).toHaveCount(4);
  await page.getByRole('button', { name: '격전으로' }).click();
  await expect(page.getByRole('heading', { name: /출전 준비/ })).toBeVisible();
  await expect(page.getByText(/승리 조건: 습격자 격파/)).toBeVisible();
  await page.getByRole('button', { name: '출 전 !' }).click();
  await expect(page.locator('.intent-mark')).toHaveCount(5);
  await expect(page.locator('.intent-mark text')).toHaveCount(0);
  await expect(page.locator('.intent-mark title').first()).toHaveText(/공격 예고|이동 예고|대기 예고/);
  await expect(page.locator('.unit-type-mark')).toHaveCount(9);
  await expect(page.locator('.unit-type-mark text')).toHaveCount(0);
  await expect(page.locator('.unit-type-mark title').first()).toHaveText(/외공|경공|내공/);
  await expect(page.locator('#battle-depth .depth-layer')).toHaveCount(3);
  await expect(page.locator('#mapwrap')).toHaveAttribute('data-time', /dawn|day|dusk|night/);
  if(process.env.R16_VISUAL) await page.screenshot({ path:`test-results/r16-${testInfo.project.name}-battle.png`, fullPage:true });
  await page.evaluate(() => window.__dbg.previewCutin());
  await expect(page.locator('.martial-cutin')).toBeVisible();
  await expect(page.locator('.cutin-portrait.main svg')).toHaveAttribute('data-expression', 'awaken');
  if(process.env.R16_VISUAL) await page.screenshot({ path:`test-results/r16-${testInfo.project.name}-cutin.png`, fullPage:true });
  await expect(page.locator('.martial-cutin')).toHaveCount(0);
  await page.getByRole('button', { name:'⚙' }).click();
  const reduced=page.locator('.set-sec').filter({ hasText:'저효과 모드' });
  await reduced.getByRole('button', { name:'꺼짐' }).click();
  await page.getByRole('button', { name:'닫기' }).click();
  await expect(page.locator('#mapwrap')).toHaveClass(/reduced-fx/);
  await page.evaluate(() => window.__dbg.previewCutin());
  await expect(page.locator('.martial-cutin')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '턴 종료' })).toBeEnabled();
  if(testInfo.project.name==='mobile-chromium'){
    await expect(page.locator('#battle-mobile-bar')).toBeVisible();
    await expect(page.locator('#battle-mobile-bar').getByRole('button')).toHaveCount(4);
  }
});

test('legacy classic save is copied into the unified chronicle', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('kimyong_srpg_save_v1', JSON.stringify({ch:2,roster:{},party:[],extra:{},diff:'std'}));
  });
  await page.reload();
  const migrated=await page.evaluate(() => JSON.parse(localStorage.getItem('kimyong_save_v3')));
  const legacyStillPresent=await page.evaluate(() => localStorage.getItem('kimyong_srpg_save_v1') !== null);
  expect(migrated.version).toBe(3);
  expect(migrated.campaigns.chronicle.cleared).toEqual(['ch01','ch02']);
  expect(legacyStillPresent).toBe(true);
});
