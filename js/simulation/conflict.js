/**
 * simulation/conflict.js — 冲突检测（运动模型层）
 * 基于最小间隔(默认 15nm)与高度差(默认 300m)的配对检测。使用收敛后的显示高度。
 */

import { state } from '../core/store.js';
import { kmToPx } from '../core/viewport.js';
import { CONFLICT_ALT_M } from '../core/constants.js';
import { altOf, posX, posY } from '../core/accessors.js';

export function isAircraftInConflictAt(x, y, altitude, acId) {
    const thresholdPx = kmToPx(state.defaults.minSeparationNm);
    for (const other of state.aircraft) {
        if (other.id === acId) continue;
        if (state.time < (other.startTime || 0)) continue;
        if (Math.abs(altOf(other) - altitude) > CONFLICT_ALT_M) continue;
        const ox = posX(other), oy = posY(other);
        if (Math.sqrt((ox - x) ** 2 + (oy - y) ** 2) < thresholdPx) return true;
    }
    return false;
}

export function isAircraftInConflict(ac) {
    return isAircraftInConflictAt(posX(ac), posY(ac), altOf(ac), ac.id);
}

/** 返回所有冲突配对（用于绘制告警线） */
export function getConflictPairs() {
    const thresholdPx = kmToPx(state.defaults.minSeparationNm);
    const pairs = [];
    const acs = state.aircraft.filter(a => state.time >= (a.startTime || 0));
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
