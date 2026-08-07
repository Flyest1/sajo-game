import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => !!window.__dbg?.CAMPAIGNS);
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
  await page.getByRole('button',{name:/설정/}).click();
  await page.getByRole('button',{name:'검사·복구'}).click();
  await expect(page.getByRole('heading',{name:'저장 검사·복구'})).toBeVisible();
  await expect(page.getByText('profile',{exact:true})).toBeVisible();
  await expect(page.getByText('campaigns.sinjo',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'닫기'}).click();
  const restored=await page.evaluate(() => {
    const payload=window.__dbg.backupProbe();
    const save=JSON.parse(payload.data.kimyong_save_v3);
    save.profile.settings.diff='story';
    payload.data.kimyong_save_v3=JSON.stringify(save);
    const result=window.__dbg.backupRestore(payload);
    return {result,saved:JSON.parse(localStorage.getItem('kimyong_save_v3'))};
  });
  expect(restored.result.ok).toBe(true);
  expect(restored.saved.profile.settings.diff).toBe('story');
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

test('automatic campaign checkpoint restores the pre-deploy state', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button',{name:/강호연대기/}).click();
  const card=page.locator('.camp-card').filter({hasText:'사조영웅전'});
  await card.getByRole('button',{name:'시작하기'}).click();
  const checkpoint=await page.evaluate(() => {
    const state=window.__dbg.campaignState;
    state.stageId='s2'; state.gold=321;
    window.__dbg.openCurrentDeploy();
    return window.__dbg.checkpointProbe().history[0];
  });
  expect(checkpoint).toMatchObject({kind:'deploy',campaignId:'sajo',stageId:'s2'});
  await page.evaluate(() => { window.__dbg.campaignState.gold=999; window.showSettings(); });
  await page.getByRole('button',{name:'검사·복구'}).click();
  await expect(page.getByText('제1막  대막의 결투 · 출전 직전')).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'복구'}).first().click();
  expect(await page.evaluate(() => window.__dbg.campaignState.gold)).toBe(321);
});

test('campaign rewind restores a recorded choice snapshot', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button',{name:/강호연대기/}).click();
  const card=page.locator('.camp-card').filter({hasText:'사조영웅전'});
  await card.getByRole('button',{name:'시작하기'}).click();
  await page.evaluate(() => {
    const current=window.__dbg.campaignState;
    const snapshot=JSON.parse(JSON.stringify(current));
    delete snapshot.curBattle; snapshot.gold=111; snapshot.stageId='s1'; snapshot.history=[];
    current.gold=999;
    current.history=[{stageId:'s1',title:'검증 분기',label:'이전 선택',at:Date.now(),state:snapshot}];
    window.showRewindHistory();
  });
  await page.getByRole('button',{name:'이 지점으로'}).click();
  expect(await page.evaluate(() => window.__dbg.campaignState.gold)).toBe(111);
});

test('R18 third pass records trust and preserves seen branches across rewind', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => {
    window.startCampaignV2('sajo',false);
    window.__dbg.campaignState.stageId='c5a';
    window.v2Enter();
  });
  await page.getByRole('button',{name:/정\(情\)으로/}).click();
  const changed=await page.evaluate(() => ({
    rep:window.__dbg.campaignState.reputation,
    trust:window.__dbg.campaignState.trusts.ygang,
    memory:window.__dbg.campaignState.choiceMemory.c5a,
    tier:window.__dbg.relationshipProbe(2,'ygang'),
  }));
  expect(changed.rep.jeong).toBe(2);
  expect(changed.trust).toBe(2);
  expect(changed.memory.seen).toEqual([0]);
  expect(changed.tier).toMatchObject({faction:{label:'우호'},trust:{label:'신뢰'},effects:{trustHit:3}});

  await page.evaluate(() => window.showRouteMap());
  await page.getByRole('button',{name:'강호 관계록'}).click();
  await expect(page.locator('#relation-modal')).toContainText('양강');
  await expect(page.locator('#relation-modal')).toContainText('신뢰');
  await page.locator('#relation-modal').getByRole('button',{name:'닫기'}).click();
  await page.getByRole('button',{name:/강호 회고/}).click();
  await page.getByRole('button',{name:'이 지점으로'}).click();
  await expect(page.getByRole('button',{name:/정\(情\)으로.*확인한 분기/})).toBeVisible();
  await expect(page.getByRole('button',{name:/의\(義\)로.*미확인 분기/})).toBeVisible();
  const rewound=await page.evaluate(() => ({rep:window.__dbg.campaignState.reputation.jeong,trust:window.__dbg.campaignState.trusts.ygang||0,memory:window.__dbg.campaignState.choiceMemory.c5a.seen}));
  expect(rewound).toEqual({rep:0,trust:0,memory:[0]});
});

