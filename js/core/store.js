/**
 * core/store.js — 全局状态与动作（内核层）
 * 单一数据源 state + 少量动作函数。所有结构性变更通过动作发出事件，
 * UI 层在 ui/subscriptions.js 统一订阅刷新，替代散落各处的手动 updateXxxList() 调用。
 * 不依赖任何业务层与 DOM（除事件总线外），是依赖图的根。
 */

import { bus, EV, requestRedraw } from './eventBus.js';

/** 全局场景状态（单一数据源） */
export const state = {
    /* 场景数据（持久化） */
    routePoints: [],
    routes: [],
    aircraft: [],

    /* 模拟控制 */
    time: 0,
    timeSpeed: 1,
    isPlaying: false,

    /* 选择与编辑 */
    selectedItem: null,
    editingPointId: null,
    editingRouteId: null,
    editingAircraftId: null,

    /* 陆空通话（运行期） */
    commMessages: [],

    /* 航线连接模式 */
    routeConnectPoints: [],
    routeConnectMode: false,

    /* 目标点选择（自由导航） */
    targetSelectMode: null,
    tempTargetPoint: null,

    /* 到达航路点询问流程 */
    pendingNextWaypointSelection: null,
    isPausedForWaypointSelection: false,

    /* 标签拖拽 */
    draggingLabelAc: null,

    /* 天气层 */
    weatherEnabled: false,
    storm: null,

    /* 管制席位（塔台 / 进近 / 区调） */
    focusAirport: 'ZUUU',   // 场景焦点机场：管制区渲染与航班生成的参照
    autoHandoff: true,      // 跨界自动移交：关闭后需手动下发「移交」指令
    autoClearance: true,    // 自动许可：离港放行 / 进近许可 / 落地许可
    seatFilter: null,       // 进程单席位过滤：null = 显示全部

    /* Endless ATC 位置文件（domain/locations.js 导入，几何已换算为世界坐标） */
    location: null,

    /* 计数器（持久化） */
    pointNameCounter: 1
};

state.defaults = {
    altitude: 10600, speed: 480, acType: 'B738', squawk: '2000',
    gridSpacing: 50, minSeparationNm: 15, timeMax: 2400,
    /** 可指令高度下限/上限（m）：导入位置文件后按 floor / above 改写 */
    altMinM: 3000, altMaxM: 15000
};

export function isEditMode() { return !state.isPlaying; }

/* ---------------- 动作（Action） ---------------- */

/**
 * 设置选中项并通知 UI。
 * @param {{type:string,id:number}|null} item
 */
export function select(item) {
    state.selectedItem = item;
    bus.emit(EV.SELECTION_CHANGED);
    requestRedraw();
}

/**
 * 场景数据发生结构性变更（增删改航路点/航线/飞机/默认参数）。
 * 订阅方负责：重建面板列表、刷新通讯目标、重建进程单、持久化、请求重绘。
 */
export function commitScene() {
    bus.emit(EV.SCENE_CHANGED);
    requestRedraw();
}

/** 退出航线连接模式并通知（模式指示依赖此状态） */
export function cancelRouteConnect() {
    if (!state.routeConnectMode && state.routeConnectPoints.length === 0) return;
    state.routeConnectMode = false;
    state.routeConnectPoints = [];
    bus.emit(EV.SELECTION_CHANGED);
}

/** 进入/退出航线连接模式（选择序列清空） */
export function setRouteConnectMode(active) {
    state.routeConnectMode = active;
    state.routeConnectPoints = [];
    bus.emit(EV.SELECTION_CHANGED);
    requestRedraw();
}

/** 连接模式下将某航路点加入选择序列（重复点击忽略） */
export function addRouteConnectPoint(ptId) {
    if (state.routeConnectPoints.includes(ptId)) return;
    state.routeConnectPoints.push(ptId);
    bus.emit(EV.SELECTION_CHANGED);
    requestRedraw();
}

/** 结束目标点选择模式（画布点击定点或 Esc 取消后调用） */
export function clearTargetSelectMode() {
    if (!state.targetSelectMode && !state.tempTargetPoint) return;
    state.targetSelectMode = null;
    state.tempTargetPoint = null;
    bus.emit(EV.SELECTION_CHANGED);
}

/* ---------------- 播放控制 ---------------- */

/**
 * 播放/暂停切换。UI 副作用（按钮文字、编辑态、指示器、暂停关对话框）
 * 由 ui/subscriptions.js 中的 playback:changed 订阅统一处理。
 */
export function togglePlay() {
    state.isPlaying = !state.isPlaying;
    bus.emit(EV.PLAYBACK_CHANGED, { isPlaying: state.isPlaying });
    requestRedraw();
}

export function setPlaying(isPlaying) {
    if (state.isPlaying === isPlaying) return;
    state.isPlaying = isPlaying;
    bus.emit(EV.PLAYBACK_CHANGED, { isPlaying });
    requestRedraw();
}

/* ---------------- 陆空通话 ---------------- */

/**
 * 记录一条陆空通话并广播 COMM_ADDED，由通讯面板订阅后追加 DOM。
 * 指令层可安全调用，不再直接触碰 DOM。
 * @param {string} sender 'atc' | 'pilot' | 航班号
 * @param {string} text
 */
export function addComm(sender, text) {
    const now = new Date(0);
    now.setSeconds(state.time);
    const msg = { sender, text, time: now.toTimeString().slice(0, 8) };
    state.commMessages.push(msg);
    bus.emit(EV.COMM_ADDED, msg);
}

/* ---------------- 管制席位（塔台 / 进近 / 区调） ---------------- */

/** 场景焦点机场变更（管制区渲染与航班生成的参照机场） */
export function setFocusAirport(code) {
    if (!code || code === state.focusAirport) return;
    state.focusAirport = code;
    bus.emit(EV.UNIT_CHANGED, { focusAirport: code });
    requestRedraw();
}

/** 自动移交开关（关闭后由管制员手动下发「移交塔台/进近/区调」） */
export function setAutoHandoff(on) {
    state.autoHandoff = !!on;
    bus.emit(EV.UNIT_CHANGED, { autoHandoff: state.autoHandoff });
}

/** 自动许可开关（离港放行 / 进近许可 / 落地许可；关闭后全部手动下发） */
export function setAutoClearance(on) {
    state.autoClearance = !!on;
    bus.emit(EV.UNIT_CHANGED, { autoClearance: state.autoClearance });
}

/**
 * 席位过滤（点击席位面板选中/取消）：进程单只显示该席位管辖的航空器。
 * @param {string|null} code 'TWR' | 'APP' | 'ACC'；重复点击同一席位 = 取消过滤
 */
export function setSeatFilter(code) {
    state.seatFilter = state.seatFilter === code ? null : (code || null);
    bus.emit(EV.UNIT_CHANGED, { seatFilter: state.seatFilter });
    requestRedraw();
}