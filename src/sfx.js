/* ============================================================
   사운드 — WebAudio 절차 합성 (외부 오디오 자산 없음 · 전부 코드 생성)
   효과음 + 오음계(五音) 절차 생성 BGM + 음소거 토글
   ============================================================ */
const LS_KEY = 'kimyong_snd';
let AC = null, MASTER = null, BGMBUS = null;
let MUTED = (() => { try { return localStorage.getItem(LS_KEY) === 'off'; } catch (e) { return false; } })();
const BGMS = { mood: null, timer: null, step: 0, note: 4 };

function ctx() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  if (!AC) {
    AC = new C();
    MASTER = AC.createGain(); MASTER.gain.value = MUTED ? 0 : 1; MASTER.connect(AC.destination);
    BGMBUS = AC.createGain(); BGMBUS.gain.value = 0.14; BGMBUS.connect(MASTER);
  }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}
/* 브라우저 정책: 첫 사용자 입력에서 오디오 잠금 해제 */
document.addEventListener('pointerdown', () => {
  if (!ctx()) return;
  if (BGMS.mood && !BGMS.timer) startTimer();
}, true);

function tone(o) {
  if (!AC) return;
  const { f = 440, f2 = null, t = 0, dur = 0.15, type = 'sine', vol = 0.2, bus = null } = o;
  const now = AC.currentTime + t;
  const osc = AC.createOscillator(), g = AC.createGain();
  osc.type = type; osc.frequency.setValueAtTime(f, now);
  if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(30, f2), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g); g.connect(bus || MASTER);
  osc.start(now); osc.stop(now + dur + 0.05);
}
function noise(o) {
  if (!AC) return;
  const { t = 0, dur = 0.12, vol = 0.25, hp = 0, lp = 8000, bus = null } = o;
  const now = AC.currentTime + t;
  const len = Math.max(1, Math.floor(AC.sampleRate * dur));
  const buf = AC.createBuffer(1, len, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = AC.createBufferSource(); s.buffer = buf;
  const g = AC.createGain(); g.gain.value = vol;
  const fl = AC.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp;
  const fh = AC.createBiquadFilter(); fh.type = 'highpass'; fh.frequency.value = hp;
  s.connect(fh); fh.connect(fl); fl.connect(g); g.connect(bus || MASTER);
  s.start(now);
}
/* 발현(撥絃) — 현악기 뜯는 소리 (BGM용) */
function pluck(f, t, dur, vol) {
  if (!AC) return;
  const now = AC.currentTime + t;
  for (const [df, dv] of [[1, 1], [1.006, 0.5], [2.01, 0.22]]) {
    const osc = AC.createOscillator(), g = AC.createGain();
    osc.type = 'triangle'; osc.frequency.value = f * df;
    g.gain.setValueAtTime(vol * dv, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g); g.connect(BGMBUS);
    osc.start(now); osc.stop(now + dur + 0.05);
  }
}

/* ── 효과음 ── */
const FX = {
  ui()      { tone({ f: 780, dur: 0.05, type: 'triangle', vol: 0.08 }); },
  select()  { tone({ f: 520, dur: 0.06, type: 'triangle', vol: 0.1 }); tone({ f: 700, t: 0.05, dur: 0.07, type: 'triangle', vol: 0.1 }); },
  move()    { noise({ dur: 0.16, vol: 0.1, hp: 800, lp: 5200 }); },
  attack()  { noise({ dur: 0.09, vol: 0.14, hp: 500, lp: 7000 }); },
  hit()     { noise({ dur: 0.1, vol: 0.26, lp: 1400 }); tone({ f: 140, f2: 65, dur: 0.13, type: 'square', vol: 0.22 }); },
  crit()    { noise({ dur: 0.16, vol: 0.32, lp: 1800 }); tone({ f: 240, f2: 55, dur: 0.26, type: 'sawtooth', vol: 0.3 }); tone({ f: 1560, dur: 0.06, type: 'square', vol: 0.1 }); },
  miss()    { noise({ dur: 0.14, vol: 0.1, hp: 2200 }); },
  kill()    { tone({ f: 110, f2: 38, dur: 0.5, type: 'sawtooth', vol: 0.26 }); noise({ dur: 0.3, vol: 0.18, lp: 900 }); },
  skill()   { tone({ f: 660, f2: 1320, dur: 0.18, type: 'sine', vol: 0.16 }); noise({ t: 0.05, dur: 0.14, vol: 0.08, hp: 1500 }); },
  poison()  { tone({ f: 520, f2: 260, dur: 0.3, type: 'sine', vol: 0.14 }); },
  heal()    { [523, 659, 784].forEach((f, i) => tone({ f, t: i * 0.09, dur: 0.22, type: 'sine', vol: 0.14 })); },
  levelup() { [523, 659, 784, 1046].forEach((f, i) => tone({ f, t: i * 0.1, dur: 0.24, type: 'triangle', vol: 0.15 })); },
  phase()   { tone({ f: 82, dur: 1.1, type: 'sine', vol: 0.3 }); tone({ f: 164, dur: 0.7, type: 'sine', vol: 0.1 }); noise({ dur: 0.25, vol: 0.08, lp: 500 }); },
  gold()    { tone({ f: 1318, dur: 0.07, type: 'triangle', vol: 0.14 }); tone({ f: 1760, t: 0.07, dur: 0.13, type: 'triangle', vol: 0.14 }); },
  equip()   { tone({ f: 700, dur: 0.05, type: 'square', vol: 0.08 }); tone({ f: 520, t: 0.05, dur: 0.07, type: 'square', vol: 0.08 }); },
  victory() { [523, 587, 659, 784, 880, 1046].forEach((f, i) => tone({ f, t: i * 0.13, dur: 0.3, type: 'triangle', vol: 0.16 })); tone({ f: 1046, t: 0.8, dur: 0.7, type: 'sine', vol: 0.14 }); },
  defeat()  { [440, 392, 330, 262].forEach((f, i) => tone({ f, t: i * 0.24, dur: 0.42, type: 'sine', vol: 0.16 })); },
};
export const SFX = {
  play(name) {
    if (MUTED || !FX[name]) return;
    try { if (ctx()) FX[name](); } catch (e) {}
  }
};

/* ── BGM: 오음계 절차 생성 (궁상각치우 느낌의 A 펜타토닉) ── */
const SCALE = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
const MOODS = {
  calm:   { tempo: 340, density: 0.55, vol: 0.11, perc: false },
  battle: { tempo: 245, density: 0.72, vol: 0.13, perc: true },
};
function bgmStep() {
  if (!AC || AC.state !== 'running' || MUTED) return;
  const m = MOODS[BGMS.mood]; if (!m) return;
  const s = BGMS.step++;
  if (s % 8 === 0) pluck(SCALE[0] / 2, 0, 1.6, 0.5); /* 저음 드론 */
  if (m.perc && s % 4 === 2) noise({ dur: 0.06, vol: 0.05, hp: 3000, bus: BGMBUS });
  if (Math.random() < m.density) {
    /* 멜로디: 음계 위 랜덤 워크 */
    let n = BGMS.note + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
    n = Math.max(0, Math.min(SCALE.length - 1, n));
    if (s % 16 === 0) n = [2, 4, 5][Math.floor(Math.random() * 3)]; /* 프레이즈 시작음 정렬 */
    BGMS.note = n;
    pluck(SCALE[n], 0, 0.9, m.vol / 0.14);
  }
}
function startTimer() {
  clearInterval(BGMS.timer);
  const m = MOODS[BGMS.mood]; if (!m) return;
  BGMS.timer = setInterval(bgmStep, m.tempo);
}
export const BGM = {
  start(mood) {
    if (BGMS.mood === mood && BGMS.timer) return;
    BGMS.mood = mood; BGMS.step = 0;
    if (ctx()) startTimer();
  },
  stop() { BGMS.mood = null; clearInterval(BGMS.timer); BGMS.timer = null; },
};

/* ── 음소거 토글 ── */
export function sndOn() { return !MUTED; }
export function toggleSnd() {
  MUTED = !MUTED;
  try { localStorage.setItem(LS_KEY, MUTED ? 'off' : 'on'); } catch (e) {}
  if (MASTER) MASTER.gain.value = MUTED ? 0 : 1;
  if (!MUTED && BGMS.mood) { ctx(); startTimer(); }
  return !MUTED;
}