test('hero gathering allows Wang Chongyang and only loses after all allies retreat', async ({ page }) => {
  await page.evaluate(() => { localStorage.clear(); window.startEndless(); });
  const wang=page.locator('.dep-card').filter({hasText:'왕중양'});
  await expect(wang).toBeEnabled();
  if(await wang.getAttribute('aria-pressed')==='false'){
    const reserve=page.locator('.dep-card[aria-pressed="true"]:not(:disabled)').first();
    await reserve.click();
    await wang.click();
  }
  await expect(wang).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:/출 전/}).click();
  await expect.poll(() => page.evaluate(() => !!window.__dbg.B)).toBe(true);
  const outcome=await page.evaluate(() => {
    const battle=window.__dbg.B;
    const leader=battle.units.find(unit=>unit.cid==='gj'&&unit.team==='P');
    leader.alive=false;
    const leaderResult=window.__dbg.winCheck(), overAfterLeader=battle.over;
    battle.units.filter(unit=>unit.team==='P').forEach(unit=>{unit.alive=false;});
    const allResult=window.__dbg.winCheck();
    return {leaderResult,overAfterLeader,allResult,overAfterAll:battle.over,lose:window.__dbg.challengeState.ch.lose};
  });
  expect(outcome).toEqual({leaderResult:false,overAfterLeader:false,allResult:true,overAfterAll:true,lose:'전원 퇴각 시 패배'});
  const finalRules=await page.evaluate(() => Object.values(window.__dbg.CAMPAIGNS.jinfinal.stages).filter(stage=>stage.kind==='battle').map(stage=>stage.defeat?.type));
  expect(finalRules).toEqual(['all','all']);
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
  await expect(notice.getByRole('button', { name:'지금 적용' })).toBeVisible();
  await expect(notice.getByRole('button', { name:'캐시 복구' })).toBeVisible();
  await notice.getByRole('button', { name:'알림 닫기' }).click();
  await expect(notice).toHaveCount(0);
});

test('PWA build identity and recovery APIs are available without touching saves', async ({ page }) => {
  const pwa=await page.evaluate(async () => ({
    version:window.__pwa.version,
    title:document.title,
    build:document.documentElement.dataset.appVersion,
    cache:await window.__pwa.inspectPwaCache(),
    apis:['checkForUpdate','inspectPwaCache','repairPwaCache'].map(name=>typeof window.__pwa[name]),
  }));
  expect(pwa.version).toMatch(/^R20-/);
  expect(pwa.title).toContain(pwa.version);
  expect(pwa.build).toBe(pwa.version);
  expect(pwa.apis).toEqual(['function','function','function']);
  expect(Array.isArray(pwa.cache.appCaches)).toBe(true);
});

test('R20 event growth rewards and update controls expose their actual effects', async ({ page }) => {
  const rewards=await page.evaluate(() => window.__dbg.growthRewardsProbe(
    {camp:'chunryong',stageId:null,cleared:[]},
    {camp:'chunryong',stageId:'dy1',cleared:['dy1']},
    ['dy'],
  ));
  expect(rewards.map(item=>item.id)).toEqual(['dy_beiming','dy_lingbo']);
  expect(rewards[0]).toMatchObject({cid:'dy',name:'북명신공'});
  expect(rewards[0].effectText).toContain('적중 시 기력 +2');

  await page.evaluate(() => window.showSettings());
  const settings=page.locator('#set-modal');
  await expect(settings.getByRole('button',{name:'새 버전 검사'})).toBeVisible();
  await expect(settings.getByRole('button',{name:'캐시 복구'})).toBeVisible();
  await expect(settings).toContainText('저장 기록은 유지');
});

