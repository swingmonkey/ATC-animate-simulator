/**
 * simulation/conflict.js — 冲突检测（运动模型层）
 * 基于最小间隔(默认 15nm)与高度差(默认 300m)的配对检测。使用收敛后的显示高度。
 */

import { state, kmToPx } from '../core.js';

function acPos(ac) {
    return {
        x: ac.displayX !== undefined ? ac.displayX : ac.x,
        y: ac.displayY !== undefined ? ac.displayY : ac.y,
        alt: ac.displayAltitude ?? ac.altitude
    };
}

export function isAircraftInConflictAt(x, y, altitude, acId) {
    const thresholdPx = kmToPx(state.defaults.minSeparationNm);
    const altThreshold = 300;
    for (const other of state.aircraft) {
        if (other.id === acId) continue;
        if (state.time < (other.startTime || 0)) continue;
        if (Math.abs((other.displayAltitude ?? other.altitude) - altitude) > altThreshold) continue;
        const ox = other.displayX !== undefined ? other.displayX : other.x;
        const oy = other.displayY !== undefined ? other.displayY : other.y;
        if (Math.sqrt((ox - x) ** 2 + (oy - y) ** 2) < thresholdPx) return true;
    }
    return false;
}

export function isAircraftInConflict(ac) {
    const p = acPos(ac);
    return isAircraftInConflictAt(p.x, p.y, p.alt, ac.id);
}

/** 返回所有冲突配对（用于绘制告警线） */
export function getConflictPairs() {
    const thresholdPx = kmToPx(state.defaults.minSeparationNm);
    const altThreshold = 300;
    const pairs = [];
    const acs = state.aircraft.filter(a => state.time >= (a.startTime || 0));
    for (let i = 0; i < acs.length; i++) {
        for (let j = i + 1; j < acs.length; j++) {
            const a = acs[i], b = acs[j];
            if (Math.abs((a.displayAltitude ?? a.altitude) - (b.displayAltitude ?? b.altitude)) > altThreshold) continue;
            const pa = acPos(a), pb = acPos(b);
            if (Math.sqrt((pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2) < thresholdPx) {
                pairs.push([a, b]);
            }
        }
    }
    return pairs;
}
