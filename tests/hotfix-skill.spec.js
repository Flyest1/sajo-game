import {test,expect} from '@playwright/test';

async function openSkillBattle(page,url='./'){
  await page.goto(url);await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.evaluate(()=>{window.startCampaignV2('sajo',false);const state=window.__dbg.campaignState,campaign=window.__dbg.CAMPAIGNS.sajo;state.stageId=Object.keys(campaign.stages).find(id=>campaign.stages[id].kind==='battle');window.__dbg.openCurrentDeploy();});
  await page.getByRole('button',{name:/출 전/}).click();await expect(page.locator('#mapsvg')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__dbg.B?.busy)).toBe(false);
}

test('player martial skill completes cut-in, damage, and turn without freezing',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await openSkillBattle(page);
  const before=await page.evaluate(()=>{
    const battle=window.__dbg.B,attacker=battle.units.find(unit=>unit.team==='P'&&unit.alive&&unit.skills.some(sid=>!window.__dbg.SKILLS[sid].heal)),defender=battle.units.find(unit=>unit.team==='E'&&unit.alive);
    const skillId=attacker.skills.find(sid=>!window.__dbg.SKILLS[sid].heal);
    attacker.x=5;attacker.y=5;attacker.ki=99;attacker.acted=false;defender.x=6;defender.y=5;defender.hp=999;defender.maxhp=999;defender.range=[];
    battle.phase='P';battle.busy=false;battle.over=false;battle.sel=attacker;battle.pending={a:attacker,d:defender,skillId};
    window.confirmAttack();return {attacker:attacker.uid,defender:defender.uid,skillId,hp:defender.hp};
  });
  await expect.poll(()=>page.evaluate(uid=>window.__dbg.B?.units.find(unit=>unit.uid===uid)?.acted,before.attacker),{timeout:10_000}).toBe(true);
  const after=await page.evaluate(({uid,skillId})=>{const battle=window.__dbg.B,defender=battle.units.find(unit=>unit.uid===uid);return {busy:battle.busy,hp:defender.hp,skillUse:JSON.parse(localStorage.getItem('kimyong_mastery')||'{}')[skillId]||0,cutins:document.querySelectorAll('.martial-cutin').length};},{uid:before.defender,skillId:before.skillId});
  expect(after.busy).toBe(false);expect(after.hp).toBeLessThanOrEqual(before.hp);expect(after.skillUse).toBe(1);expect(after.cutins).toBe(0);expect(errors).toEqual([]);
});
