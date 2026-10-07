/**
 * core/eventBus.js — 事件总线 + 重绘标记（内核层·叶子模块）
 * 发布-订阅解耦 UI 刷新与状态变更，替代散落各处的 updateXxxList() 人肉调用。
 * 借鉴 openscope 的 EventEmitter 模式：模块间不互相直接调用，只订阅事件。
 */

const listeners = new Map();

export const bus = {
    /** 订阅事件，返回取消订阅函数 */
    on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
        return () => bus.off(event, handler);
    },
    off(event, handler) {
        listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
        listeners.get(event)?.forEach(fn => {
            try {
                fn(payload);
            } catch (e) {
                console.error(`[bus] 事件 ${event} 处理失败:`, e);
            }
        });
    }
};

/* ---------------- 画布重绘标记 ----------------
 * 播放中每帧必绘；暂停时仅在标记置位后重绘，空闲不消耗 GPU。 */

let _redrawNeeded = true;

export function requestRedraw() {
    _redrawNeeded = true;
}

export function consumeRedraw() {
    const needed = _redrawNeeded;
    _redrawNeeded = false;
    return needed;
}

/* ---------------- 事件名常量 ---------------- */

export const EV = {
    /** 场景数据变更（航路点/航线/飞机增删改）→ 面板重建 + 持久化 */
    SCENE_CHANGED: 'scene:changed',
    /** 选中项变更 → 模式指示 + 进程单高亮 */
    SELECTION_CHANGED: 'selection:changed',
    /** 播放/暂停切换 → 按钮文字、编辑态禁用、指示器 */
    PLAYBACK_CHANGED: 'playback:changed',
    /** 飞机到达目标航路点（askNextWaypoint 已勾选）→ 弹出下一航路点选择框 */
    WAYPOINT_ARRIVED: 'waypoint:arrived',
    /** 新增陆空通话 → 通讯面板追加 */
    COMM_ADDED: 'comm:added',
    /** 管制席位状态变更（移交/许可/落地/席位过滤/自动开关）→ 席位面板 + 进程单刷新 */
    UNIT_CHANGED: 'unit:changed'
};