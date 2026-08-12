import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const SKILL_IDS=Object.keys(JSON.parse(readFileSync(new URL('../src/data/skills.json',import.meta.url),'utf8')));
const BATCH_SIZE=Math.ceil(SKILL_IDS.length/4);

async function openBattle(page){
  await page.goto('./');await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.evaluate(()=>{
    window.setSpeed(2);window.toggleReducedFx();document.getElementById('set-modal')?.remove();
    window.startCampaignV2('sajo',false);
    const state=window.__dbg.campaignState,campaign=window.__dbg.CAMPAIGNS.sajo;
    state.stageId=Object.keys(campaign.stages).find(id=>campaign.stages[id].kind==='battle');
    window.__dbg.openCurrentDeploy();
  });
  await page.getByRole('button',{name:/출 전/}).click();
  await expect(page.locator('#mapsvg')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__dbg.B?.busy)).toBe(false);
}

test.describe.configure({mode:'parallel'});

for(let offset=0;offset<SKILL_IDS.length;offset+=BATCH_SIZE){
  const batch=SKILL_IDS.slice(offset,offset+BATCH_SIZE);
  test(`R26 martial execution batch ${offset/BATCH_SIZE+1} clears every action lock`,async({page})=>{
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
    await openBattle(page);
    for(const sid of batch){
      const result=await page.evaluate(skillId=>window.__dbg.exerciseSkill(skillId),sid);
      expect(result,{message:`${sid} execution result`}).toMatchObject({accepted:true,ok:true,busy:false,locked:false,acted:true,masteryDelta:1,cutins:0});
      if(result.heal)expect(result.afterHp,`${sid} should heal`).toBeGreaterThan(result.beforeHp);
      else expect(result.afterHp,`${sid} should not increase enemy HP`).toBeLessThanOrEqual(result.beforeHp);
    }
    expect(pageErrors).toEqual([]);
  });
}

test('R26 duplicate confirmation consumes one action and one mastery use',async({page})=>{
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await openBattle(page);
  const before=await page.evaluate(()=>{
    const battle=window.__dbg.B,attacker=battle.units.find(unit=>unit.team==='P'&&unit.alive),defender=battle.units.find(unit=>unit.team==='E'&&unit.alive&&!unit.boss);
    const skillId=Object.keys(window.__dbg.SKILLS).find(id=>!window.__dbg.SKILLS[id].heal);
    battle.units.filter(unit=>unit.team==='P').forEach(unit=>unit.acted=true);
    const sentinel=battle.units.filter(unit=>unit.team==='P')[1];sentinel.acted=false;
    attacker.acted=false;attacker.ki=99;attacker.skills=[skillId];attacker.x=2;attacker.y=2;
    defender.alive=true;defender.hp=999;defender.maxhp=999;defender.guard=0;defender.broken=true;defender.range=[];defender.x=3;defender.y=2;
    battle.phase='P';battle.busy=false;battle.over=false;battle.actionLock=null;battle.pending={a:attacker,d:defender,skillId};
    const uses=JSON.parse(localStorage.getItem('kimyong_mastery')||'{}')[skillId]||0;
    window.confirmAttack();window.confirmAttack();
    return {uid:attacker.uid,skillId,uses};
  });
  await expect.poll(()=>page.evaluate(uid=>window.__dbg.B.units.find(unit=>unit.uid===uid)?.acted,before.uid)).toBe(true);
  const after=await page.evaluate(skillId=>({uses:JSON.parse(localStorage.getItem('kimyong_mastery')||'{}')[skillId]||0,busy:window.__dbg.B.busy,locked:!!window.__dbg.B.actionLock}),before.skillId);
  expect(after).toEqual({uses:before.uses+1,busy:false,locked:false});expect(pageErrors).toEqual([]);
});

test('R26 thrown skill error removes overlays and safely ends the acting unit',async({page})=>{
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await openBattle(page);
  const result=await page.evaluate(()=>window.__dbg.actionFailureProbe());
  expect(result).toEqual({accepted:true,ok:false,busy:false,locked:false,acted:true,cutins:0,recoveryLogged:true});
  expect(pageErrors).toEqual([]);
});
