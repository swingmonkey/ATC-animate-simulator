/**
 * main.js — 应用入口（唯一装配点）
 * 职责：装配各层（领域层逐帧推进注入仿真循环、订阅注册、表单绑定）→ 恢复存档 → 时钟驱动的动画循环。
 *
 * 依赖方向见 docs/PLAN-v2.md §3.1：本文件是唯一允许跨层 import 的“装配点”。
 * 时间推进统一走 core/clock.js（固定步长）；键盘平移并入本循环。
 */

import { state } from './core/store.js';
import { bus, EV, consumeRedraw } from './core/eventBus.js';
import { resizeCanvas } from './core/viewport.js';
import { tickClock, resetClockAccumulator, clockStats } from './core/clock.js';
import { loadState } from './core/persistence.js';
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
import { scoringSummary, scoreTimeline, runwayPlan, gradeFor, GRADES } from './game/scoring.js';
import { scenarioSummary, scenarioFromLocation, defaultScenario, buildTimeline } from './game/scenario.js';
import { evaluateObjectives, defaultObjectives, OBJECTIVE_KINDS } from './game/objectives.js';
import { scenarioList, getBuiltinScenario } from './data/scenarios.js';
import { phrasesForUnit, fillPhrase } from './data/phraseology.js';
import {
    isReadbackPending, readbackTextOf, readbackErrorRate, READBACK_GRACE_SEC, seedReadback
} from './domain/readback.js';
import { parseLocationFile } from './domain/locationFile.js';
import { locationToScene, importLocationText } from './domain/locations.js';
import { sampleLocationText } from './data/locationSamples.js';
import { getAirport } from './data/airports.js';
import { drawRadar } from './render/index.js';
import { initSubscriptions, refreshAll } from './ui/subscriptions.js';
import { initFormBindings } from './ui/formBindings.js';
import { initSessionPanel, initConsolePanel, updateConsole, updateTimeDisplay, updateProgressList, addComm } from './ui/index.js';
import { hudModel } from './render/hud.js';
import { tickKeyboard } from './interaction/index.js';

let _lastTime = performance.now();
const stats = { frames: 0 };

function animate(currentTime) {
    stats.frames++;
    const frameDt = Math.min(0.1, (currentTime - _lastTime) / 1000);
    _lastTime = currentTime;

    if (state.isPlaying) {
        const { stepped, dt } = tickClock(frameDt);
        if (stepped) {
            updateAircraftPositionsForTime(state.time);
            updateTrails(dt);
            // 两者内部均按 100ms / 250ms 节流，60× 倍速下不再每秒重建数千次 DOM
            updateTimeDisplay();
            updateProgressList();
            updateConsole();
        }
    }

    tickKeyboard(frameDt);

    if (state.isPlaying || consumeRedraw()) drawRadar();
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
initConsolePanel();                // 指令台模板按钮 / 要求复诵（事件委托，只需绑一次）

if (loadState()) {
    normalizeScene();                 // 领域字段补齐（旧存档 ac.phase → ac.flow）
    bus.emit(EV.SCENE_CHANGED);       // 重建面板 + 落盘（幂等）
}
refreshAll();

addComm('atc', '空管雷达模拟器已启动（领域层分层版 v2 · P1 班次/评分）');
addComm('atc', '滚轮缩放地图 | ASWD或方向键移动 | 点击播放开始模拟');
addComm('atc', '场景数据自动保存在浏览器本地（localStorage）');
addComm('atc', '右侧「🎯 班次与评分」→ 开始班次：导演注入无限流量并按目标结算评级（班次内不可回溯时间轴）');

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
        seed: seedReadback
    },

    console: { update: updateConsole },
    airports: { get: getAirport },
    session: currentSession,
    recordInput,
    clock: clockStats
};

requestAnimationFrame(animate);
