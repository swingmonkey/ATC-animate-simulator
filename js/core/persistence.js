/**
 * core/persistence.js — localStorage 持久化（内核层）
 * 仅负责序列化/反序列化场景数据，刷新与重绘由 store 事件驱动。
 * 存储键保持 atc_simulator_state_v2，兼容既有用户数据（含 v1 迁移）。
 */

import { state } from './store.js';

const STORAGE_KEY = 'atc_simulator_state_v2';
const LEGACY_STORAGE_KEY = 'atc_simulator_state_v1';

export function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            routePoints: state.routePoints,
            routes: state.routes,
            aircraft: state.aircraft.map(({ history, ...rest }) => rest),   // history 为运行期采样（P2 剖面图），不入档
            defaults: state.defaults,
            pointNameCounter: state.pointNameCounter,
            focusAirport: state.focusAirport,
            autoHandoff: state.autoHandoff,
            autoClearance: state.autoClearance
        }));
    } catch (e) {
        console.warn('保存场景状态失败:', e);
    }
}

/**
 * 恢复场景数据。
 * @returns {boolean} 是否恢复了数据
 */
export function loadState() {
    try {
        let raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            // 兼容旧版本存储键
            const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
            if (legacy) {
                localStorage.setItem(STORAGE_KEY, legacy);
                raw = legacy;
            } else {
                return false;
            }
        }
        const data = JSON.parse(raw);
        if (data.routePoints) state.routePoints = data.routePoints;
        if (data.routes) state.routes = data.routes;
        if (data.aircraft) state.aircraft = data.aircraft;
        if (data.defaults) state.defaults = { ...state.defaults, ...data.defaults };
        if (data.pointNameCounter) state.pointNameCounter = data.pointNameCounter;
        if (data.focusAirport) state.focusAirport = data.focusAirport;
        if (typeof data.autoHandoff === 'boolean') state.autoHandoff = data.autoHandoff;
        if (typeof data.autoClearance === 'boolean') state.autoClearance = data.autoClearance;
        return true;
    } catch (e) {
        console.warn('恢复场景状态失败:', e);
        return false;
    }
}