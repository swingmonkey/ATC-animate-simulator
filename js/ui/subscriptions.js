/**
 * ui/subscriptions.js — 事件订阅中枢（界面层）
 * 全应用唯一的「状态变更 → UI 刷新」接线处，替代散落在 toolbar/palette/factory/
 * canvasInput 中的 updateXxxList() 人肉调用链。
 *
 * 事件流：interaction/commands → store 动作（或直接 mutate + commitScene）
 *        → eventBus → 本文件 → 各 UI 刷新函数。
 */

import { bus, EV } from '../core/eventBus.js';
import { state } from '../core/store.js';
import { saveState } from '../core/persistence.js';
import {
    updatePointPanelList, updateRoutePanelList, updateAircraftPanelList
} from './panels.js';
import {
    updateModeIndicator, updateEditModeUI, updatePlayButton,
    updateTimeDisplay, updateProgressList, updateCommTargetSelect
} from './indicators.js';
import { appendCommMessage } from './commPanel.js';
import { updateConsole } from './console.js';
import { updateSeatPanel } from './seatPanel.js';
import { updateSessionPanel } from './sessionPanel.js';
import { updateRosterPanel } from './rosterPanel.js';
import { updateManagementPanel } from './managementPanel.js';
import { showNextWaypointDialog } from './dialogs.js';

/**
 * 注册全部事件订阅。main.js 启动时调用一次（须在首次 commitScene 之前）。
 */
export function initSubscriptions() {
    /* 场景结构变更：重建四个面板 + 进程单 + 持久化 */
    bus.on(EV.SCENE_CHANGED, () => {
        updatePointPanelList();
        updateRoutePanelList();
        updateAircraftPanelList();
        updateCommTargetSelect();
        updateProgressList(true);
        saveState();
    });

    /* 选中变更：模式指示 + 进程单高亮 + 指令台（按选中机重建推荐用语） */
    bus.on(EV.SELECTION_CHANGED, () => {
        updateModeIndicator();
        updateProgressList(true);
        updateConsole(true);
    });

    /* 播放/暂停：按钮文字 + 编辑态禁用 + 指示器；暂停时关闭全部对话框 */
    bus.on(EV.PLAYBACK_CHANGED, () => {
        updatePlayButton();
        updateEditModeUI();
        updateModeIndicator();
        updateProgressList(true);
        if (!state.isPlaying) {
            document.querySelectorAll('.dialog:not(.hidden)').forEach(d => d.classList.add('hidden'));
        }
    });

    /* 通话消息追加（指令台的读数/复诵也随之刷新，节流） */
    bus.on(EV.COMM_ADDED, appendCommMessage);
    bus.on(EV.COMM_ADDED, () => updateConsole());

    /* 管制席位变更（移交/许可/落地/复诵/席位过滤/自动开关）：席位面板 + 进程单 + 指令台 */
    bus.on(EV.UNIT_CHANGED, () => {
        updateSeatPanel();
        updateProgressList(true);
        updateConsole(true);
    });

    /* 飞行阶段变化：指令台的合法指令集合随之变化（灰显项刷新） */
    bus.on(EV.PHASE_CHANGED, () => updateConsole(true));

    /* 到达目标航路点：暂停播放并弹出下一航路点选择框 */
    bus.on(EV.WAYPOINT_ARRIVED, ({ ac, idx }) => showNextWaypointDialog(ac, idx));

    /* 班次玩法：班次开始/结束/分数变化 → 班次面板（HUD 由 render/index.js 每帧绘制） */
    bus.on(EV.SESSION_STARTED, () => {
        updateSessionPanel();
        updateSeatPanel();
        updateRosterPanel();
        updateProgressList(true);
    });
    bus.on(EV.SESSION_ENDED, () => {
        updateSessionPanel();
        updateManagementPanel();
        updateRosterPanel();
        updateProgressList(true);
    });
    bus.on(EV.SCORE_CHANGED, () => updateSessionPanel());

    /* CCAR-93TM-R6 对齐 R1：席位解算 / 值班 / 交接 / 适勤事件 → 值班面板（含席位面板联动） */
    const refreshRoster = () => {
        updateRosterPanel();
        updateSeatPanel();
    };
    [EV.SEATS_PLANNED, EV.SEAT_MERGED, EV.SEAT_SPLIT,
        EV.DUTY_STARTED, EV.DUTY_ENDED, EV.DUTY_OVERFLOW,
        EV.DUTY_PREP_STARTED, EV.DUTY_PREP_DONE,
        EV.POSITION_ENTERED, EV.POSITION_LEFT, EV.REST_ENTERED, EV.REST_LEFT,
        EV.DUTY_POSITION_ENTERED, EV.DUTY_POSITION_LEFT,
        EV.RADAR_ROTATION_DUE, EV.FATIGUE_THRESHOLD,
        EV.NOT_FIT_FOR_DUTY, EV.DUTY_UNFIT_REPORTED,
        EV.HANDOVER_FAMILIARIZE, EV.COWORKER_REMINDER,
        EV.LOG_APPENDED, EV.LOG_ROLLED, EV.ARCHIVE_PACKED
    ].forEach(evt => bus.on(evt, refreshRoster));

    /* v1.7 经营层：资金 / 人员 / 房间 / 合同 / 局方审批 → 经营面板 */
    [EV.MANAGEMENT_CHANGED, EV.STAFF_CHANGED, EV.ROOM_CHANGED,
        EV.CONTRACT_CHANGED, EV.TRIAL_CHANGED, EV.DAY_SETTLED
    ].forEach(evt => bus.on(evt, updateManagementPanel));
}

/**
 * 启动时的首次全量刷新（恢复持久化场景或空场景均可安全调用）。
 */
export function refreshAll() {
    updatePointPanelList();
    updateRoutePanelList();
    updateAircraftPanelList();
    updateCommTargetSelect();
    updateProgressList(true);
    updateSeatPanel();
    updateSessionPanel();
    updateRosterPanel();
    updateConsole(true);
    updateModeIndicator();
    updatePlayButton();
    updateEditModeUI();
    updateTimeDisplay(true);
    updateManagementPanel();
}