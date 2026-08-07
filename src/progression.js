/* 사건 성장과 아이템 승급이 같은 판정을 공유하도록 분리한 순수 모듈. */
export function promotionUnlockState(promo,campaign){
  const rule=promo?.unlock;
  if(!rule)return {unlocked:true,label:''};
  if(!campaign||campaign.camp!==rule.campaign)return {unlocked:false,label:rule.label||'원작 사건 완료'};
  const cleared=campaign.cleared||[],reached=[campaign.stageId,...cleared].filter(Boolean);
  const clearedOk=!rule.clearedAny||rule.clearedAny.some(id=>cleared.includes(id));
  const reachedOk=!rule.reachedAny||rule.reachedAny.some(id=>reached.includes(id));
  return {unlocked:clearedOk&&reachedOk,label:rule.label||'원작 사건 완료'};
}

export function promotionStatus(promo,{level=0,inventory={},campaign=null,promoted=false}={}){
  if(!promo)return {available:false,levelOk:false,itemOk:false,eventOk:false};
  const unlock=promotionUnlockState(promo,campaign);
  const levelOk=level>=(promo.lvl||1);
  const itemOk=!promo.item||(inventory[promo.item]||0)>0;
  return {
    available:!promoted&&levelOk&&itemOk&&unlock.unlocked,
    levelOk,itemOk,eventOk:unlock.unlocked,label:unlock.label,
  };
}

export function promotionRequirementParts(promo,{itemName='',status=null}={}){
  if(!promo)return [];
  const parts=[{text:`Lv${promo.lvl||1}`,key:'levelOk'}];
  if(promo.item)parts.push({text:itemName||promo.item,key:'itemOk'});
  if(promo.unlock)parts.push({text:promo.unlock.label||'원작 사건 완료',key:'eventOk'});
  return parts.map(part=>({...part,met:status?!!status[part.key]:false}));
}

export function newlyUnlockedPromotions(beforeCampaign,afterCampaign,characters,rosterIds=[]){
  const roster=new Set(rosterIds);
  const rewards=[];
  for(const [cid,char] of Object.entries(characters||{})){
    const promo=char?.promo;
    if(!promo?.unlock||(roster.size&&!roster.has(cid)))continue;
    if(!promotionUnlockState(promo,beforeCampaign).unlocked&&promotionUnlockState(promo,afterCampaign).unlocked){
      rewards.push({cid,promo});
    }
  }
  return rewards;
}
