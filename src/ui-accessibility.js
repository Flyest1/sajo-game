const MODAL_FOCUS=new WeakMap();

function enhanceModal(backdrop){
  if(!backdrop||MODAL_FOCUS.has(backdrop)) return;
  MODAL_FOCUS.set(backdrop,document.activeElement);
  backdrop.setAttribute('role','dialog');
  backdrop.setAttribute('aria-modal','true');
  const panel=backdrop.querySelector('.modal');
  if(panel&&!panel.hasAttribute('tabindex')) panel.tabIndex=-1;
  requestAnimationFrame(()=>{
    const target=backdrop.querySelector('input:not([disabled]),button:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
    (target||panel||backdrop).focus?.();
  });
}

export function initModalAccessibility(){
  const observer=new MutationObserver(records=>{
    for(const record of records) for(const node of record.addedNodes){
      if(!(node instanceof Element)) continue;
      if(node.matches('.modal-back')) enhanceModal(node);
      node.querySelectorAll?.('.modal-back').forEach(enhanceModal);
    }
    for(const record of records) for(const node of record.removedNodes){
      if(!(node instanceof Element)||!node.matches('.modal-back')) continue;
      const previous=MODAL_FOCUS.get(node);
      if(previous?.isConnected) requestAnimationFrame(()=>previous.focus());
    }
  });
  observer.observe(document.body,{childList:true,subtree:true});
  return observer;
}

function trapModalFocus(event,modal){
  const focusable=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
  if(!focusable.length){ event.preventDefault(); modal.querySelector('.modal')?.focus(); return; }
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){ event.preventDefault(); last.focus(); }
  else if(!event.shiftKey&&document.activeElement===last){ event.preventDefault(); first.focus(); }
}

export function handleModalKeydown(event,{cancelForecast}={}){
  const modals=document.querySelectorAll('.modal-back');
  const modal=modals.length?modals[modals.length-1]:null;
  if(!modal) return false;
  if(event.key==='Escape'){
    if(modal.id==='fc-modal'&&cancelForecast) cancelForecast(); else modal.remove();
    event.preventDefault();
  }else if(event.key==='Tab') trapModalFocus(event,modal);
  return true;
}
