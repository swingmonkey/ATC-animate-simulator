/**
 * main.js — 应用入口（唯一装配点）
 * 职责：装配各层（领域层逐帧推进注入仿真循环、订阅注册、表单绑定）→ 恢复存档 → 时钟驱动的动画循环。
 *
 * 依赖方向见 docs/PLAN-v2.md §3.1：本文件是唯一允许跨层 import 的“装配点”。
 * 时间推进统一走 core/clock.js（固定步长）；键盘平移并入本循环。
 */

import { state } from './core/store.js';
import { radarAvailable } from './core/controlPolicy.js';
import { bus, EV, consumeRedraw } from './core/eventBus.js';
import { resizeCanvas } from './core/viewport.js';
import { tickClock, resetClockAccumulator, clockStats } from './core/clock.js';
import { loadState, migrateState, SCHEMA_VERSION } from './core/persistence.js';
import { updateAircraftPositionsForTime, updateTrails } from './simulation/index.js';
import { normalizeScene } from './domain/aircraft.js';
import { resolveUnitForDistance } from './domain/airspace.js';
import { PHASE, derivePhase, syncPhase, canIssue, issueHint } from './domain/phases.js';
import { predictMinSeparation, predictedConflicts } from './domain/separation.js';
import { mvaLimitAt, mvaViolationFor } from './domain/airspace.js';
import {
    initSessionWiring, currentSession, recordInput,
    startGameSession, endGameSession, isSessionActive, currentDirector, sessionResult
} from './game/session.js';
import {
    startManagement, resetManagement, managementSummary, hireStaff, appointSupervisor,
    trainStaff, buildRoom, upgradeTech, assignSeat, signContract, requestTrialRun, endDay
} from './game/management.js';
import { scoringSummary, scoreTimeline, runwayPlan, gradeFor, GRADES, SCORE_WEIGHTS } from './game/scoring.js';
import { scenarioSummary, scenarioFromLocation, defaultScenario, buildTimeline, difficultyCurveFor, DIFFICULTY } from './game/scenario.js';
import { triggerEmergency, eventsSummary, eventCatalog, resolveEvents } from './game/events.js';
import { evaluateObjectives, defaultObjectives, OBJECTIVE_KINDS } from './game/objectives.js';
import { scenarioList, getBuiltinScenario } from './data/scenarios.js';
import { phrasesForUnit, fillPhrase } from './data/phraseology.js';
import {
    isReadbackPending, readbackTextOf, readbackErrorRate, READBACK_GRACE_SEC, seedReadback,
    CRITICAL_RUNWAY, CRITICAL_ALT, CRITICAL_ROUTE, READBACK_GROUP_WEIGHTS, criticalGroupOf, actionTextOf, pickMissedItem
} from './domain/readback.js';
import { parseLocationFile } from './domain/locationFile.js';
import {
    planSeats, THRESHOLD_GND, THRESHOLD_CD, THRESHOLD_APP, THRESHOLD_APP_SPLIT
} from './domain/seats.js';
import { prepChecklist, canReportUnfit } from './domain/roster.js';
import { ROSTER } from './data/roster.js';
import { HANDOVER_CHECKLIST, FAMILIARIZE_SEC } from './data/handoverChecklist.js';
import { LOG_FIELDS } from './data/logFields.js';
import { locationToScene, importLocationText } from './domain/locations.js';
import { sampleLocationText } from './data/locationSamples.js';
import { getAirport } from './data/airports.js';
import { drawRadar } from './render/index.js';
import { initSubscriptions, refreshAll } from './ui/subscriptions.js';
import { initFormBindings } from './ui/formBindings.js';
import { initSessionPanel, initRosterPanel, initManagementPanel, initConsolePanel, updateConsole, updateTimeDisplay, updateProgressList, addComm } from './ui/index.js';
import { hudModel } from './render/hud.js';
import { initTutorialPanel } from './ui/tutorialPanel.js';
import { initQuickControl, updateQuickControl } from './ui/quickControl.js';
import { initRadarModes, updateRadarModes } from './ui/radarModes.js';
import { initPlatformView, showPlatformView } from './ui/platformView.js';
import { initWorkplaceScene } from './ui/workplaceScene.js';
import { focusRadarView } from './render/views.js';
import { tickKeyboard } from './interaction/index.js';
import {
    initAvatar, reconcileAvatar, tickAvatar, visitWorkspace, cycleWorkspace, walkToSeat,
    fastTravelToSeat, sitAvatar, leaveAvatarSeat
} from './game/avatar.js';

let _lastTime = performance.now();
const stats = { frames: 0 };

function animate(currentTime) {
    stats.frames++;
    const frameDt = Math.min(0.1, (currentTime - _lastTime) / 1000);
    _lastTime = currentTime;

    if (state.isPlaying) {
        const { stepped, dt } = tickClock(frameDt);
        if (stepped) {
            updateAircraftPositionsForTime(state.time, false);
            updateTrails(dt);
            // 两者内部均按 100ms / 250ms 节流，60× 倍速下不再每秒重建数千次 DOM
            updateTimeDisplay();
            updateProgressList();
            updateConsole();
            updateQuickControl();
            updateRadarModes();
        }
    }

    tickKeyboard(frameDt);
    if (document.body.dataset.platformView === 'scene') tickAvatar(frameDt);

    if (document.body.dataset.platformView === 'radar' && (state.isPlaying || consumeRedraw())) drawRadar();
    requestAnimationFrame(animate);
}

/* ---------------- 启动引导 ---------------- */

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

