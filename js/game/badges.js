/**
 * game/badges.js — 徽章收集（口袋式道馆徽章，游戏层）
 *
 * 玩法钩子：把既有班次目标（落地 / 连击 / 零告警 / 复诵 / 评级 / 流量 / 净空）
 * 变成「可见的收集品」——班次中首次落地即时授章，结算时按结果补评其余徽章。
 * 授予徽章发 BADGE_EARNED 事件（render/effects.js 播 toast + 音效）。
 *
 * 持久化：localStorage 键 atc_simulator_badges_v1（与场景存档分离，换关卡不清空）。
 * 依赖方向：core（0）与同层；不触碰渲染与界面。
 */

import { bus, EV } from '../core/eventBus.js';

const STORAGE_KEY = 'atc_simulator_badges_v1';

/** 徽章定义（icon 为单字符徽面，渲染为掌机徽章 chip） */
export const BADGES = Object.freeze([
    { id: 'first-landing', icon: '落', name: '初心管制', desc: '完成职业生涯第一次落地' },
    { id: 'streak-five', icon: '连', name: '连击达人', desc: '单班连续 5 架无延误落地' },
    { id: 'clean-five', icon: '安', name: '安全新星', desc: '单班落地 ≥5 架且零间隔不足' },
    { id: 'no-mva', icon: '净', name: '净空卫士', desc: '单班落地 ≥5 架且零最低高度区违规' },
    { id: 'readback-perfect', icon: '诵', name: '复诵模范', desc: '单班落地 ≥3 架且未纠正复诵为 0' },
    { id: 'flow-ten', icon: '流', name: '流量担当', desc: '单班落地 ≥10 架' },
    { id: 'grade-s', icon: 'S', name: '白金评级', desc: '单班取得 S 评级' }
]);

const BADGE_BY_ID = new Map(BADGES.map(b => [b.id, b]));

/** 已获得徽章表（内存缓存，{ [id]: true }） */
const earned = loadEarned();
/** 本班次新获徽章（结算面板展示用；开班清零） */
let recentAwards = [];

function loadEarned() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
}

function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(earned)); } catch (e) { /* 隐私模式忽略 */ }
}

/** 徽章墙数据（HUD / 面板 / 冒烟共用） */
export function badgeSummary() {
    const earnedList = BADGES.filter(b => earned[b.id]);
    return {
        total: BADGES.length,
        earnedCount: earnedList.length,
        earnedIds: earnedList.map(b => b.id),
        earned: earnedList,
        lastId: earnedList.length ? earnedList[earnedList.length - 1].id : null,
        recent: recentAwards.map(id => BADGE_BY_ID.get(id)).filter(Boolean),
        recentIds: recentAwards.slice(),
        badges: BADGES.map(b => ({ ...b, owned: !!earned[b.id] }))
    };
}

/**
 * 授予一枚徽章（已获得则返回 null）。
 * @param {string} id 徽章 id
 * @returns {object|null} 新获得的徽章定义
 */
export function tryAward(id) {
    const badge = BADGE_BY_ID.get(id);
    if (!badge || earned[id]) return null;
    earned[id] = true;
    recentAwards.push(id);
    persist();
    bus.emit(EV.BADGE_EARNED, { id, badge, total: BADGES.length, earnedCount: badgeSummary().earnedCount });
    return badge;
}

/** 按班次结算结果补评徽章（纯函数部分：返回命中的 id 列表） */
export function evaluateSessionBadges(result) {
    if (!result) return [];
    const hits = [];
    const landed = result.landed || 0;
    const counts = result.counts || {};
    if (landed >= 1) hits.push('first-landing');
    if ((result.streak || 0) >= 5) hits.push('streak-five');
    if (landed >= 5 && (counts.separation || 0) === 0) hits.push('clean-five');
    if (landed >= 5 && (counts.mva || 0) === 0) hits.push('no-mva');
    if (landed >= 3 && (counts.readback || 0) === 0) hits.push('readback-perfect');
    if (landed >= 10) hits.push('flow-ten');
    if (result.grade === 'S') hits.push('grade-s');
    return hits;
}

/**
 * 班次中即时授章：首次落地即授「初心管制」（不等结算）。
 * 结算补评由 main.js 接线 EV.SESSION_ENDED → tryAward(evaluateSessionBadges)。
 */
bus.on(EV.SCORE_CHANGED, ({ event } = {}) => {
    if (event && event.kind === 'LANDED') tryAward('first-landing');
});

/* 开班清零「本班新获」，让结算面板只展示当班成果 */
bus.on(EV.SESSION_STARTED, () => { recentAwards = []; });
