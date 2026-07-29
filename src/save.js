/* v3 통합 세이브 저장소. 기존 키는 보존하고 손상된 구획만 격리한다. */
import { emptyCheckpoints } from './checkpoints.js';
export const V3_SAVE_KEY = 'kimyong_save_v3';
export const V3_VERSION = 3;
export const BACKUP_FORMAT_VERSION = 2;
export const LEGACY_CAMPAIGNS = [
  'sajo','sinjo','uicheon','chunryong','hwasan','hooildam',
  'wolnyeo','dokgo','hwalsa','pungreung','jinfinal','chronicle'
];

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const tryParse = value => {
  try { return {ok:true,value:typeof value === 'string' ? JSON.parse(value) : value}; }
  catch { return {ok:false,value:null}; }
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
    checkpoints: emptyCheckpoints(),
    quarantine: {sections:{},issues:[]},
  };
}

function isolate(store,path,value,reason){
  store.quarantine.sections[path]=clone(value);
  store.quarantine.issues.push({path,reason});
}

function recordOr(store,path,value,fallback){
  if(value===undefined) return clone(fallback);
  if(isRecord(value)) return clone(value);
  isolate(store,path,value,'object expected');
  return clone(fallback);
}

export function normalizeV3(raw){
  const base=emptyV3Save();
  if(!isRecord(raw)){
    if(raw!==null&&raw!==undefined) isolate(base,'root',raw,'save root is not an object');
    return base;
  }
  if(raw.version!==undefined&&raw.version!==V3_VERSION) isolate(base,'version',raw.version,`schema ${V3_VERSION} expected`);
  base.migratedAt=typeof raw.migratedAt==='string'?raw.migratedAt:null;

  const profile=recordOr(base,'profile',raw.profile,{});
  for(const key of ['settings','achievements','stats','mastery','codex','reputation']){
    base.profile[key]={...base.profile[key],...recordOr(base,`profile.${key}`,profile[key],{})};
  }
  base.profile.stats.camps=recordOr(base,'profile.stats.camps',base.profile.stats.camps,{});

  const campaigns=recordOr(base,'campaigns',raw.campaigns,{});
  for(const [id,state] of Object.entries(campaigns)){
    if(isRecord(state)) base.campaigns[id]=clone(state);
    else isolate(base,`campaigns.${id}`,state,'campaign state must be an object');
  }

  const challenges=recordOr(base,'challenges',raw.challenges,{});
  for(const key of ['endless','roam','trials']) base.challenges[key]={...base.challenges[key],...recordOr(base,`challenges.${key}`,challenges[key],{})};

  const legacy=recordOr(base,'legacy',raw.legacy,{});
  base.legacy.classicV1=legacy.classicV1===null||legacy.classicV1===undefined?null:
    (isRecord(legacy.classicV1)?clone(legacy.classicV1):(isolate(base,'legacy.classicV1',legacy.classicV1,'classic save must be an object'),null));
  base.legacy.importedV2=Array.isArray(legacy.importedV2)?[...new Set(legacy.importedV2.filter(id=>typeof id==='string'))]:[];
  if(legacy.importedV2!==undefined&&!Array.isArray(legacy.importedV2)) isolate(base,'legacy.importedV2',legacy.importedV2,'array expected');

  base.lastSession=raw.lastSession===null||raw.lastSession===undefined?null:
    (isRecord(raw.lastSession)?clone(raw.lastSession):(isolate(base,'lastSession',raw.lastSession,'object expected'),null));

  const checkpoints=recordOr(base,'checkpoints',raw.checkpoints,emptyCheckpoints());
  base.checkpoints.latest=typeof checkpoints.latest==='string'?checkpoints.latest:null;
  if(Array.isArray(checkpoints.history)){
    for(const [index,item] of checkpoints.history.entries()){
      if(isRecord(item)&&typeof item.id==='string'&&typeof item.campaignId==='string'&&isRecord(item.state)) base.checkpoints.history.push(clone(item));
      else isolate(base,`checkpoints.history.${index}`,item,'checkpoint record invalid');
    }
    base.checkpoints.history=base.checkpoints.history.slice(0,12);
  }else if(checkpoints.history!==undefined) isolate(base,'checkpoints.history',checkpoints.history,'array expected');

  const oldQuarantine=isRecord(raw.quarantine)?raw.quarantine:null;
  if(oldQuarantine){
    if(isRecord(oldQuarantine.sections)) base.quarantine.sections={...clone(oldQuarantine.sections),...base.quarantine.sections};
    if(Array.isArray(oldQuarantine.issues)) base.quarantine.issues=[...clone(oldQuarantine.issues),...base.quarantine.issues];
  }
  return base;
}

export function validateV3(input){
  const parsed=tryParse(input);
  const store=parsed.ok?normalizeV3(parsed.value):emptyV3Save();
  if(!parsed.ok) isolate(store,'root',String(input).slice(0,2000),'invalid JSON');
  const issues=clone(store.quarantine.issues);
  return {valid:issues.length===0,issues,store};
}

export function loadV3(storage=localStorage){
  const text=storage.getItem(V3_SAVE_KEY);
  return text===null?emptyV3Save():validateV3(text).store;
}

