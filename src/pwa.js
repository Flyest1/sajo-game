import { registerSW } from 'virtual:pwa-register';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'local';

function removeNotice(){ document.getElementById('update-notice')?.remove(); }

export function showUpdateNotice({kind='update',onApply}={}){
  removeNotice();
  const update=kind==='update';
  const el=document.createElement('section');
  el.id='update-notice';
  el.className=`update-notice ${update?'is-update':'is-ready'}`;
  el.setAttribute('role',update?'alertdialog':'status');
  el.setAttribute('aria-label',update?'새 버전 업데이트':'오프라인 준비 완료');
  el.innerHTML=`<div><b>${update?'새 강호 기록이 도착했습니다':'오프라인 준비 완료'}</b><span>${update?'저장 기록을 유지한 채 최신 버전으로 교체합니다.':'이제 연결이 끊겨도 계속 플레이할 수 있습니다.'}</span></div>
    <div class="update-actions">${update?'<button class="btn small" id="apply-update">업데이트 적용</button>':''}<button class="notice-close" aria-label="알림 닫기">×</button></div>`;
  document.body.appendChild(el);
  el.querySelector('.notice-close').addEventListener('click',removeNotice);
  if(update) el.querySelector('#apply-update').addEventListener('click',()=>{
    const btn=el.querySelector('#apply-update'); btn.disabled=true; btn.textContent='적용 중…';
    if(onApply) onApply();
  });
  if(!update) setTimeout(()=>{ if(el.isConnected) removeNotice(); },4500);
  return el;
}

export function mountPwaUpdates(){
  let updateSW=()=>Promise.resolve();
  updateSW=registerSW({
    immediate:true,
    onNeedRefresh(){ showUpdateNotice({kind:'update',onApply:()=>updateSW(true)}); },
    onOfflineReady(){ showUpdateNotice({kind:'ready'}); },
  });
  return updateSW;
}
