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
 * CCAR-93TM-R6 §118 对齐（docs/CCAR-93TM-ALIGNMENT.md §6.2）：
 *   必背复诵按类别分为三组 —— 跑道类（②跑道类 + ③正在使用的跑道）、
 *   航路类（①航路许可）、高度类（③高度表拨正值/应答机编码/高度层/航向速度/过渡高度层）。
 *   错诵**按类别加权抽取**：跑道类最易被漏且后果最重 → 权重最高；兜底项不参与抽取。
 *
 * 依赖方向：core（0）与 data（1）；不触碰界面。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { makeRng, pickWeighted } from '../core/random.js';
import { altOf } from '../core/accessors.js';
import { approachLabel, unit } from '../data/atcUnits.js';

/** 复诵未纠正的宽限时间（模拟秒），超时计入「未复诵」 */
export const READBACK_GRACE_SEC = 30;

/* ---------------- §118 必背复诵清单（分级） ---------------- */

/** ② 跑道类 + ③ 正在使用的跑道（跑道号）——最易被漏、后果最重 */
export const CRITICAL_RUNWAY = ['lineUp', 'holdShort', 'crossRunway', 'backtrack', 'land', 'takeoff', 'runway'];

/** ③ 高度层 / 航向速度 / 高度表拨正值 / 应答机编码 / 过渡高度层 */
export const CRITICAL_ALT = ['alt', 'climb', 'descend', 'level', 'hdg', 'turnLeft', 'turnRight', 'spd', 'qnh', 'squawk', 'transitionLevel'];

/** ① 航路许可（完整航路/进场程序） */
export const CRITICAL_ROUTE = ['approach', 'direct', 'route'];

/** 类别抽取权重：跑道类 > 航路类 > 高度类（只影响错诵抽取，不影响复诵正文） */
export const READBACK_GROUP_WEIGHTS = { runway: 6, route: 3, alt: 2 };

/** 分组表（顺序即界面/文档的展示顺序） */
export const CRITICAL_GROUPS = [
    { key: 'runway', items: CRITICAL_RUNWAY },
    { key: 'route', items: CRITICAL_ROUTE },
    { key: 'alt', items: CRITICAL_ALT }
];

/**
 * 动作 type → 所属关键类别；非关键项（如 handoff）返回 null —— 兜底项不参与错诵抽取。
 * @param {string} type
 * @returns {'runway'|'route'|'alt'|null}
 */
export function criticalGroupOf(type) {
    for (const g of CRITICAL_GROUPS) if (g.items.indexOf(type) >= 0) return g.key;
    return null;
}

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
    runway: a => `跑道 ${a.value}`,
    /* §118 ② 跑道类（parser 暂未产生，措辞先就位并可单测） */
    lineUp: (a, ac) => `进跑道 ${runwayOf(a, ac)}`,
    holdShort: (a, ac) => `跑道外等待，跑道 ${runwayOf(a, ac)}`,
    crossRunway: (a, ac) => `穿越跑道 ${runwayOf(a, ac)}`,
    backtrack: (a, ac) => `在跑道 ${runwayOf(a, ac)} 上滑行`,
    /* §118 ③ 高度表拨正值 / 应答机编码 / 过渡高度层 */
    qnh: a => `高度表拨正 ${a.value}`,
    squawk: a => `应答机 ${a.value}`,
    transitionLevel: a => `过渡高度层 ${a.value}`,
    /* §118 ① 完整航路许可 */
    route: a => `经 ${a.value}`
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
 * 按 §118 类别加权抽取一个「被漏掉」的复诵项。
 * 只在关键类别（跑道/航路/高度）内抽取；无关键项时返回 null（兜底项不参与）。
 * @param {Array<{key:string, text:string}>} items
 * @param {() => number} [random] 随机源，默认走种子序列（可注入以便单测）
 * @returns {{key:string, text:string}|null}
 */
export function pickMissedItem(items, random) {
    const rand = typeof random === 'function' ? random : rng;
    const byGroup = new Map();
    for (const it of items || []) {
        const gk = criticalGroupOf(it.key);
        if (!gk) continue;                               // 非关键/兜底项不参与抽取
        if (!byGroup.has(gk)) byGroup.set(gk, []);
        byGroup.get(gk).push(it);
    }
    const present = CRITICAL_GROUPS
        .filter(g => byGroup.has(g.key))
        .map(g => ({ key: g.key, weight: READBACK_GROUP_WEIGHTS[g.key], entries: byGroup.get(g.key) }));
    if (!present.length) return null;
    const group = pickWeighted(rand, present, g => g.weight);
    return pickWeighted(rand, group.entries, () => 1);
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
        const target = pickMissedItem(items, random);
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
