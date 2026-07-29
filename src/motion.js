let motionPromise=null;

export function loadMotion(){
  if(!motionPromise) motionPromise=Promise.all([import('gsap'),import('gsap/ScrollTrigger')]).then(([core,plugin])=>{
    const gsap=core.gsap||core.default;
    const ScrollTrigger=plugin.ScrollTrigger||plugin.default;
    gsap.registerPlugin(ScrollTrigger);
    return {gsap,ScrollTrigger};
  });
  return motionPromise;
}

export async function killMotionTriggers(prefix=null){
  const {ScrollTrigger}=await loadMotion();
  ScrollTrigger.getAll().forEach(trigger=>{
    if(!prefix||String(trigger.vars?.id||'').startsWith(prefix)) trigger.kill();
  });
}
