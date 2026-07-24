/* v3 통합 세이브 저장소. 기존 키를 읽고 보존하며 새 저장소에 복사한다. */
export const V3_SAVE_KEY = 'kimyong_save_v3';
export const V3_VERSION = 3;
export const LEGACY_CAMPAIGNS = [
  'sajo','sinjo','uicheon','chunryong','hwasan','hooildam',
  'wolnyeo','dokgo','hwalsa','pungreung','jinfinal','chronicle'
];

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const parse = (value, fallback=null) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

export function emptyV3Save(){
  return {
    version: V3_VERSION,
    migratedAt: null,
    profile: {
      settings: {diff:'std',speed:1,fastEnemy:false,reducedFx:false},
      achievements: {},
      stats: {wins:0,kills:0,bosses:0,crits:0,camps:{}},
      mastery: {},
      codex: {},
      reputation: {侠:0,情:0,势:0},
    },
    campaigns: {},
    challenges: {endless:{bestWave:0},roam:{},trials:{}},
    legacy: {classicV1:null, importedV2:[]},
    lastSession: null,
  };
}

function normalize(raw){
  const base=emptyV3Save();
  if(!raw || typeof raw!=='object') return base;
  base.migratedAt=raw.migratedAt||null;
  base.profile={...base.profile,...(raw.profile||{})};
  base.profile.settings={...emptyV3Save().profile.settings,...(base.profile.settings||{})};
  base.profile.stats={...emptyV3Save().profile.stats,...(base.profile.stats||{})};
  base.profile.stats.camps=base.profile.stats.camps||{};
  base.profile.reputation={...emptyV3Save().profile.reputation,...(base.profile.reputation||{})};
  base.campaigns=raw.campaigns||{};
  base.challenges={...base.challenges,...(raw.challenges||{})};
  base.challenges.endless={bestWave:0,...(base.challenges.endless||{})};
  base.legacy={...base.legacy,...(raw.legacy||{})};
  base.legacy.importedV2=base.legacy.importedV2||[];
  base.lastSession=raw.lastSession||null;
  return base;
}

export function loadV3(storage=localStorage){
  return normalize(parse(storage.getItem(V3_SAVE_KEY), null));
}

export function writeV3(store, storage=localStorage){
  const safe=normalize(store);
  safe.version=V3_VERSION;
  storage.setItem(V3_SAVE_KEY, JSON.stringify(safe));
  return safe;
}

export function migrateLegacy(storage=localStorage){
  const existed=!!storage.getItem(V3_SAVE_KEY);
  const store=loadV3(storage);
  if(!existed){
    store.profile.settings={...store.profile.settings,...(parse(storage.getItem('kimyong_settings'),{})||{})};
    store.profile.achievements=parse(storage.getItem('kimyong_achv'),{})||{};
    store.profile.stats={...store.profile.stats,...(parse(storage.getItem('kimyong_stats'),{})||{})};
    store.profile.mastery=parse(storage.getItem('kimyong_mastery'),{})||{};
    const classic=parse(storage.getItem('kimyong_srpg_save_v1'),null);
    if(classic) store.legacy.classicV1=clone(classic);
    for(const id of LEGACY_CAMPAIGNS){
      const state=parse(storage.getItem('kimyong_v2_'+id),null);
      if(state){ store.campaigns[id]=clone(state); store.legacy.importedV2.push(id); }
    }
    const best=parseInt(storage.getItem('kimyong_srpg_endless_best')||'0',10)||0;
    store.challenges.endless.bestWave=best;
    store.lastSession=parse(storage.getItem('kimyong_lastplay'),null);
    store.migratedAt=new Date().toISOString();
  }
  return writeV3(store,storage);
}

export function profileValue(store,key,fallback){
  const value=store && store.profile ? store.profile[key] : undefined;
  return value == null ? fallback : clone(value);
}

export function setProfileValue(store,key,value,storage=localStorage){
  store.profile[key]=clone(value);
  return writeV3(store,storage);
}

export function getCampaignSave(store,id){ return clone(store.campaigns[id]||null); }
export function setCampaignSave(store,id,state,storage=localStorage){
  store.campaigns[id]=clone(state);
  return writeV3(store,storage);
}

export function setLastSession(store,lastSession,storage=localStorage){
  store.lastSession=clone(lastSession);
  return writeV3(store,storage);
}

export function setEndlessBest(store,bestWave,storage=localStorage){
  store.challenges.endless.bestWave=Math.max(store.challenges.endless.bestWave||0,bestWave||0);
  return writeV3(store,storage);
}
