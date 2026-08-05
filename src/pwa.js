import { registerSW } from 'virtual:pwa-register';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'local';
const APP_CACHE=/^(?:workbox-precache|wuxia-portraits|vite-plugin-pwa)/;
let updateSW=()=>Promise.resolve();
let registration;

function removeNotice(){ document.getElementById('update-notice')?.remove(); }

const noticeCopy={
  update:{title:'새 강호 기록이 도착했습니다',body:'저장 기록을 유지한 채 최신 버전으로 교체합니다.'},
  ready:{title:'오프라인 준비 완료',body:'이제 연결이 끊겨도 계속 플레이할 수 있습니다.'},
  checking:{title:'새 버전을 확인하는 중입니다',body:'현재 저장 기록은 그대로 유지됩니다.'},
  current:{title:'최신 강호 기록입니다',body:`현재 ${APP_VERSION} 빌드를 사용하고 있습니다.`},
  error:{title:'업데이트를 확인하지 못했습니다',body:'연결을 확인한 뒤 다시 시도하거나 캐시를 복구해 주세요.'},
  recovering:{title:'앱 캐시를 복구하는 중입니다',body:'서비스워커 캐시만 새로 받습니다. 저장 기록은 삭제하지 않습니다.'},
};

export function showUpdateNotice({kind='update',onApply,onRepair}={}){
  removeNotice();
  const update=kind==='update', repairable=update||kind==='error', copy=noticeCopy[kind]||noticeCopy.current;
  const el=document.createElement('section');
  el.id='update-notice';
  el.className=`update-notice ${update?'is-update':'is-ready'}`;
  el.setAttribute('role',update?'alertdialog':'status');
  el.setAttribute('aria-label',copy.title);
  el.innerHTML=`<div><b>${copy.title}</b><span>${copy.body}</span></div>
    <div class="update-actions">${update?'<button class="btn small" id="apply-update">지금 적용</button>':''}${repairable?'<button class="btn small" id="repair-cache">캐시 복구</button>':''}<button class="notice-close" aria-label="알림 닫기">×</button></div>`;
  document.body.appendChild(el);
  el.querySelector('.notice-close').addEventListener('click',removeNotice);
  if(update) el.querySelector('#apply-update').addEventListener('click',async()=>{
    const btn=el.querySelector('#apply-update'); btn.disabled=true; btn.textContent='적용 중…';
    try { if(onApply) await onApply(); }
    catch { showUpdateNotice({kind:'error'}); }
  });
  if(repairable) el.querySelector('#repair-cache').addEventListener('click',async()=>{
    const btn=el.querySelector('#repair-cache'); btn.disabled=true; btn.textContent='복구 중…';
    try { await (onRepair||repairPwaCache)(); }
    catch { showUpdateNotice({kind:'error'}); }
  });
  if(!update&&kind!=='checking'&&kind!=='recovering') setTimeout(()=>{ if(el.isConnected) removeNotice(); },4500);
  return el;
}

async function getRegistration(){
  if(registration) return registration;
  if(!('serviceWorker' in navigator)) return undefined;
  registration=await navigator.serviceWorker.getRegistration();
  return registration;
}

export async function inspectPwaCache(){
  const sw=await getRegistration();
  const cacheNames='caches' in window ? await caches.keys().catch(()=>[]) : [];
  const appCaches=cacheNames.filter(name=>APP_CACHE.test(name));
  return {supported:'serviceWorker' in navigator,registered:!!sw,waiting:!!sw?.waiting,appCaches};
}

export async function checkForUpdate(){
  showUpdateNotice({kind:'checking'});
  try {
    const sw=await getRegistration();
    if(!sw){ showUpdateNotice({kind:'error'}); return {supported:false}; }
    await sw.update();
    const state=await inspectPwaCache();
    if(state.waiting) showUpdateNotice({kind:'update',onApply:()=>updateSW(),onRepair:repairPwaCache});
    else showUpdateNotice({kind:'current'});
    return state;
  } catch(error) {
    showUpdateNotice({kind:'error'});
    return {supported:false,error:String(error)};
  }
}

export async function repairPwaCache(){
  showUpdateNotice({kind:'recovering'});
  const state=await inspectPwaCache();
  await Promise.all(state.appCaches.map(name=>caches.delete(name)));
  const sw=await getRegistration();
  await sw?.update();
  // Never clear localStorage: it contains the unified save and checkpoints.
  if(sw?.waiting) await updateSW();
  window.setTimeout(()=>window.location.reload(),250);
  return state;
}

export function mountPwaUpdates(){
  updateSW=registerSW({
    immediate:true,
    onNeedRefresh(){ showUpdateNotice({kind:'update',onApply:()=>updateSW(),onRepair:repairPwaCache}); },
    onOfflineReady(){ showUpdateNotice({kind:'ready'}); },
    onRegisteredSW(_url,sw){ registration=sw; },
  });
  return updateSW;
}
