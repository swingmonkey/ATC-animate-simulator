/**
 * core/random.js — 带种子的伪随机（内核层·叶子模块）
 *
 * 用途：流量注入、机型/航司抽取、复诵错诵抽取等**需要可复现**的随机。
 * 项目支柱之一是「录输入即可逐帧复现」（docs/PLAN-v2.md §3.1、§11），
 * 因此所有影响玩法的随机都必须来自这里，而不是 Math.random。
 */

/** 默认种子：同一关卡默认复现同一套流量 */
export const DEFAULT_SEED = 20261007;

/**
 * mulberry32：同一种子产生同一序列。
 * @param {number} seed
 * @returns {() => number} [0,1) 均匀随机
 */
export function makeRng(seed = DEFAULT_SEED) {
    let a = (seed >>> 0) || 1;
    return function rng() {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 按权重抽一项（权重 ≤0 视为不参与；全部为 0 时退回均匀抽取）。
 * @param {() => number} rng
 * @param {Array} items
 * @param {(item:any)=>number} [weightOf]
 */
export function pickWeighted(rng, items, weightOf) {
    const weight = weightOf || (() => 1);
    if (!items.length) return null;
    let total = 0;
    for (const it of items) total += Math.max(0, Number(weight(it)) || 0);
    if (total <= 0) return items[Math.floor(rng() * items.length)];
    let r = rng() * total;
    for (const it of items) {
        r -= Math.max(0, Number(weight(it)) || 0);
        if (r <= 0) return it;
    }
    return items[items.length - 1];
}
