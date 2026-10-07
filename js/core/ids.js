/**
 * core/ids.js — 统一 ID 生成（内核层·叶子模块）
 * 替代原先 Date.now()（同毫秒碰撞）与随机序列（跨会话碰撞）三套并存的方案。
 * 以当前时间戳 ×1000 为种子单调递增，与历史数据中的 Date.now()/随机小 ID 均不冲突。
 */

let seq = Date.now() * 1000;

export function nextId() {
    return ++seq;
}