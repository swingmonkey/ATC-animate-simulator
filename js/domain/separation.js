/**
 * domain/separation.js — 间隔标准、冲突检测与冲突预测（领域层）
 *
 * 由原 simulation/conflict.js 上迁而来（conflict.js 已删除）：
 *   · 现行判定：isAircraftInConflictAt / isAircraftInConflict / getConflictPairs（保留原语义）
 *   · 新增预测：以确定性位置函数外推未来若干秒的最小预计间隔，给出 AMBER / RED 分级
 * 预测是管制游戏“提前提醒”与评分“安全项”的输入（P1 接入 HUD 告警）。
 */

import { state } from '../core/store.js';
import { kmToPx } from '../core/viewport.js';
import { CONFLICT_ALT_M } from '../core/constants.js';
import { altOf, posX, posY } from '../core/accessors.js';
import { calculateAircraftPositionAtTime } from '../simulation/motion.js';

/* ---------------- 间隔标准 ---------------- */

/** 水平间隔标准 (km)：取设置中的最小间隔（如 15nm） */
export function horizontalStandardKm() {
    return state.defaults.minSeparationNm;
}

/** 垂直间隔标准 (m) */
export function verticalStandardM() {
    return CONFLICT_ALT_M;
}

/** 水平间隔 (km) */
export function horizontalSeparationKm(a, b) {
    const dx = posX(a) - posX(b), dy = posY(a) - posY(b);
    return Math.hypot(dx, dy) / (kmToPx(1) || 1);
}

/** 垂直间隔 (m) */
export function verticalSeparationM(a, b) {
    return Math.abs(altOf(a) - altOf(b));
}

/* ---------------- 现行冲突判定（保留原语义） ---------------- */

export function isAircraftInConflictAt(x, y, altitude, acId) {
    const thresholdPx = kmToPx(state.defaults.minSeparationNm);
    for (const other of state.aircraft) {
        if (other.id === acId) continue;
        if (other.landed || other._visible === false) continue;
        if (state.time < (other.startTime || 0)) continue;
        if (Math.abs(altOf(other) - altitude) > CONFLICT_ALT_M) continue;
        const ox = posX(other), oy = posY(other);
        if (Math.sqrt((ox - x) ** 2 + (oy - y) ** 2) < thresholdPx) return true;
    }
    return false;
}

export function isAircraftInConflict(ac) {
    if (ac.landed || ac._visible === false) return false;
    return isAircraftInConflictAt(posX(ac), posY(ac), altOf(ac), ac.id);
}

/** 当前所有冲突配对（绘制告警线用） */
export function getConflictPairs() {
    const thresholdPx = kmToPx(state.defaults.minSeparationNm);
    const pairs = [];
    const acs = state.aircraft.filter(a => !a.landed && a._visible !== false
        && state.time >= (a.startTime || 0));
    for (let i = 0; i < acs.length; i++) {
        for (let j = i + 1; j < acs.length; j++) {
            const a = acs[i], b = acs[j];
            if (Math.abs(altOf(a) - altOf(b)) > CONFLICT_ALT_M) continue;
            const paX = posX(a), paY = posY(a), pbX = posX(b), pbY = posY(b);
            if (Math.sqrt((pbX - paX) ** 2 + (pbY - paY) ** 2) < thresholdPx) {
                pairs.push([a, b]);
            }
        }
    }
    return pairs;
}

/* ---------------- 冲突预测 ---------------- */

/**
 * 预测两机在未来 horizonSec 秒内的最小间隔（确定性外推，不修改任何状态）。
 * @param {object} a 航空器
 * @param {object} b 航空器
 * @param {number} [horizonSec] 预测时长（秒）
 * @param {number} [stepSec] 采样间隔（秒）
 * @returns {{minKm:number, minM:number, atSec:number}} 最小水平间隔(km)/对应垂直间隔(m)/发生时刻
 */
export function predictMinSeparation(a, b, horizonSec = 120, stepSec = 10) {
    let minKm = Infinity, minM = Infinity, atSec = 0;
    const pxPerKm = kmToPx(1) || 1;
    for (let t = 0; t <= horizonSec; t += stepSec) {
        const pa = t === 0 ? { x: posX(a), y: posY(a) } : calculateAircraftPositionAtTime(a, state.time + t);
        const pb = t === 0 ? { x: posX(b), y: posY(b) } : calculateAircraftPositionAtTime(b, state.time + t);
        if (!pa || !pb) continue;
        const km = Math.hypot(pa.x - pb.x, pa.y - pb.y) / pxPerKm;
        // 垂直：按当前升降趋势线性外推（仅用于分级，不追求精确）
        const va = (altOf(a) - altOf(b));
        if (km < minKm) { minKm = km; minM = Math.abs(va); atSec = t; }
    }
    return { minKm, minM, atSec };
}

/**
 * 预测冲突清单（含分级）。
 * @returns {Array<{a:object,b:object,minKm:number,atSec:number,level:'amber'|'red'}>}
 */
export function predictedConflicts(horizonSec = 120) {
    const standardKm = horizontalStandardKm();
    const list = [];
    const acs = state.aircraft.filter(a => state.time >= (a.startTime || 0) && !a.landed);
    for (let i = 0; i < acs.length; i++) {
        for (let j = i + 1; j < acs.length; j++) {
            const a = acs[i], b = acs[j];
            if (verticalSeparationM(a, b) > CONFLICT_ALT_M * 2) continue;   // 高度已安全分离，跳过
            const { minKm, minM, atSec } = predictMinSeparation(a, b, horizonSec, 15);
            if (minM > CONFLICT_ALT_M) continue;
            if (minKm >= standardKm * 1.2) continue;
            list.push({
                a, b, minKm, minM, atSec,
                level: minKm < standardKm ? 'red' : 'amber'
            });
        }
    }
    return list.sort((x, y) => x.minKm - y.minKm);
}