test('seeded roam keeps direct movement and shows the action menu after moving', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: /도전과 회상/ }).click();
  await page.getByRole('button', { name: /유람 시작/ }).click();
  await page.getByLabel('시드 코드').fill('R17-SMOKE');
  await page.getByRole('button', { name: '새 유람' }).click();
  await expect(page.getByText('SEED R17-SMOKE')).toBeVisible();
  const nodeCount=await page.locator('.roam-node').count();
  expect(nodeCount).toBeGreaterThanOrEqual(12);
  expect(nodeCount).toBeLessThanOrEqual(15);
  await expect(page.locator('.roam-party span')).toHaveCount(4);
  const nodeTypes=await page.evaluate(() => window.__dbg.challengeState.nodes);
  expect(nodeTypes).toEqual(expect.arrayContaining(['shop','faction','camp','event','battle','boss']));
  await page.getByRole('button', { name: '격전으로' }).click();
  await expect(page.getByRole('heading', { name: /출전 준비/ })).toBeVisible();
  await expect(page.getByText(/승리 조건: 습격자 격파/)).toBeVisible();
  await page.getByRole('button', { name: '출 전 !' }).click();
  const firstUid=await page.evaluate(() => window.__dbg.B.units.find(unit=>unit.team==='P').uid);
  const directMove=async()=>{
    await page.locator(`#ug-${firstUid}`).click();
    await expect.poll(() => page.evaluate(() => window.__dbg.B.mode)).toBe('move');
    const actionMenu=page.getByRole('menu');
    await expect(actionMenu).toHaveCount(0);
    const destination=await page.evaluate(() => {
      const battle=window.__dbg.B,unit=battle.sel;
      return [...battle.mr.keys()].map(key=>key.split(',').map(Number))
        .filter(([x,y])=>(x!==unit.x||y!==unit.y)&&!battle.units.some(other=>other.alive&&other.x===x&&other.y===y))
        .sort((a,b)=>(Math.abs(a[0]-unit.x)+Math.abs(a[1]-unit.y))-(Math.abs(b[0]-unit.x)+Math.abs(b[1]-unit.y)))[0];
    });
    expect(destination).toBeTruthy();
    const mapBox=await page.locator('#mapsvg').boundingBox();
    const mapSize=await page.evaluate(() => ({w:window.__dbg.B.w,h:window.__dbg.B.h}));
    await page.mouse.click(mapBox.x+(destination[0]+.5)*mapBox.width/mapSize.w,mapBox.y+(destination[1]+.5)*mapBox.height/mapSize.h);
    await expect(actionMenu).toBeVisible();
    await expect(actionMenu).toHaveAttribute('aria-label',/행동$/);
    await expect(actionMenu.getByRole('button',{name:'이동'})).toHaveCount(0);
    const placement=await actionMenu.evaluate(el=>{const r=el.getBoundingClientRect();return {parent:el.parentElement.tagName,position:getComputedStyle(el).position,top:r.top,bottom:r.bottom,height:innerHeight};});
    await actionMenu.getByRole('button',{name:'취소'}).click();
    return placement;
  };
  const portrait=await directMove();
  expect(portrait).toMatchObject({parent:'BODY',position:'fixed'});
  expect(portrait.top).toBeGreaterThanOrEqual(0);
  expect(portrait.bottom).toBeLessThanOrEqual(portrait.height);
  if(testInfo.project.name==='mobile-chromium'){
    const originalViewport=page.viewportSize();
    await page.setViewportSize({width:851,height:393});
    const landscape=await directMove();
    expect(landscape).toMatchObject({parent:'BODY',position:'fixed'});
    expect(landscape.top).toBeGreaterThanOrEqual(0);
    expect(landscape.bottom).toBeLessThanOrEqual(landscape.height);
    await page.setViewportSize(originalViewport);
  }
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
  await page.evaluate(() => window.__dbg.forceDefeat());
  await expect(page.getByRole('heading',{name:'유람 중 패배'})).toBeVisible();
  await page.getByRole('button',{name:'재도전'}).click();
  await expect(page.getByRole('heading',{name:/출전 준비/})).toBeVisible();
});

