/**
 * core/persistence.js — localStorage 持久化（内核层）
 * 仅负责序列化/反序列化场景数据，刷新与重绘由 store 事件驱动。
 * 存储键保持 atc_simulator_state_v2，兼容既有用户数据（含 v1 迁移）。
 *
 * M2 起档内带 schemaVersion：
 *   1 = v1.7 及更早（无 schemaVersion）
 *   2 = v1.8 M2（事件日志 / 难度曲线 / 多机场焦点）
 * 迁移逻辑收敛在纯函数 migrateState()，可被冒烟测试直接断言。
 */

import { state } from './store.js';

const STORAGE_KEY = 'atc_simulator_state_v2';
const LEGACY_STORAGE_KEY = 'atc_simulator_state_v1';

/** 当前存档 schema 版本；新增不兼容字段时递增并在 migrateState 中补迁移步骤 */
export const SCHEMA_VERSION = 2;

/** 首版 M2 新增的持久字段（旧档缺失时补默认值） */
const NEW_STATE_DEFAULTS = Object.freeze({
    eventLog: [],
    difficultyCurve: null,
    focusAirportCode: null
});

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/**
 * 纯函数：把任意档位（含无版本旧档）迁移到当前 schema。
 * 不读写 localStorage、不修改入参，便于单测与冒烟断言。
 *
 * @param {object|string|null|undefined} raw 已解析对象或 JSON 字符串
 * @returns {{schemaVersion:number,data:object,migrations:string[],from:number}} 迁移结果
 */
export function migrateState(raw) {
    let parsed = raw;
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
    }
    if (!isObj(parsed)) {
        // 返回全新默认档；eventLog 必须是独立数组，避免与模块级 NEW_STATE_DEFAULTS 共享引用（纯函数约定）
        return {
            schemaVersion: SCHEMA_VERSION,
            data: { ...NEW_STATE_DEFAULTS, eventLog: [] },
            migrations: [],
            from: SCHEMA_VERSION
        };
    }

    // 深拷贝，保证纯函数不污染调用方对象
    const data = JSON.parse(JSON.stringify(parsed));
    const from = Number.isFinite(Number(data.schemaVersion)) && Number(data.schemaVersion) > 0
        ? Math.floor(Number(data.schemaVersion))
        : 1;
    const migrations = [];

    // v1 → v2：补齐 M2 持久字段，保留原有字段（机型级 phase→flow 由 normalizeAircraft 兜底）
    if (from < 2) {
        for (const [key, fallback] of Object.entries(NEW_STATE_DEFAULTS)) {
            if (data[key] === undefined || data[key] === null) {
                data[key] = Array.isArray(fallback) ? [] : fallback;
            }
        }
        if (isObj(data.management)) {
            if (!Array.isArray(data.management.eventLog)) data.management.eventLog = [];
            if (data.management.weather === undefined) data.management.weather = 'clear';
        }
        migrations.push('v1->v2:m2-fields');
    }

    data.schemaVersion = SCHEMA_VERSION;
    return { schemaVersion: SCHEMA_VERSION, data, migrations, from };
}

export function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            routePoints: state.routePoints,
            routes: state.routes,
            aircraft: state.aircraft.map(({ history, ...rest }) => rest),   // history 为运行期采样（P2 剖面图），不入档
            defaults: state.defaults,
            pointNameCounter: state.pointNameCounter,
            focusAirport: state.focusAirport,
            autoHandoff: state.autoHandoff,
            autoClearance: state.autoClearance,
            management: state.management,
            /* M2 持久字段 */
            eventLog: Array.isArray(state.eventLog) ? state.eventLog.slice(-120) : [],
            difficultyCurve: state.difficultyCurve || null,
            focusAirportCode: state.focusAirportCode || null
        }));
    } catch (e) {
        console.warn('保存场景状态失败:', e);
    }
}

/**
 * 恢复场景数据（自动跨 schema 迁移）。
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
        const migrated = migrateState(raw);
        const data = migrated.data;
        if (data.routePoints) state.routePoints = data.routePoints;
        if (data.routes) state.routes = data.routes;
        if (data.aircraft) state.aircraft = data.aircraft;
        if (data.defaults) state.defaults = { ...state.defaults, ...data.defaults };
        if (data.pointNameCounter) state.pointNameCounter = data.pointNameCounter;
        if (data.focusAirport) state.focusAirport = data.focusAirport;
        if (typeof data.autoHandoff === 'boolean') state.autoHandoff = data.autoHandoff;
        if (typeof data.autoClearance === 'boolean') state.autoClearance = data.autoClearance;
        if (data.management) state.management = data.management;
        if (Array.isArray(data.eventLog)) state.eventLog = data.eventLog;
        if (data.difficultyCurve && typeof data.difficultyCurve === 'object') state.difficultyCurve = data.difficultyCurve;
        if (data.focusAirportCode) state.focusAirportCode = data.focusAirportCode;
        return true;
    } catch (e) {
        console.warn('恢复场景状态失败:', e);
        return false;
    }
}
