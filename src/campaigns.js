import { CHAPTERS } from './data.js';
import HWASAN from './data/stages_hwasan.json';
import SAJO from './data/stages_sajo.json';
import SINJO from './data/stages_sinjo.json';
import UICHEON from './data/stages_uicheon.json';
import CHUNRYONG from './data/stages_chunryong.json';
import HOOILDAM from './data/stages_hooildam.json';
import JINFINAL from './data/stages_jinfinal.json';
import WOLNYEO from './data/stages_wolnyeo.json';
import DOKGO from './data/stages_dokgo.json';
import HWALSA from './data/stages_hwalsa.json';
import PUNGREUNG from './data/stages_pungreung.json';
import CAMPAIGN_MANIFEST from './data/campaigns.json';
import STORY_EXPANSIONS from './data/story_expansions.json';
import BATTLE_UPDATES from './data/battle_updates.json';

const clone = value => JSON.parse(JSON.stringify(value));

function makeChronicleCampaign(){
  const stages={}, order=[];
  CHAPTERS.forEach((ch,i)=>{
    const id=`ch${String(i+1).padStart(2,'0')}`;
    const next=i===CHAPTERS.length-1?'end':`ch${String(i+2).padStart(2,'0')}`;
    stages[id]={...clone(ch),kind:'battle',next,goldReward:120};
    order.push(id);
  });
  stages.end={kind:'end',title:'초대판 회상록 완주',text:[
    '초기 강호의 별, 열아홉 전투의 기록을 모두 되짚었습니다.',
    '이 회상록은 압축된 옛 구성입니다. 정식 이야기는 강호연대기에서 이어집니다.'
  ]};
  order.push('end');
  return {
    id:'chronicle', name:'초대판 회상록 — 19전',
    desc:'초기 버전의 빠른 전개를 v3 공통 전투 규칙으로 다시 즐기는 압축 캠페인',
    start:'ch01', gold:0, party:[], leader:'gj', order, stages,
  };
}

function applyStoryExpansions(registry){
  for(const [campId,pack] of Object.entries(STORY_EXPANSIONS.campaigns||{})){
    const camp=registry[campId]; if(!camp) continue;
    for(const [anchorId,defs] of Object.entries(pack.after||{})){
      const anchor=camp.stages[anchorId];
      if(!anchor||typeof anchor.next!=='string'||!Array.isArray(defs)||!defs.length) continue;
      const oldNext=anchor.next, ids=defs.map(d=>d.id);
      if(ids.some(id=>camp.stages[id])) continue;
      anchor.next=ids[0];
      defs.forEach((def,i)=>{ camp.stages[def.id]={...clone(def),next:ids[i+1]||oldNext}; });
      const pos=camp.order.indexOf(anchorId);
      if(pos>=0) camp.order.splice(pos+1,0,...ids);
    }
  }
}

function applyBattleUpdates(registry){
  for(const [campId,updates] of Object.entries(BATTLE_UPDATES.campaigns||{})){
    const camp=registry[campId]; if(!camp) continue;
    for(const [stageId,patch] of Object.entries(updates)){
      if(camp.stages[stageId]) Object.assign(camp.stages[stageId],clone(patch));
    }
  }
}

export function createCampaignRegistry(){
  const registry={
    sajo:clone(SAJO), sinjo:clone(SINJO), uicheon:clone(UICHEON), chunryong:clone(CHUNRYONG),
    hwasan:clone(HWASAN), hooildam:clone(HOOILDAM), wolnyeo:clone(WOLNYEO), dokgo:clone(DOKGO),
    hwalsa:clone(HWALSA), pungreung:clone(PUNGREUNG), jinfinal:clone(JINFINAL),
    chronicle:makeChronicleCampaign(),
  };
  applyStoryExpansions(registry);
  applyBattleUpdates(registry);
  return registry;
}

export const CAMPAIGN_META = CAMPAIGN_MANIFEST.campaigns;
export const CAMPAIGN_GROUPS = CAMPAIGN_MANIFEST.groups;