test('R17 roam shop, faction build, and completion legends persist', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: /도전과 회상/ }).click();
  await page.getByRole('button', { name: /유람 시작/ }).click();
  await page.getByLabel('시드 코드').fill('R17-BUILD');
  await page.getByRole('button', { name: '새 유람' }).click();

  const shopPos=await page.evaluate(() => window.__dbg.challengeState.nodes.indexOf('shop'));
  await page.evaluate(pos => { window.__dbg.challengeState.pos=pos; window.showRoamMap(); },shopPos);
  await page.getByRole('button',{name:'장터로'}).click();
  const beforeShop=await page.evaluate(() => ({coins:window.__dbg.challengeState.coins,stats:{...window.__dbg.G.roster[window.__dbg.G.party[0]].stats}}));
  const relic=page.locator('.roam-shop-item:not([disabled])').first();
  await relic.click();
  const afterShop=await page.evaluate(() => ({coins:window.__dbg.challengeState.coins,relics:window.__dbg.challengeState.relics,stats:{...window.__dbg.G.roster[window.__dbg.G.party[0]].stats}}));
  expect(afterShop.coins).toBeLessThan(beforeShop.coins);
  expect(afterShop.relics).toHaveLength(1);
  expect(Object.keys(afterShop.stats).some(key=>afterShop.stats[key]>beforeShop.stats[key])).toBe(true);

  const factionPos=await page.evaluate(() => window.__dbg.challengeState.nodes.indexOf('faction'));
  await page.evaluate(pos => { window.__dbg.challengeState.pos=pos; window.showRoamMap(); },factionPos);
  await page.getByRole('button',{name:'문파 사건으로'}).click();
  await page.getByRole('button',{name:/함께 지킨다/}).click();
  const faction=await page.evaluate(() => window.__dbg.challengeState.factions);
  expect(Math.max(...Object.values(faction))).toBe(2);

  await page.evaluate(() => { const run=window.__dbg.challengeState;run.pos=run.nodes.length-1;window.showRoamMap(); });
  await page.getByRole('button',{name:'고수에게'}).click();
  await page.getByRole('button',{name:'출 전 !'}).click();
  await page.evaluate(() => { window.__dbg.B.units.filter(unit=>unit.team==='E').forEach(unit=>{unit.alive=false;});window.__dbg.winCheck(); });
  await expect(page.getByRole('heading',{name:'강호에 이름을 남기다'})).toBeVisible();
  await expect(page.locator('.legend-card')).toHaveCount(4);
  const legends=await page.evaluate(() => window.__dbg.roamProbe().legends);
  expect(legends).toHaveLength(4);
  expect(legends.every(item=>item.title&&item.scar&&item.seed==='R17-BUILD')).toBe(true);
});