export function writeV3(store, storage=localStorage){
  const safe=normalizeV3(store);
  safe.version=V3_VERSION;
  storage.setItem(V3_SAVE_KEY, JSON.stringify(safe));
  return safe;
}

export function migrateLegacy(storage=localStorage){
  const existed=storage.getItem(V3_SAVE_KEY)!==null;
  const store=loadV3(storage);
  if(!existed){
    const importObject=(key,path,fallback={})=>{
      const text=storage.getItem(key); if(text===null) return clone(fallback);
      const parsed=tryParse(text);
      if(parsed.ok&&isRecord(parsed.value)) return parsed.value;
      isolate(store,path,text.slice(0,2000),'legacy JSON is damaged'); return clone(fallback);
    };
    store.profile.settings={...store.profile.settings,...importObject('kimyong_settings','legacy.settings')};
    store.profile.achievements=importObject('kimyong_achv','legacy.achievements');
    store.profile.stats={...store.profile.stats,...importObject('kimyong_stats','legacy.stats')};
    store.profile.mastery=importObject('kimyong_mastery','legacy.mastery');
    const classic=storage.getItem('kimyong_srpg_save_v1');
    if(classic!==null){
      const parsed=tryParse(classic);
      if(parsed.ok&&isRecord(parsed.value)) store.legacy.classicV1=clone(parsed.value);
      else isolate(store,'legacy.classicV1',classic.slice(0,2000),'legacy JSON is damaged');
    }
    for(const id of LEGACY_CAMPAIGNS){
      const key='kimyong_v2_'+id, text=storage.getItem(key); if(text===null) continue;
      const parsed=tryParse(text);
      if(parsed.ok&&isRecord(parsed.value)){ store.campaigns[id]=clone(parsed.value); store.legacy.importedV2.push(id); }
      else isolate(store,`legacy.campaigns.${id}`,text.slice(0,2000),'legacy JSON is damaged');
    }
    const best=parseInt(storage.getItem('kimyong_srpg_endless_best')||'0',10)||0;
    store.challenges.endless.bestWave=best;
    const last=storage.getItem('kimyong_lastplay');
    if(last!==null){
      const parsed=tryParse(last);
      if(parsed.ok&&isRecord(parsed.value)) store.lastSession=parsed.value;
      else isolate(store,'legacy.lastSession',last.slice(0,2000),'legacy JSON is damaged');
    }
    store.migratedAt=new Date().toISOString();
  }
  return writeV3(store,storage);
}

const JSON_BACKUP_KEYS = key => key===V3_SAVE_KEY || key==='kimyong_settings' || key==='kimyong_achv' || key==='kimyong_stats' ||
  key==='kimyong_mastery' || key==='kimyong_lastplay' || key==='kimyong_srpg_save_v1' || key.startsWith('kimyong_v2_');

export function createBackupPayload(storage=localStorage){
  const data={};
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i);
    if(key&&key.startsWith('kimyong')) data[key]=storage.getItem(key);
  }
  const validation=validateV3(data[V3_SAVE_KEY]||JSON.stringify(emptyV3Save()));
  return {app:'kangho',formatVersion:BACKUP_FORMAT_VERSION,schemaVersion:V3_VERSION,createdAt:new Date().toISOString(),validation:{valid:validation.valid,issues:validation.issues},data};
}

export function inspectBackupPayload(input){
  const parsed=tryParse(input);
  if(!parsed.ok||!isRecord(parsed.value)) return {ok:false,count:0,writes:{},issues:[{path:'backup',reason:'invalid JSON'}]};
  const payload=parsed.value, source=isRecord(payload.data)?payload.data:payload;
  if(!isRecord(source)) return {ok:false,count:0,writes:{},issues:[{path:'backup.data',reason:'object expected'}]};
  const writes={}, issues=[];
  let importedStore=null;
  for(const [key,rawValue] of Object.entries(source)){
    if(!key.startsWith('kimyong')) continue;
    const value=typeof rawValue==='string'?rawValue:JSON.stringify(rawValue);
    if(JSON_BACKUP_KEYS(key)){
      const decoded=tryParse(value);
      if(!decoded.ok||!isRecord(decoded.value)){
        issues.push({path:key,reason:'damaged JSON section'});
        continue;
      }
      if(key===V3_SAVE_KEY){
        const checked=validateV3(decoded.value);
        importedStore=checked.store;
        issues.push(...checked.issues.map(issue=>({...issue,path:`${key}.${issue.path}`})));
        writes[key]=JSON.stringify(importedStore);
        continue;
      }
    }
    writes[key]=value;
  }
  if(!Object.keys(writes).length&&!issues.length) return {ok:false,count:0,writes:{},issues:[{path:'backup.data',reason:'no game records'}]};
  if(issues.length){
    importedStore=importedStore||emptyV3Save();
    for(const issue of issues) isolate(importedStore,`import.${issue.path}`,source[issue.path]||null,issue.reason);
    writes[V3_SAVE_KEY]=JSON.stringify(importedStore);
  }
  return {ok:Object.keys(writes).length>0,count:Object.keys(writes).length,writes,issues};
}

export function restoreBackupPayload(input,storage=localStorage){
  const result=inspectBackupPayload(input);
  if(!result.ok) return result;
  for(const [key,value] of Object.entries(result.writes)) storage.setItem(key,value);
  return result;
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