initSessionWiring();                  // 领域层推进注入仿真循环 + 时钟采样 + 班次（P0：启动即值班）
bus.on(EV.PLAYBACK_CHANGED, resetClockAccumulator);   // 暂停/恢复不补帧
initSubscriptions();
initFormBindings();
initSessionPanel();                // 班次面板按钮绑定（开始班次 / 结束并结算）
initTutorialPanel();               // L1 教学卡片的复诵核对按钮
initConsolePanel();                // 指令台模板按钮 / 要求复诵（事件委托，只需绑一次）
initQuickControl();
initRadarModes();
initRosterPanel();                 // 值班面板：申请不参加本次执勤（§128 权利，绑定一次）
initManagementPanel();             // 经营面板：招聘 / 建设 / 升级 / 合同 / 局方审批（事件委托，绑定一次）
initWorkplaceScene();
initPlatformView();                 // 网页经营首页 / 现场俯视 / 雷达值班
bus.on(EV.AVATAR_SEATED, ({ view }) => {
    if (radarAvailable()) {
        showPlatformView('radar');
        focusRadarView(view);
    }
});
bus.on(EV.AVATAR_LEFT, () => showPlatformView('scene'));
bus.on(EV.MANAGEMENT_CHANGED, reconcileAvatar);

if (loadState()) {
    normalizeScene();                 // 领域字段补齐（旧存档 ac.phase → ac.flow）
    bus.emit(EV.SCENE_CHANGED);       // 重建面板 + 落盘（幂等）
}
focusRadarView(state.activeView);
startManagement();                    // 经营层：恢复已有存档或按默认值初始化（normalize + 补全）
initAvatar();
refreshAll();

addComm('atc', '空管雷达模拟器已启动（领域层分层版 v2 · P1 班次/评分）');
addComm('atc', '滚轮缩放地图 | ASWD或方向键移动 | 点击播放开始模拟');
addComm('atc', '场景数据自动保存在浏览器本地（localStorage）');
addComm('atc', '右侧「🎯 班次与评分」→ 开始班次：导演注入无限流量并按目标结算评级（班次内不可回溯时间轴）');
addComm('atc', '顶部「经营指挥台」→ 招聘/建设/升级/签合同，点「结束今日并结算」推进日次（资金 / 声望 / 实验运行）');

/** 自动化冒烟测试与调试用只读句柄（装配点导出，业务层不得依赖） */
window.__ATC__ = {
    state, bus, EV, stats,
    seat: { resolveUnitForDistance },
    phase: { PHASE, derivePhase, syncPhase, canIssue, issueHint },
    sep: { predictMinSeparation, predictedConflicts },
    mva: { limitAt: mvaLimitAt, violationFor: mvaViolationFor },
    location: {
        parse: parseLocationFile,
        toScene: locationToScene,
        import: importLocationText,
        sample: sampleLocationText
    },
    game: {
        start: startGameSession,
        end: endGameSession,
        active: isSessionActive,
        director: currentDirector,
        scoring: scoringSummary,
        timeline: scoreTimeline,
        objectives: evaluateObjectives,
        defaultObjectives,
        objectiveKinds: OBJECTIVE_KINDS,
        runwayPlan,
        gradeFor,
        grades: GRADES,
        weights: SCORE_WEIGHTS,
        hud: hudModel,
        result: sessionResult,
        scenario: { summary: scenarioSummary, fromLocation: scenarioFromLocation, create: defaultScenario, buildTimeline }
    },
    scenarios: { list: scenarioList, get: getBuiltinScenario },
    phrases: { forUnit: phrasesForUnit, fill: fillPhrase },
    readback: {
        pending: isReadbackPending,
        text: readbackTextOf,
        rate: readbackErrorRate,
        graceSec: READBACK_GRACE_SEC,
        seed: seedReadback,
        // CCAR-93TM-R6 §118：分级必背清单 + 加权错诵抽取（第一批）
        critical: { runway: CRITICAL_RUNWAY, alt: CRITICAL_ALT, route: CRITICAL_ROUTE },
        weights: READBACK_GROUP_WEIGHTS,
        groupOf: criticalGroupOf,
        action: actionTextOf,
        pickMissed: pickMissedItem
    },
    console: { update: updateConsole },
    seats: {
        plan: planSeats,
        thresholds: { GND: THRESHOLD_GND, CD: THRESHOLD_CD, APP: THRESHOLD_APP, APP_SPLIT: THRESHOLD_APP_SPLIT }
    },
    roster: {
        prep: prepChecklist,
        unfit: canReportUnfit,
        constants: ROSTER,
        handover: HANDOVER_CHECKLIST,
        familiarizeSec: FAMILIARIZE_SEC
    },
    logs: { fields: LOG_FIELDS },
    management: {
        start: startManagement,
        reset: resetManagement,
        summary: managementSummary,
        hire: hireStaff,
        appoint: appointSupervisor,
        train: trainStaff,
        build: buildRoom,
        upgrade: upgradeTech,
        assign: assignSeat,
        sign: signContract,
        trial: requestTrialRun,
        endDay
    },
    avatar: {
        snapshot: () => state.avatar && { ...state.avatar },
        visit: visitWorkspace, cycle: cycleWorkspace, walk: walkToSeat,
        fast: fastTravelToSeat, sit: sitAvatar, leave: leaveAvatarSeat
    },
    /* M2 T11：把 M2 能力暴露给冒烟脚本（只读句柄，业务层不得依赖） */
    events: {
        trigger: triggerEmergency,
        summary: eventsSummary,
        catalog: eventCatalog,
        resolve: resolveEvents
    },
    migration: { migrateState, SCHEMA_VERSION },
    multiAirport: () => (managementSummary() || {}).multiAirport || null,
    difficulty: { curve: difficultyCurveFor, DIFFICULTY },
    airports: { get: getAirport },
    session: currentSession,
    recordInput,
    clock: clockStats
};

requestAnimationFrame(animate);