test('Tianxia Lunjian runs eight data-driven rounds and persists blessings and records', async ({ page }, testInfo) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button',{name:/도전과 회상/}).click();
  await expect(page.getByRole('heading',{name:'천하논검'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'전투 수수께끼'})).toBeVisible();
  await page.getByRole('button',{name:/논검 시작/}).click();
  await expect(page.locator('.lunjian-picks .dep-card')).toHaveCount(12);
  if(process.env.CHALLENGE_VISUAL) await page.screenshot({path:`test-results/challenge-lunjian-${testInfo.project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'네 협객으로 시작'}).click();
  await expect(page.locator('.gauntlet-node')).toHaveCount(8);
  await page.getByRole('button',{name:/1관 출전 준비/}).click();
  await expect(page.locator('.dep-card[aria-pressed="true"]')).toHaveCount(4);
  await page.getByRole('button',{name:/출 전/}).click();
  const battle=await page.evaluate(() => ({mode:window.__dbg.challengeState.mode,boss:window.__dbg.B.units.find(unit=>unit.boss)?.cid,party:window.__dbg.B.units.filter(unit=>unit.team==='P').length}));
  expect(battle).toEqual({mode:'lunjian',boss:'mcp',party:4});
  await page.evaluate(() => { const boss=window.__dbg.B.units.find(unit=>unit.boss);boss.alive=false;window.__dbg.winCheck(); });
  await expect(page.getByRole('heading',{name:'1관 돌파'})).toBeVisible();
  const before=await page.evaluate(() => ({...window.__dbg.G.roster.gj.stats}));
  await page.getByRole('button',{name:/파진결/}).click();
  const after=await page.evaluate(() => ({stats:{...window.__dbg.G.roster.gj.stats},run:window.__dbg.challengeProbe().lunjian.current}));
  expect(after.stats.str).toBe(before.str+1);
  expect(after.stats.int).toBe(before.int+1);
  expect(after.run).toMatchObject({round:1,blessings:['power']});

  await page.reload();
  await page.getByRole('button',{name:/이어하기 · 천하논검/}).click();
  await expect(page.getByRole('button',{name:/2관 출전 준비/})).toBeVisible();

  await page.evaluate(() => { window.__dbg.challengeState.round=7;window.showLunjianMap(); });
  await page.getByRole('button',{name:/8관 출전 준비/}).click();
  await page.getByRole('button',{name:/출 전/}).click();
  await page.evaluate(() => { const boss=window.__dbg.B.units.find(unit=>unit.boss);boss.alive=false;window.__dbg.winCheck(); });
  await expect(page.getByRole('heading',{name:'천하논검 제패'})).toBeVisible();
  const records=await page.evaluate(() => window.__dbg.challengeProbe().lunjian);
  expect(records.bestRound).toBe(8);
  expect(records.records).toHaveLength(1);
  expect(records.current).toBeUndefined();
});

test('canonical internal styles are selectable and battle contribution reports persist', async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const canonical=await page.evaluate(() => {
    const guo=window.__dbg.internalProbe('gj'),wuji=window.__dbg.internalProbe('jmk');
    return {guo:{...guo,names:guo.options.map(id=>window.__dbg.INTERNALS[id].name)},wuji:{...wuji,names:wuji.options.map(id=>window.__dbg.INTERNALS[id].name)}};
  });
  expect(canonical.guo.item.name).toBe('구음진경');
  expect(canonical.guo.options).toHaveLength(2);
  expect(canonical.guo.names).not.toContain('구양신공');
  expect(canonical.wuji.names).toContain('구양신공');

  await page.evaluate(() => { window.startCampaignV2('sajo',false); window.__dbg.campaignState.stageId='s3'; window.openInternalLoadout('gj'); });
  await expect(page.locator('.internal-pick.locked')).toContainText('구음진경');
  await expect(page.locator('.internal-pick.locked')).toContainText('사건 해금');
  await expect(page.locator('.internal-pick:not(.locked)')).toContainText('전진현문내공');
  await page.evaluate(() => { document.getElementById('internal-modal')?.remove(); localStorage.clear(); });
  await page.reload();

  await page.getByRole('button',{name:/도전과 회상/}).click();
  await page.getByRole('button',{name:/논검 시작/}).click();
  await page.getByLabel('곽정 내공·특성').selectOption('gj_quanzhen');
  await page.getByRole('button',{name:'네 협객으로 시작'}).click();
  const saved=await page.evaluate(() => window.__dbg.challengeProbe().lunjian.current.internals);
  expect(saved.gj).toBe('gj_quanzhen');
  await page.getByRole('button',{name:/1관 출전 준비/}).click();
  await page.getByRole('button',{name:/출 전/}).click();
  const unit=await page.evaluate(() => {
    const guo=window.__dbg.B.units.find(item=>item.cid==='gj');
    return {internalId:guo.internalId,name:guo.internal.name,maxki:guo.maxki};
  });
  expect(unit).toMatchObject({internalId:'gj_quanzhen',name:'전진현문내공'});
  await page.evaluate(() => {
    window.__dbg.B.contributions.gj.damage=17;
    window.__dbg.B.contributions.gj.guard=4;
    window.__dbg.B.units.find(item=>item.boss).alive=false;
    window.__dbg.winCheck();
  });
  await expect(page.locator('.contribution-row').filter({hasText:'곽정'})).toContainText('피해 17 · 파훼 4');
  const reports=await page.evaluate(() => window.__dbg.battleReports());
  expect(reports[0]).toMatchObject({mode:'lunjian'});
  expect(reports[0].members[0]).toMatchObject({cid:'gj',damage:17,guard:4,internalId:'gj_quanzhen'});
  const persisted=await page.evaluate(() => JSON.parse(localStorage.getItem('kimyong_save_v3')).profile.battleReports);
  expect(persisted).toHaveLength(1);
});

test('R19 enemy martial counters are original-based, readable, and attached to battle units', async ({ page }, testInfo) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const rules=await page.evaluate(() => ({
    count:Object.keys(window.__dbg.ENEMY_MARTIALS).length,
    actionCount:Object.values(window.__dbg.ENEMY_MARTIALS).filter(style=>style.actions?.length).length,
    toad:window.__dbg.enemyMartialProbe('oyb',{attackerType:'경',adjacentAllies:0,comboStep:0}),
    toadMiss:window.__dbg.enemyMartialProbe('oyb',{attackerType:'외',adjacentAllies:0,comboStep:0}),
    reflect:window.__dbg.enemyMartialProbe('myb',{attackerType:'내',adjacentAllies:1,comboStep:0}),
    before:window.__dbg.internalUnlockProbe('gj_jiuyin',{camp:'sajo',stageId:'s7',cleared:['s3']}),
    after:window.__dbg.internalUnlockProbe('gj_jiuyin',{camp:'sajo',stageId:'c7',cleared:['s3','s7']}),
    miejue:window.__dbg.CHARS.myeoljeol.skills,
  }));
  expect(rules.count).toBe(20);
  expect(rules.actionCount).toBe(20);
  expect(rules.toad.style.name).toBe('합마공·역구음');
  expect(rules.toad.counter.active).toBe(true);
  expect(rules.toadMiss.counter.active).toBe(false);
  expect(rules.reflect.counter.active).toBe(true);
  expect(rules.before).toMatchObject({unlocked:false});
  expect(rules.after).toMatchObject({unlocked:true});
  expect(rules.miejue).toContain('emei');
  expect(rules.miejue).not.toContain('wolnyeo');

  await page.evaluate(() => {
    window.startCampaignV2('sajo',false);
    window.__dbg.campaignState.stageId='s2';
    window.__dbg.openCurrentDeploy();
  });
  await page.getByRole('button',{name:/출 전/}).click();
  const battle=await page.evaluate(() => {
    const boss=window.__dbg.B.units.find(unit=>unit.cid==='mcp');
    const ally=window.__dbg.B.units.find(unit=>unit.team==='P'&&unit.type==='외');
    const strike=window.__dbg.calc(ally,boss,ally.skills[0]);
    return {uid:boss.uid,name:boss.martial.name,tell:boss.martial.tell,counter:strike.martialCounter,guardDmg:strike.guardDmg};
  });
  expect(battle.name).toBe('구음백골조');
  expect(battle.tell).toContain('급습');
  expect(battle.counter.active).toBe(true);
  expect(battle.guardDmg).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => window.__dbg.inspectUnit('mcp'));
  await expect(page.locator('.enemy-martial')).toContainText('구음백골조');
  await expect(page.locator('.enemy-martial')).toContainText('파훼:');
  if(process.env.R19_VISUAL){await page.waitForTimeout(1300);await page.evaluate(() => window.__dbg.inspectUnit('mcp'));await page.screenshot({path:`test-results/r19-enemy-${testInfo.project.name}.png`,fullPage:true});}
});

test('event unlocks and unified formation cards work on desktop and mobile', async ({ page }, testInfo) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => {
    window.startCampaignV2('sajo',false);
    const state=window.__dbg.campaignState,c=window.__dbg.CHARS.gj,keys=['hp','str','int','def','res','spd','skl','mov','ki'];
    state.party=['gj'];
    state.roster.gj={cid:'gj',lvl:8,exp:0,stats:Object.fromEntries(keys.map((key,index)=>[key,c.base[index]]))};
    state.cleared=['s3'];
    window.campFromRoute();
  });
  const card=page.locator('.formation-card[data-cid="gj"]');
  await expect(card).toBeVisible();
  await expect(card.getByText('전진현문내공')).toBeVisible();
  await expect(card.locator('.formation-stats')).toContainText('→');
  await card.getByRole('button',{name:'전진현문내공'}).click();
  await expect(page.locator('.internal-pick.locked')).toContainText('구음진경');
  await expect(page.locator('.internal-pick.locked')).toContainText('도화도에서 주백통');
  await page.getByRole('button',{name:'완료'}).click();
  await page.evaluate(() => { window.__dbg.campaignState.cleared.push('s7'); window.campFromRoute(); });
  await card.getByRole('button',{name:/전진현문내공|구음진경/}).click();
  await expect(page.locator('.internal-pick.locked')).toHaveCount(0);
  await page.getByRole('button',{name:'완료'}).click();
  await card.getByRole('button',{name:'파훼'}).click();
  await expect(card.getByRole('button',{name:'구음진경'})).toBeVisible();
  if(process.env.R19_VISUAL)await page.screenshot({path:`test-results/r19-formation-${testInfo.project.name}.png`,fullPage:true});
});

test('combat riddles expose ten deterministic trials and save the best medal', async ({ page }, testInfo) => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button',{name:/도전과 회상/}).click();
  await page.getByRole('button',{name:/수수께끼 풀기/}).click();
  await expect(page.locator('.trial-card')).toHaveCount(10);
  if(process.env.CHALLENGE_VISUAL) await page.screenshot({path:`test-results/challenge-trials-${testInfo.project.name}.png`,fullPage:true});
  await page.locator('.trial-card').first().click();
  await expect(page.getByRole('heading',{name:'전광의 한 수'})).toBeVisible();
  await page.getByRole('button',{name:'수수께끼 시작'}).click();
  await expect(page.locator('.dep-card')).toHaveCount(2);
  await page.getByRole('button',{name:/출 전/}).click();
  const deterministic=await page.evaluate(() => {
    const attacker=window.__dbg.B.units.find(unit=>unit.team==='P'),defender=window.__dbg.B.units.find(unit=>unit.team==='E');
    return {mode:window.__dbg.challengeState.mode,result:window.__dbg.calc(attacker,defender,attacker.skills[0])};
  });
  expect(deterministic.mode).toBe('trial');
  expect(deterministic.result).toMatchObject({hit:100,crit:0});
  await page.evaluate(() => { window.__dbg.B.turn=1;window.__dbg.B.units.filter(unit=>unit.team==='E').forEach(unit=>{unit.alive=false;});window.__dbg.winCheck(); });
  await expect(page.getByRole('heading',{name:/전광의 한 수/})).toBeVisible();
  await expect(page.getByText(/완전한 해법/)).toBeVisible();
  const probe=await page.evaluate(() => window.__dbg.challengeProbe());
  expect(probe).toMatchObject({rounds:8,trialCount:10,trials:{medals:{flash:'gold'}}});
  await page.getByRole('button',{name:'목록'}).click();
  await expect(page.locator('.trial-card.gold')).toHaveCount(1);
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
