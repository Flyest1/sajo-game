import {test,expect} from '@playwright/test';
import fs from 'fs';

const readJson=file=>JSON.parse(fs.readFileSync(new URL(`../src/data/${file}`,import.meta.url),'utf8'));
const HWASAN22=readJson('stages_hwasan22.json');
const YITIAN_EXTRA=readJson('stages_uicheon_oejeon.json');
const UPDATES=readJson('battle_updates.json');
const EXPANSIONS=readJson('battle_expansions.json');
const MANIFEST=readJson('campaigns.json');

test('U8 source adaptations remain separated from canon',()=>{
  expect(MANIFEST.campaigns.hwasan22.canon).toContain('비공식');
  expect(MANIFEST.campaigns.uicheon_oejeon.canon).toContain('비공식');
  expect(MANIFEST.campaigns.uicheon.canon).toBe('원작 본편');
  expect(MANIFEST.groups.find(group=>group.id==='legends').campaigns).toEqual(expect.arrayContaining(['hwasan22','uicheon_oejeon']));
});

test('U8 Hwasan anthology covers all seven serialized character arcs',()=>{
  const battles=Object.values(HWASAN22.stages).filter(stage=>stage.kind==='battle');
  expect(battles).toHaveLength(7);
  expect(battles.map(stage=>stage.title).join(' ')).toMatch(/서독편.*동사편.*북개편.*남제편.*중신통편.*매초풍편.*양과후전/);
  expect(battles.every(stage=>stage.source==='noncanon')).toBe(true);
  expect(new Set(battles.map(stage=>stage.title)).size).toBe(7);
});

test('U8 Yitian extra converts the 18 chapters into eight complete operations',()=>{
  const battles=Object.values(YITIAN_EXTRA.stages).filter(stage=>stage.kind==='battle');
  expect(battles).toHaveLength(8);
  expect(battles.map(stage=>stage.title).join(' ')).toMatch(/활사인묘.*페르시아.*냉면인.*오행기.*파양호.*천응교.*광명정.*응천/);
  expect(battles.every(stage=>stage.source==='noncanon')).toBe(true);
  expect(YITIAN_EXTRA.stages.end.text.join(' ')).toContain('비공식');
});

test('U8 canonical Yitian repairs chronology and adds four missing battles',()=>{
  expect(UPDATES.campaigns.uicheon.s3.title).toContain('호접곡으로 가는 길');
  expect(UPDATES.campaigns.uicheon.s4.title).toContain('호접곡의 마지막 부탁');
  expect(UPDATES.campaigns.uicheon.s5.title).toContain('주장령의 절벽 함정');
  const ids=Object.values(EXPANSIONS.campaigns.uicheon.after).flat().map(stage=>stage.id);
  expect(ids).toEqual(expect.arrayContaining(['u8_yt_wangpan','u8_yt_green_manor','u8_yt_return_ship','u8_yt_vajra_circle']));
  for(const stage of Object.values(EXPANSIONS.campaigns.uicheon.after).flat().filter(stage=>stage.id.startsWith('u8_'))){
    expect(stage.source).toBe('canon');
    expect(EXPANSIONS.layouts[stage.layout]).toBeTruthy();
  }
});

test('U8 campaigns boot into a playable deployment on desktop and mobile',async({page})=>{
  await page.goto('./');await page.evaluate(()=>localStorage.clear());await page.reload();
  const result=await page.evaluate(()=>{
    const out={};
    for(const id of ['hwasan22','uicheon_oejeon']){
      window.startCampaignV2(id,false);
      const state=window.__dbg.campaignState,campaign=window.__dbg.CAMPAIGNS[id];
      window.__dbg.openCurrentDeploy();
      out[id]={stage:state.stageId,title:campaign.stages[state.stageId].title,party:state.party.length};
    }
    return out;
  });
  expect(result.hwasan22).toMatchObject({stage:'o1'});
  expect(result.uicheon_oejeon).toMatchObject({stage:'x1'});
  expect(result.hwasan22.party).toBeGreaterThanOrEqual(7);
  expect(result.uicheon_oejeon.party).toBeGreaterThanOrEqual(7);
  await expect(page.getByRole('button',{name:/출 전/})).toBeVisible();
});
