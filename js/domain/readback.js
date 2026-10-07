/**
 * domain/readback.js — 机组复诵与错诵判定（领域层）
 *
 * 真实陆空通话里，管制指令必须由机组**复诵**（readback），关键参数不得遗漏。
 * 本模块：
 *   · 把 parser 的动作列表转成中文复诵文本（`下降到 3000，CCA1234`）
 *   · 按 `state.defaults.readbackErrorRate` 抽取「错诵」（漏掉一项关键参数）——随机来自
 *     core/random.js 的**种子序列**（seedReadback 由 startGameSession 用关卡 seed 设定），
 *     因而同一 seed 的复诵序列可复现（可复盘）
 *   · 维护 ac.readback 状态：{ text, correct, missing, t, resolved, penalized }
 *     未纠正的错诵由 game/scoring.js 在宽限期后扣分（PLAN §7.2「未复诵 −3」）
 *
 * 依赖方向：core（0）与 data（1）；不触碰界面。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { makeRng } from '../core/random.js';
import { altOf } from '../core/accessors.js';
import { approachLabel, unit } from '../data/atcUnits.js';

/** 复诵未纠正的宽限时间（模拟秒），超时计入「未复诵」 */
export const READBACK_GRACE_SEC = 30;

/* ---------------- 关键复诵项（错诵仅在这些项内抽取） ---------------- */

/** 漏项抽取的候选动作 type：跑道/航路/高度相关的关键参数 */
const CRITICAL_TYPES = [
    'lineUp', 'holdShort', 'crossRunway', 'backtrack', 'land', 'takeoff', 'runway',
    'alt', 'climb', 'descend', 'level', 'hdg', 'turnLeft', 'turnRight', 'spd', 'qnh', 'squawk', 'transitionLevel',
    'approach', 'direct', 'route'
];

let rng = makeRng(1);

/** 设定复诵抽取用的种子（开始班次时用关卡 seed，保证可复现） */
export function seedReadback(seed) {
    rng = makeRng(Number.isFinite(seed) ? seed : 1);
}

/** 错诵概率（0 = 一律正确；由难度预设写入 state.defaults.readbackErrorRate） */
export function readbackErrorRate() {
    const r = state.defaults.readbackErrorRate;
    return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0;
}

/* ---------------- 动作 → 复诵措辞 ---------------- */

const runwayOf = (a, ac) => String((a && (a.runway || a.value)) || (ac && ac.runway) || '--');

const ACTION_TEXT = {
    alt: a => `高度 ${Math.round(a.value)}`,
    climb: a => (a.absolute ? `上升到 ${Math.round(a.value)}` : `上升 ${Math.round(a.value)}`),
    descend: a => (a.absolute ? `下降到 ${Math.round(a.value)}` : `下降 ${Math.round(a.value)}`),
    level: (a, ac) => `保持 ${Math.round(altOf(ac))}`,
    hdg: a => `航向 ${Math.round(a.value)}`,
    turnLeft: a => `左转 ${Math.round(a.value)} 度`,
    turnRight: a => `右转 ${Math.round(a.value)} 度`,
    spd: a => `速度 ${Math.round(a.value)} 节`,
    speedUp: () => '加速',
    slowDown: () => '减速',
    expedite: () => '尽快加速',
    hold: () => '盘旋',
    goaround: () => '复飞',
    direct: a => `直飞 ${String(a.value).toUpperCase()}`,
    approach: (a, ac) => `可以${approachLabel(a.value || 'ILS')}，跑道 ${a.runway || ac.runway || '--'}`,
    land: (a, ac) => `可以落地，跑道 ${a.runway || ac.runway || '--'}`,
    takeoff: (a, ac) => `可以起飞，跑道 ${ac.runway || '--'}`,
    handoff: a => `联系${unit(a.value).short}`,
    runway: a => `跑道 ${a.value}`
};

