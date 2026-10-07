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
import { updateSeatPanel } from './seatPanel.js';
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

    /* 选中变更：模式指示 + 进程单高亮 */
    bus.on(EV.SELECTION_CHANGED, () => {
        updateModeIndicator();
        updateProgressList(true);
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

    /* 通话消息追加 */
    bus.on(EV.COMM_ADDED, appendCommMessage);

    /* 管制席位变更（移交/许可/落地/席位过滤/自动开关）：席位面板 + 进程单 */
    bus.on(EV.UNIT_CHANGED, () => {
        updateSeatPanel();
        updateProgressList(true);
    });

    /* 到达目标航路点：暂停播放并弹出下一航路点选择框 */
    bus.on(EV.WAYPOINT_ARRIVED, ({ ac, idx }) => showNextWaypointDialog(ac, idx));
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
    updateModeIndicator();
    updatePlayButton();
    updateEditModeUI();
    updateTimeDisplay(true);
}