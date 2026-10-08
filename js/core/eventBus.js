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
    UNIT_CHANGED: 'unit:changed',
    /** 时钟步进（固定步长） → 采样器 / HUD */
    CLOCK_TICK: 'clock:tick',
    /** 飞行阶段变化 → 进程单 / 标签 / 目标判定 */
    PHASE_CHANGED: 'phase:changed',
    /** 班次开始（关卡装载 + 导演启动）→ HUD / 班次面板 */
    SESSION_STARTED: 'session:started',
    /** 班次结束（含结算结果：评级/目标/时间轴）→ 结果页 / 存档 */
    SESSION_ENDED: 'session:ended',
    /** 评分变化（安全/效率事件、跑道解锁）→ HUD / 班次面板 */
    SCORE_CHANGED: 'score:changed',
    /** 导演事件（[scenario] 时间轴事件、流量注入、字幕）→ HUD / 通话面板 */
    DIRECTOR_EVENT: 'director:event',
    /** 席位视图切换（ACC/APP/TWR 三张地图）→ 席位面板 / HUD / 进程单 / 重绘 */
    VIEW_CHANGED: 'view:changed',

    /* ---- CCAR-93TM-R6 对齐 R1：席位 / 值班 / 日志 / 归档事件 ---- */
    /** 席位设置解算完成（按门槛开合/合并席位）→ 席位面板 / 值班面板 */
    SEATS_PLANNED: 'seats:planned',
    /** 席位合并（某席由他席兼任）→ 席位面板文案 */
    SEAT_MERGED: 'seat:merged',
    /** 席位拆分（APP → APP-ARR/APP-DEP）→ 席位面板文案 */
    SEAT_SPLIT: 'seat:split',
    /** 值班开始（进入岗位前）→ 值班面板 */
    DUTY_STARTED: 'duty:started',
    /** 值班结束 → 值班面板 */
    DUTY_ENDED: 'duty:ended',
    /** 值班超时溢出 → 值班面板提示 */
    DUTY_OVERFLOW: 'duty:overflow',
    /** 岗前准备开始（五项逐项确认）→ 值班面板 */
    DUTY_PREP_STARTED: 'duty:prep_started',
    /** 岗前准备完成 → 值班面板 + 日志字段 */
    DUTY_PREP_DONE: 'duty:prep_done',
    /** 进入管制岗位 → 值班面板 + 日志 */
    POSITION_ENTERED: 'position:entered',
    /** 离开管制岗位 → 值班面板 + 日志 */
    POSITION_LEFT: 'position:left',
    /** 进入休息 → 值班面板 */
    REST_ENTERED: 'rest:entered',
    /** 休息结束 → 值班面板 */
    REST_LEFT: 'rest:left',
    /** 岗位就坐（别名，供日志聚合） */
    DUTY_POSITION_ENTERED: 'duty:position_entered',
    /** 离席（别名，供日志聚合） */
    DUTY_POSITION_LEFT: 'duty:position_left',
    /** 雷达岗位轮换提醒（连续岗位超时）→ 值班面板 */
    RADAR_ROTATION_DUE: 'radar:rotation_due',
    /** 疲劳达阈值 → 值班面板提示 */
    FATIGUE_THRESHOLD: 'fatigue:threshold',
    /** 报告不适合执勤（§128 权利）→ 值班面板 / 评分 */
    NOT_FIT_FOR_DUTY: 'not_fit_for_duty',
    /** 不适合执勤（别名，供日志/评分聚合） */
    DUTY_UNFIT_REPORTED: 'duty:unfit_reported',
    /** 交接班熟悉期开始（§60 熟悉期）→ 值班面板 */
    HANDOVER_FAMILIARIZE: 'handover:familiarize',
    /** 同事提醒（席位/交接事项）→ 值班面板 */
    COWORKER_REMINDER: 'coworker:reminder',
    /** 管制工作日志追加一条 → 复盘 / 归档 */
    LOG_APPENDED: 'log:appended',
    /** 日志滚动归档 → 复盘 / 归档 */
    LOG_ROLLED: 'log:rolled',
    /** 归档打包完成 → 复盘 / 归档 */
    ARCHIVE_PACKED: 'archive:packed',

    /* ---- v1.7 经营层：资金 / 人员 / 房间 / 合同 / 局方审批 ---- */
    /** 经营状态整体变更（初始化 / 重开 / 升级 / 日结算）→ 经营面板 + HUD */
    MANAGEMENT_CHANGED: 'management:changed',
    /** 人事变更（招聘 / 任命 / 培训 / 排席）→ 经营面板 */
    STAFF_CHANGED: 'management:staff_changed',
    /** 设施变更（建设房间）→ 经营面板 */
    ROOM_CHANGED: 'management:room_changed',
    /** 合同变更（承接航班包）→ 经营面板 */
    CONTRACT_CHANGED: 'management:contract_changed',
    /** 局方审批状态变更（递交 / 批复 / 到期）→ 经营面板 */
    TRIAL_CHANGED: 'management:trial_changed',
    /** 结束今日经营（日结算完成）→ 经营面板 + 复盘 */
    DAY_SETTLED: 'management:day_settled',

    /* ---- v1.8 M2：随机特情 / 多扇区 ---- */
    /** 触发随机特情（现场）→ HUD / 复盘 / 日志 */
    EMERGENCY_RAISED: 'emergency:raised',
    /** 特情消解 → HUD / 复盘 */
    EMERGENCY_RESOLVED: 'emergency:resolved',
    /** 飞行员请求（特情通播）→ 通话面板 */
    PILOT_REQUEST: 'pilot:request',
    /** 复飞指令 → 进程单 / 通话 */
    GO_AROUND: 'goaround',
    /** 扇区开启（多扇区拆分）→ 席位面板 / 值班面板 */
    SEAT_OPENED: 'seat:opened',
    /** 扇区关闭（扇区合并）→ 席位面板 / 值班面板 */
    SEAT_CLOSED: 'seat:closed'
};