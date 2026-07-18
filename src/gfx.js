import { TS, TILE, CHARS } from './data.js';

/* ============================================================
   SVG 그래픽: 초상화 생성기 · 맵 타일 · 유닛 토큰
   ============================================================ */

function shade(hex, f){ // f<1 어둡게, f>1 밝게
  const n = parseInt(hex.slice(1),16);
  let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  r=Math.min(255,Math.round(r*f)); g=Math.min(255,Math.round(g*f)); b=Math.min(255,Math.round(b*f));
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}

/* ── 초상화 (100x100 viewBox 기준의 <g> 내부 요소 문자열) ── */
function portraitInner(p){
  const skin=p.skin, hc=p.hc||'#2b2119', robe=p.robe||'#666', bc=p.bc||hc;
  const skinD=shade(skin,0.82), robeD=shade(robe,0.7), hcD=shade(hc,0.75);
  let s='';
  const fem = !!p.female;
  const headRx = fem?17.5:19, headRy = fem?21:22;

  /* 뒷머리 (머리 뒤 레이어) */
  if(p.hair==='maiden'||p.hair==='long'||p.hair==='longwild'){
    if(p.hair==='longwild'){
      s+=`<path d="M24,38 Q20,80 14,95 L36,88 L30,60 Z" fill="${hcD}"/>`;
      s+=`<path d="M76,38 Q80,80 86,95 L64,88 L70,60 Z" fill="${hcD}"/>`;
      s+=`<path d="M28,30 Q50,10 72,30 L76,55 Q70,90 62,96 L38,96 Q30,90 24,55 Z" fill="${hc}"/>`;
    }else{
      s+=`<path d="M29,32 Q50,14 71,32 L74,58 Q73,86 66,96 L34,96 Q27,86 26,58 Z" fill="${hc}"/>`;
      s+=`<path d="M29,40 Q26,70 30,92 L36,92 Q31,66 33,42 Z" fill="${hcD}"/>`;
      s+=`<path d="M71,40 Q74,70 70,92 L64,92 Q69,66 67,42 Z" fill="${hcD}"/>`;
    }
  }

  /* 어깨·도포 */
  s+=`<path d="M12,100 Q16,74 34,69 L50,66 L66,69 Q84,74 88,100 Z" fill="${robe}"/>`;
  s+=`<path d="M12,100 Q16,74 34,69 L40,72 Q24,78 20,100 Z" fill="${robeD}"/>`;
  s+=`<path d="M88,100 Q84,74 66,69 L60,72 Q76,78 80,100 Z" fill="${robeD}"/>`;
  s+=`<path d="M43,68 L50,84 L57,68 L52,66 L48,66 Z" fill="${shade(robe,1.25)}"/>`;
  s+=`<path d="M46,67 L50,80 L54,67" fill="none" stroke="${robeD}" stroke-width="1.4"/>`;

  /* 목 */
  s+=`<path d="M44,58 L44,70 Q50,74 56,70 L56,58 Z" fill="${skinD}"/>`;

  /* 얼굴 */
  s+=`<ellipse cx="50" cy="44" rx="${headRx}" ry="${headRy}" fill="${skin}"/>`;
  s+=`<path d="M${50-headRx},44 Q${50-headRx},${44+headRy*0.9} 50,${44+headRy} Q${50+headRx},${44+headRy*0.9} ${50+headRx},44 L${50+headRx-3},52 Q50,${44+headRy-2} ${50-headRx+3},52 Z" fill="${skinD}" opacity=".35"/>`;
  /* 귀 */
  s+=`<ellipse cx="${50-headRx}" cy="46" rx="3.4" ry="5" fill="${skin}"/><ellipse cx="${50+headRx}" cy="46" rx="3.4" ry="5" fill="${skin}"/>`;

  /* 앞머리 */
  const fr = headRx+1.5;
  switch(p.hair){
    case 'topknot':
      s+=`<path d="M${50-fr},42 Q${50-fr},20 50,19 Q${50+fr},20 ${50+fr},42 Q${50+fr-4},30 50,29 Q${50-fr+4},30 ${50-fr},42 Z" fill="${hc}"/>`;
      s+=`<circle cx="50" cy="15" r="6.5" fill="${hc}"/><rect x="44" y="18" width="12" height="4" rx="2" fill="${hcD}"/>`;
      break;
    case 'maiden':
      s+=`<path d="M${50-fr},46 Q${50-fr},18 50,17 Q${50+fr},18 ${50+fr},46 Q${50+fr-3},28 56,26 Q50,32 44,26 Q${50-fr+3},28 ${50-fr},46 Z" fill="${hc}"/>`;
      s+=`<circle cx="36" cy="20" r="5.5" fill="${hc}"/><circle cx="64" cy="20" r="5.5" fill="${hc}"/>`;
      break;
    case 'bun':
      s+=`<path d="M${50-fr},44 Q${50-fr},20 50,19 Q${50+fr},20 ${50+fr},44 Q${50+fr-4},29 50,28 Q${50-fr+4},29 ${50-fr},44 Z" fill="${hc}"/>`;
      s+=`<ellipse cx="50" cy="16" rx="9" ry="5.5" fill="${hc}"/>`;
      break;
    case 'scholar':
      s+=`<path d="M${50-fr},42 Q${50-fr},22 50,21 Q${50+fr},22 ${50+fr},42 Q${50+fr-4},31 50,30 Q${50-fr+4},31 ${50-fr},42 Z" fill="${hc}"/>`;
      s+=`<path d="M36,24 Q50,10 64,24 L61,28 Q50,18 39,28 Z" fill="#3a3430"/>`;
      s+=`<rect x="35" y="23" width="30" height="5" rx="2.5" fill="#4a443c"/>`;
      break;
    case 'daoist':
      s+=`<path d="M${50-fr},42 Q${50-fr},22 50,21 Q${50+fr},22 ${50+fr},42 Q${50+fr-4},31 50,30 Q${50-fr+4},31 ${50-fr},42 Z" fill="${hc}"/>`;
      s+=`<path d="M43,22 L50,10 L57,22 Z" fill="#5a5148"/><rect x="41" y="20" width="18" height="4" rx="2" fill="#6b6257"/>`;
      break;
    case 'wild':
      s+=`<path d="M${50-fr},44 L${50-fr-3},30 L${50-fr+5},33 L45,20 L50,28 L55,19 L${50+fr-5},33 L${50+fr+3},30 L${50+fr},44 Q${50+fr-4},31 50,30 Q${50-fr+4},31 ${50-fr},44 Z" fill="${hc}"/>`;
      break;
    case 'longwild':
      s+=`<path d="M${50-fr},46 L${50-fr-4},28 L${50-fr+4},32 L46,18 L51,27 L57,18 L${50+fr-4},32 L${50+fr+4},28 L${50+fr},46 Q${50+fr-4},30 50,29 Q${50-fr+4},30 ${50-fr},46 Z" fill="${hc}"/>`;
      break;
    case 'long':
      s+=`<path d="M${50-fr},46 Q${50-fr},19 50,18 Q${50+fr},19 ${50+fr},46 Q${50+fr-3},27 54,26 Q50,30 46,26 Q${50-fr+3},27 ${50-fr},46 Z" fill="${hc}"/>`;
      s+=`<circle cx="50" cy="14" r="5" fill="${hc}"/>`;
      break;
    case 'band':
      s+=`<path d="M${50-fr},42 Q${50-fr},22 50,21 Q${50+fr},22 ${50+fr},42 Q${50+fr-4},31 50,30 Q${50-fr+4},31 ${50-fr},42 Z" fill="${hc}"/>`;
      s+=`<rect x="${50-fr}" y="29" width="${fr*2}" height="5" rx="2.5" fill="#8a4030"/>`;
      break;
    case 'helm':
      s+=`<path d="M${50-fr-1},44 Q${50-fr-1},18 50,17 Q${50+fr+1},18 ${50+fr+1},44 L${50+fr-3},44 Q${50+fr-3},26 50,25 Q${50-fr+3},26 ${50-fr+3},44 Z" fill="#5c5850"/>`;
      s+=`<circle cx="50" cy="14" r="3" fill="#7a746a"/>`;
      break;
    case 'tri':
      s+=`<path d="M${50-fr},42 Q${50-fr},24 50,23 Q${50+fr},24 ${50+fr},42 Q${50+fr-4},32 50,31 Q${50-fr+4},32 ${50-fr},42 Z" fill="${hc}"/>`;
      s+=`<circle cx="38" cy="19" r="4.5" fill="${hc}"/><circle cx="50" cy="15" r="4.5" fill="${hc}"/><circle cx="62" cy="19" r="4.5" fill="${hc}"/>`;
      break;
    case 'bald':
      s+=`<path d="M${50-headRx},40 Q50,${40-headRy*0.55} ${50+headRx},40 L${50+headRx},44 L${50-headRx},44 Z" fill="${skin}" opacity="0"/>`;
      break;
  }

  /* 눈썹 */
  const browY=38;
  if(p.brow==='fierce'){
    s+=`<path d="M36,${browY+2} L46,${browY-1}" stroke="${hcD}" stroke-width="2.4" stroke-linecap="round"/>`;
    s+=`<path d="M64,${browY+2} L54,${browY-1}" stroke="${hcD}" stroke-width="2.4" stroke-linecap="round"/>`;
  }else if(p.brow==='thick'){
    s+=`<path d="M37,${browY} L46,${browY}" stroke="${hcD}" stroke-width="3" stroke-linecap="round"/>`;
    s+=`<path d="M63,${browY} L54,${browY}" stroke="${hcD}" stroke-width="3" stroke-linecap="round"/>`;
  }else{
    s+=`<path d="M37,${browY} Q41.5,${browY-2} 46,${browY}" stroke="${hcD}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
    s+=`<path d="M63,${browY} Q58.5,${browY-2} 54,${browY}" stroke="${hcD}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  }

  /* 눈 */
  if(p.extra==='blindfold'){
    s+=`<rect x="${50-headRx-1}" y="40" width="${(headRx+1)*2}" height="7" rx="2" fill="#2e2a24"/>`;
  }else{
    s+=`<ellipse cx="41.5" cy="44" rx="2.6" ry="${fem?3.2:2.8}" fill="#241c14"/>`;
    s+=`<ellipse cx="58.5" cy="44" rx="2.6" ry="${fem?3.2:2.8}" fill="#241c14"/>`;
    s+=`<circle cx="42.3" cy="43" r="0.9" fill="#fff" opacity=".85"/><circle cx="59.3" cy="43" r="0.9" fill="#fff" opacity=".85"/>`;
    if(fem){
      s+=`<path d="M38.5,41.5 Q41.5,39.5 44.5,41.5" stroke="#241c14" stroke-width="1.2" fill="none"/>`;
      s+=`<path d="M55.5,41.5 Q58.5,39.5 61.5,41.5" stroke="#241c14" stroke-width="1.2" fill="none"/>`;
      s+=`<circle cx="36" cy="51" r="3.4" fill="#e88" opacity=".28"/><circle cx="64" cy="51" r="3.4" fill="#e88" opacity=".28"/>`;
    }
  }

  /* 코·입 */
  s+=`<path d="M50,47 L48.6,53 L51.4,53" fill="none" stroke="${skinD}" stroke-width="1.3" stroke-linecap="round"/>`;
  const mY=58;
  switch(p.mouth){
    case 'smile': s+=`<path d="M45,${mY} Q50,${mY+3.5} 55,${mY}" stroke="#a05a4a" stroke-width="1.8" fill="none" stroke-linecap="round"/>`; break;
    case 'grin':  s+=`<path d="M44,${mY-1} Q50,${mY+5} 56,${mY-1} Z" fill="#7a3a30"/><path d="M45.5,${mY} Q50,${mY+2.4} 54.5,${mY}" stroke="#fff" stroke-width="1.5" fill="none"/>`; break;
    case 'frown': s+=`<path d="M45,${mY+1.5} Q50,${mY-2} 55,${mY+1.5}" stroke="#8a4a3a" stroke-width="1.8" fill="none" stroke-linecap="round"/>`; break;
    case 'smirk': s+=`<path d="M45,${mY+.5} Q51,${mY+2} 55,${mY-1.5}" stroke="#a05a4a" stroke-width="1.8" fill="none" stroke-linecap="round"/>`; break;
    default:      s+=`<path d="M45.5,${mY} L54.5,${mY}" stroke="#8a4a3a" stroke-width="1.8" stroke-linecap="round"/>`;
  }

  /* 수염 */
  switch(p.beard){
    case 'goatee':
      s+=`<path d="M46,62 Q50,64 54,62 L52.5,72 Q50,75 47.5,72 Z" fill="${bc}"/>`; break;
    case 'must':
      s+=`<path d="M42,55 Q50,59 58,55 L57,58 Q50,62 43,58 Z" fill="${bc}"/>`; break;
    case 'full':
      s+=`<path d="M33,48 Q34,70 50,73 Q66,70 67,48 Q64,60 50,62 Q36,60 33,48 Z" fill="${bc}"/>`;
      s+=`<path d="M42,55 Q50,58 58,55 L57,58 Q50,61 43,58 Z" fill="${shade(bc,0.85)}"/>`; break;
    case 'long':
      s+=`<path d="M44,60 Q50,63 56,60 L54,84 Q50,88 46,84 Z" fill="${bc}"/>`;
      s+=`<path d="M42,54 Q50,58 58,54 L57,57 Q50,61 43,57 Z" fill="${bc}"/>`; break;
    case 'stub':
      s+=`<path d="M38,52 Q40,66 50,68 Q60,66 62,52 Q58,62 50,63 Q42,62 38,52 Z" fill="${bc}" opacity=".4"/>`; break;
  }

  /* 장식 */
  if(p.extra==='hairpin'){
    s+=`<rect x="58" y="20" width="16" height="2.4" rx="1.2" fill="#d9b36c" transform="rotate(-18 58 21)"/>`;
    s+=`<circle cx="73" cy="16.5" r="2.2" fill="#e8607a"/>`;
  }
  if(p.extra==='scar'){
    s+=`<path d="M60,34 L66,50" stroke="#a05a4a" stroke-width="1.6" opacity=".8"/>`;
  }
  return s;
}

/* 초상화 defs 등록 (1회) */
function buildPortraitDefs(){
  let defs='';
  for(const id in CHARS){
    defs+=`<g id="pt-${id}">${portraitInner(CHARS[id].pt)}</g>`;
  }
  const holder=document.createElement('div');
  holder.innerHTML=`<svg width="0" height="0" style="position:absolute"><defs>${defs}</defs></svg>`;
  document.body.appendChild(holder.firstChild);
}
function ptSVG(cid, cls){ // 원형 초상화 svg 태그
  return `<svg viewBox="0 0 100 100" class="${cls||''}" preserveAspectRatio="xMidYMid meet"><circle cx="50" cy="50" r="50" fill="#463c2e"/><g><use href="#pt-${cid}"/></g></svg>`;
}

/* ── 타일 렌더링 ── */
function tileSVG(t, x, y){
  const px=x*TS, py=y*TS, T=TILE[t];
  const alt=((x+y)%2===0)?1:0.94;
  let s=`<rect x="${px}" y="${py}" width="${TS}" height="${TS}" fill="${shade(T.color,alt)}"/>`;
  const cx=px+TS/2, cy=py+TS/2;
  if(t==='f'){
    s+=`<ellipse cx="${cx}" cy="${cy+6}" rx="15" ry="5" fill="rgba(0,0,0,.15)"/>`;
    s+=`<path d="M${cx},${py+7} L${cx+13},${cy+8} L${cx-13},${cy+8} Z" fill="#3f6b35"/>`;
    s+=`<path d="M${cx},${py+13} L${cx+11},${cy+12} L${cx-11},${cy+12} Z" fill="#4c7d40"/>`;
    s+=`<rect x="${cx-2.5}" y="${cy+10}" width="5" height="8" fill="#6b4a2e"/>`;
  }else if(t==='m'){
    s+=`<path d="M${px+4},${py+TS-6} L${cx-4},${py+10} L${cx+8},${py+TS-6} Z" fill="#7a7264"/>`;
    s+=`<path d="M${cx-4},${py+10} L${cx+2},${py+20} L${cx-9},${py+24} Z" fill="#c8c2b4"/>`;
    s+=`<path d="M${cx+2},${py+TS-6} L${cx+16},${py+22} L${px+TS-3},${py+TS-6} Z" fill="#8d8574"/>`;
  }else if(t==='w'){
    s+=`<path d="M${px+8},${cy-6} q6,-5 12,0 q6,5 12,0" stroke="#8fc0dd" stroke-width="2" fill="none" opacity=".7"/>`;
    s+=`<path d="M${px+14},${cy+10} q6,-5 12,0 q6,5 12,0" stroke="#8fc0dd" stroke-width="2" fill="none" opacity=".5"/>`;
  }else if(t==='h'){
    s+=`<rect x="${px+10}" y="${cy}" width="${TS-20}" height="${TS/2-6}" fill="#8a6b4e"/>`;
    s+=`<path d="M${px+5},${cy+2} L${cx},${py+8} L${px+TS-5},${cy+2} Z" fill="#6b4a3a"/>`;
    s+=`<path d="M${px+5},${cy+2} L${cx},${py+8} L${cx},${cy+2} Z" fill="#7d5846"/>`;
    s+=`<rect x="${cx-4}" y="${cy+8}" width="8" height="12" fill="#463424"/>`;
  }else if(t==='#'){
    s+=`<rect x="${px}" y="${py}" width="${TS}" height="${TS}" fill="#5a5148"/>`;
    s+=`<path d="M${px},${py+TS/3} h${TS} M${px},${py+TS*2/3} h${TS} M${cx},${py} v${TS/3} M${px+TS/4},${py+TS/3} v${TS/3} M${px+TS*3/4},${py+TS/3} v${TS/3} M${cx},${py+TS*2/3} v${TS/3}" stroke="#4a4239" stroke-width="1.6"/>`;
  }else if(t==='r'){
    s+=`<circle cx="${px+12}" cy="${py+14}" r="1.6" fill="#b09c74"/><circle cx="${px+34}" cy="${py+36}" r="1.6" fill="#b09c74"/>`;
  }else if(t==='.'){
    if((x*7+y*13)%5===0) s+=`<path d="M${px+12},${py+38} q2,-6 4,0 M${px+34},${py+16} q2,-6 4,0" stroke="#6f9457" stroke-width="1.6" fill="none"/>`;
  }
  s+=`<rect x="${px}" y="${py}" width="${TS}" height="${TS}" fill="none" stroke="rgba(0,0,0,.12)"/>`;
  return s;
}

/* ── 유닛 토큰 ── */
function unitSVG(u){
  const px=u.x*TS+TS/2, py=u.y*TS+TS/2;
  const ring = u.team==='P' ? '#4a90c8' : '#c8564a';
  const acted = (u.team==='P'&&u.acted) ? 'opacity:.45;filter:grayscale(.9);' : '';
  const r=TS/2-5;
  const hpw = TS-16, hpr = Math.max(0, u.hp/u.maxhp);
  let s=`<g class="unit" id="ug-${u.uid}" data-ux="${u.x}" data-uy="${u.y}" style="${acted}cursor:pointer;">`;
  s+=`<ellipse cx="${px}" cy="${py+r-2}" rx="${r*0.8}" ry="4" fill="rgba(0,0,0,.3)"/>`;
  s+=`<circle cx="${px}" cy="${py-2}" r="${r}" fill="#3a3226" stroke="${ring}" stroke-width="3"/>`;
  s+=`<clipPath id="clip-${u.uid}"><circle cx="${px}" cy="${py-2}" r="${r-2}"/></clipPath>`;
  const sc=(r-2)*2/100, ox=px-(r-2), oy=py-2-(r-2);
  s+=`<g clip-path="url(#clip-${u.uid})"><g transform="translate(${ox},${oy}) scale(${sc})"><rect width="100" height="100" fill="#4a4032"/><use href="#pt-${u.cid}"/></g></g>`;
  if(u.boss) s+=`<path d="M${px-7},${py-r-7} L${px-4},${py-r-2} L${px},${py-r-8} L${px+4},${py-r-2} L${px+7},${py-r-7} L${px+6},${py-r-1} L${px-6},${py-r-1} Z" fill="#ffd94a" stroke="#8a6a10" stroke-width=".8"/>`;
  if(u.poison) s+=`<circle cx="${px-r+3}" cy="${py-r+5}" r="6.5" fill="#8a4ab0" stroke="#141008" stroke-width="1"/><text x="${px-r+3}" y="${py-r+8}" text-anchor="middle" font-size="8" fill="#fff" font-weight="bold">독</text>`;
  s+=`<rect x="${px-hpw/2}" y="${py+r-8}" width="${hpw}" height="5" rx="2.5" fill="#141008" stroke="#000" stroke-width=".6"/>`;
  s+=`<rect x="${px-hpw/2+0.8}" y="${py+r-7.2}" width="${(hpw-1.6)*hpr}" height="3.4" rx="1.7" fill="${hpr>0.4?'#7ec860':'#e07a4a'}"/>`;
  const tb={'외':'#a05038','경':'#3e8a62','내':'#4a6aa0'}[u.type];
  s+=`<circle cx="${px+r-3}" cy="${py-r+5}" r="7" fill="${tb}" stroke="#141008" stroke-width="1"/>`;
  s+=`<text x="${px+r-3}" y="${py-r+8.5}" text-anchor="middle" font-size="9" fill="#fff" font-weight="bold">${u.type}</text>`;
  s+=`</g>`;
  return s;
}

/* ── 타이틀 아트 ── */
function titleArtSVG(){
  return `<svg id="title-art" viewBox="0 0 900 320" width="100%">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a2438"/><stop offset=".55" stop-color="#3a3450"/><stop offset="1" stop-color="#8a5a48"/>
    </linearGradient>
    <linearGradient id="mtn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a4258"/><stop offset="1" stop-color="#2a2438"/>
    </linearGradient>
  </defs>
  <rect width="900" height="320" fill="url(#sky)"/>
  <circle cx="700" cy="80" r="46" fill="#f0e0b8" opacity=".9"/>
  <circle cx="686" cy="72" r="40" fill="#4a4458" opacity=".25"/>
  <path d="M0,240 L120,130 L210,220 L300,110 L420,250 L900,250 L900,320 L0,320 Z" fill="url(#mtn)"/>
  <path d="M380,250 L520,150 L640,240 L760,170 L900,260 L900,320 L380,320 Z" fill="#241e30"/>
  <path d="M0,265 Q450,240 900,270 L900,320 L0,320 Z" fill="#181420"/>
  <g opacity=".9">
    <path d="M448,236 q-10,-38 4,-72 q3,-8 8,-1 q12,30 2,73 Z" fill="#100c14"/>
    <circle cx="456" cy="152" r="10" fill="#100c14"/>
    <path d="M456,166 l-30,20 M456,166 l32,18 M450,205 l-22,26 M460,205 l20,28" stroke="#100c14" stroke-width="5" stroke-linecap="round"/>
    <path d="M488,180 q40,-16 66,-46" stroke="#100c14" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M554,134 q14,-8 6,14 q18,-12 8,10 q16,-8 4,12" stroke="#d9b36c" stroke-width="3" fill="none" stroke-linecap="round" opacity=".85"/>
  </g>
  <g opacity=".85">
    <path d="M600,60 q10,4 20,0 q-8,10 -20,8 Z" fill="#181420"/>
    <path d="M640,44 q12,5 24,0 q-10,12 -24,9 Z" fill="#181420"/>
  </g>
  <text x="450" y="300" text-anchor="middle" font-size="15" fill="#c9b284" letter-spacing="8" opacity=".8">飛雪連天射白鹿 笑書神俠倚碧鴛</text>
</svg>`;
}

export { shade, portraitInner, buildPortraitDefs, ptSVG, tileSVG, unitSVG, titleArtSVG };