/**
 * 单条动作的复诵措辞（未登记的动作返回空串）。
 * @param {{type:string}} action
 * @param {object} [ac]
 * @returns {string}
 */
export function actionTextOf(action, ac) {
    const fn = action && ACTION_TEXT[action.type];
    return fn ? String(fn(action, ac) || '') : '';
}

/**
 * 逐项复诵条目（错诵抽取与分项显示共用）。
 * @returns {Array<{key:string, text:string}>}
 */
function readbackItems(ac, parsed) {
    const out = [];
    for (const act of (parsed && parsed.actions) || []) {
        const text = actionTextOf(act, ac);
        if (text) out.push({ key: act.type, text });
    }
    return out;
}

/**
 * 抽取一个「被漏掉」的复诵项；只考虑关键参数，非关键/兜底项不参与。
 * @param {Array<{key:string, text:string}>} items
 * @returns {{key:string, text:string}|null}
 */
function pickMissedItem(items) {
    return (items || []).find(it => CRITICAL_TYPES.indexOf(it.key) >= 0) || null;
}

/* ---------------- 状态读写 ---------------- */

/** 复诵状态文本（指令台 / 进程单显示用） */
export function readbackTextOf(ac) {
    const rb = ac && ac.readback;
    if (!rb) return '';
    if (rb.correct) return `✅ 复诵：${rb.text}`;
    if (rb.resolved) return `☑ 已纠正（漏：${rb.missing}）`;
    return `⚠ 复诵不符（漏：${rb.missing}）—— 请要求复诵`;
}

/** 是否存在未纠正的错诵 */
export function isReadbackPending(ac) {
    const rb = ac && ac.readback;
    return !!rb && !rb.correct && !rb.resolved;
}

/** 记录一次**正确**复诵（自动许可等由领域层直接播报复诵时调用） */
export function noteCorrectReadback(ac, text) {
    ac.readback = {
        text: text || `收到，${ac.flightNo}`,
        correct: true,
        missing: null,
        t: state.time,
        resolved: true,
        penalized: false
    };
    bus.emit(EV.UNIT_CHANGED, { ac, readback: ac.readback });
    return ac.readback;
}

/**
 * 生成并播报一次复诵（含按概率抽取的错诵）。
 * @param {object} ac 航空器
 * @param {{actions:Array}} parsed parser 结果
 * @param {{errorRate?:number, rng?:() => number}} [opts] 测试可注入固定概率/随机源
 * @returns {{text:string, correct:boolean, missing:string|null}}
 */
export function makeReadback(ac, parsed, opts = {}) {
    const items = readbackItems(ac, parsed);
    const rate = Number.isFinite(opts.errorRate) ? opts.errorRate : readbackErrorRate();
    const random = opts.rng || rng;

    let missing = null;
    let kept = items;
    if (rate > 0 && random() < rate) {
        const target = pickMissedItem(items);
        if (target) {
            missing = target;
            kept = items.filter(it => it !== target);
        }
    }

    const text = kept.length
        ? `${kept.map(i => i.text).join('，')}，${ac.flightNo}`
        : `收到，${ac.flightNo}`;
    ac.readback = {
        text,
        correct: !missing,
        missing: missing ? missing.text : null,
        t: state.time,
        resolved: false,
        penalized: false
    };
    addComm('pilot', text);
    bus.emit(EV.UNIT_CHANGED, { ac, readback: ac.readback });
    return ac.readback;
}

/**
 * 纠正复诵（机组补念 / 管制员重新下发）：清除未纠正状态。
 * @returns {boolean} 是否发生了状态变化
 */
export function resolveReadback(ac, opts = {}) {
    const rb = ac && ac.readback;
    if (!rb || rb.correct || rb.resolved) return false;
    rb.resolved = true;
    rb.resolvedAt = state.time;
    rb.resolvedBy = opts.by || 'reissue';
    bus.emit(EV.UNIT_CHANGED, { ac, readback: rb });
    return true;
}
