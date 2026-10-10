/**
 * core/sfx.js — 芯片音效（WebAudio 实时合成，内核层叶子模块）
 *
 * 无外部音频资源：全部用振荡器 + 包络现场合成 GBA 风「哔哔」声，
 * 默认开启，开关状态存 localStorage（键 atc_simulator_sfx）。
 * AudioContext 懒创建（浏览器自动播放策略要求首次用户手势后再启动）。
 */

const PREF_KEY = 'atc_simulator_sfx';

let audioCtx = null;
let masterGain = null;
let enabled = true;

function loadPref() {
    try {
        const raw = localStorage.getItem(PREF_KEY);
        if (raw === null) return true;
        return raw === '1';
    } catch (e) { return true; }
}
enabled = loadPref();

function savePref() {
    try { localStorage.setItem(PREF_KEY, enabled ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
}

function ensureContext() {
    if (audioCtx) return audioCtx;
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
        audioCtx = new AC();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.16;
        masterGain.connect(audioCtx.destination);
    } catch (e) { audioCtx = null; }
    return audioCtx;
}

/**
 * 一个芯片音符：方波/三角波 + 指数衰减包络，可带终点频率滑音。
 * @param {number} freq 起始频率 Hz
 * @param {number} delay 相对现在的延迟秒
 * @param {number} dur 时长秒
 * @param {OscillatorType} type 波形
 * @param {number} vol 相对音量（0..1）
 * @param {number|null} slideTo 滑音终点频率
 */
function tone(freq, delay, dur, type = 'square', vol = 1, slideTo = null) {
    const ac = ensureContext();
    if (!ac || !masterGain) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

/** 噪声脉冲（用于「哐」的落地打击感） */
function noiseHit(delay, dur, vol = 0.6) {
    const ac = ensureContext();
    if (!ac || !masterGain) return;
    const t0 = ac.currentTime + delay;
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buffer = ac.createBuffer(1, len, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    src.start(t0);
}

/** 音效库：名字 → 合成谱面（可叠加多轨） */
const RECIPES = {
    click: () => tone(680, 0, 0.06, 'square', 0.5),
    issue: () => { tone(520, 0, 0.07, 'square', 0.7); tone(780, 0.07, 0.09, 'square', 0.7); },
    readback: () => { tone(880, 0, 0.06, 'triangle', 0.8); tone(1174, 0.06, 0.08, 'triangle', 0.6); },
    error: () => { tone(300, 0, 0.14, 'sawtooth', 0.5, 140); noiseHit(0, 0.08, 0.3); },
    alert: () => { tone(196, 0, 0.12, 'sawtooth', 0.55); tone(196, 0.16, 0.12, 'sawtooth', 0.55); },
    land: () => {
        // 上行琶音 + 一记落地打击（C-E-G-C）
        noiseHit(0, 0.09, 0.5);
        tone(523, 0.02, 0.09, 'square', 0.7);
        tone(659, 0.10, 0.09, 'square', 0.7);
        tone(784, 0.18, 0.09, 'square', 0.7);
        tone(1046, 0.26, 0.14, 'square', 0.8);
    },
    bonus: () => {
        noiseHit(0, 0.07, 0.4);
        tone(659, 0.02, 0.07, 'square', 0.7);
        tone(784, 0.09, 0.07, 'square', 0.7);
        tone(1046, 0.16, 0.07, 'square', 0.7);
        tone(1318, 0.23, 0.07, 'square', 0.8);
        tone(1568, 0.30, 0.16, 'square', 0.9);
    },
    badge: () => {
        // 道馆徽章小号角：G-E-C-E-G
        tone(392, 0, 0.11, 'square', 0.7);
        tone(523, 0.11, 0.11, 'square', 0.7);
        tone(659, 0.22, 0.16, 'square', 0.8);
        tone(523, 0.40, 0.11, 'square', 0.7);
        tone(784, 0.51, 0.24, 'square', 0.9);
    },
    coffee: () => {
        // 咕咚咕咚：三个下滑「吞咽」音 + 满足的气音
        tone(520, 0, 0.09, 'sine', 0.5, 300);
        tone(500, 0.12, 0.09, 'sine', 0.5, 280);
        tone(480, 0.24, 0.14, 'sine', 0.5, 220);
        tone(660, 0.40, 0.10, 'triangle', 0.6);
    },
    grade: () => {
        tone(523, 0, 0.12, 'square', 0.7);
        tone(659, 0.12, 0.12, 'square', 0.7);
        tone(784, 0.24, 0.12, 'square', 0.7);
        tone(1046, 0.36, 0.20, 'square', 0.8);
        tone(1318, 0.56, 0.30, 'triangle', 0.9);
    },
    toggle: () => { tone(440, 0, 0.06, 'square', 0.6); tone(660, 0.06, 0.08, 'square', 0.6); }
};

export const sfx = {
    get enabled() { return enabled; },

    /** 开/关（写入 localStorage；返回新状态） */
    setEnabled(next) {
        enabled = !!next;
        savePref();
        return enabled;
    },

    /** 切换开关；打开时立即播一声确认 */
    toggle() {
        enabled = !enabled;
        savePref();
        if (enabled) {
            ensureContext();
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
            RECIPES.toggle();
        }
        return enabled;
    },

    /**
     * 播一个音效（未知名忽略；关闭时空转）。
     * @param {keyof typeof RECIPES} name
     */
    play(name) {
        if (!enabled) return;
        const ac = ensureContext();
        if (!ac) return;
        if (ac.state === 'suspended') ac.resume();
        const recipe = RECIPES[name];
        if (recipe) recipe();
    }
};
