/**
 * desktop/main.js — Electron 主进程（桌面壳）
 *
 * 设计要点：
 * - 使用自定义标准协议 app:// 提供静态资源。若直接 loadFile(file://)，
 *   Chromium 会因 CORS 拒绝加载 <script type="module">；而用本地 HTTP 端口
 *   则会让 localStorage 的来源随端口变化，导致存档丢失。app:// 同时解决两者。
 * - --smoke 模式：无窗口启动、脚本化驱动关键交互、收集控制台错误、
 *   输出 JSON 结果并以退出码表示成功/失败（供 CI 与打包后验证使用）。
 */

import { app, BrowserWindow, protocol, session } from 'electron';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const SMOKE = process.argv.includes('--smoke');
/** 应用图标（窗口/任务栏用；打包时由 electron-builder 写入 exe） */
const ICON_PATH = path.join(APP_ROOT, 'build', 'icon.ico');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

/** app://bundle/<path> → 应用根目录静态文件 */
function serveApp(request) {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
        return new Response('Bad Request', { status: 400 });
    }
    if (!pathname || pathname === '/') pathname = '/index.html';
    const target = path.join(APP_ROOT, ...pathname.split('/').filter(Boolean));
    if (!target.startsWith(APP_ROOT) || !existsSync(target) || statSync(target).isDirectory()) {
        return new Response('Not Found', { status: 404 });
    }
    const size = statSync(target).size;
    return new Response(Readable.toWeb(createReadStream(target)), {
        headers: {
            'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
            'Content-Length': String(size)
        }
    });
}

function createWindow({ show = true, headless = false } = {}) {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 680,
        show,
        backgroundColor: '#f1f5f9',
        title: '空管雷达动画模拟器',
        icon: existsSync(ICON_PATH) ? ICON_PATH : undefined,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // 冒烟测试以离屏模式运行：隐藏窗口不会触发 rAF，离屏渲染可保持动画循环运转
            offscreen: headless,
            backgroundThrottling: !headless,
            // 冒烟测试使用独立内存分区：每次运行存档从零开始，且不污染用户数据
            partition: headless ? 'atc-smoke' : undefined
        }
    });
    win.loadURL('app://bundle/index.html');
    return win;
}


/* ---------------- 冒烟测试（--smoke） ---------------- */

const consoleErrors = [];
const pageFailures = [];

function attachDiagnostics(win) {
    win.webContents.on('console-message', (...args) => {
        const details = args[1];
        if (details && typeof details === 'object') {
            if (details.level === 'error' || details.level === 3) consoleErrors.push(String(details.message));
        } else if (typeof args[1] === 'number' && args[1] >= 3) {
            consoleErrors.push(String(args[2]));
        }
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
        pageFailures.push(`did-fail-load ${code} ${desc} ${url}`);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
        pageFailures.push(`render-process-gone ${details?.reason}`);
    });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/** 阶段一：启动自检 + 生成场景 + 开始播放 */
const SCRIPT_BOOT = `(() => {
    const A = window.__ATC__;
    const st = A && A.state;
    const c = document.getElementById('radar-canvas');
    const out = {
        bootOk: !!A,
        canvasSized: !!c && c.width > 0 && c.height > 0,
        bootCommMessages: document.querySelectorAll('#comm-messages .comm-msg').length
    };
    document.getElementById('generate-scenario-btn').click();
    st.aircraft.forEach(ac => { ac.startTime = 0; });
    out.aircraft = st.aircraft.length;
    out.routes = st.routes.length;
    out.pointItems = document.querySelectorAll('#route-points-list .panel-item').length;
    out.routeItems = document.querySelectorAll('#route-list .panel-item').length;
    out.aircraftItems = document.querySelectorAll('#aircraft-list .panel-item').length;
    out.seatRows = document.querySelectorAll('#seat-list .seat-row').length;
    out.seatCounts = document.querySelectorAll('#seat-list .seat-row .seat-count').length;
    out.autoHandoffDefault = st.autoHandoff === true;
    out.autoClearanceDefault = st.autoClearance === true;
    out.phasesAssigned = st.aircraft.filter(ac => !!ac.phase && !!ac.flow && !!ac.wake).length;
    out.clearanceArrays = st.aircraft.every(ac => Array.isArray(ac.clearances));
    const speed = document.getElementById('speed-select');
    speed.value = '5';
    speed.dispatchEvent(new Event('change'));
    document.getElementById('play-pause-btn').click();
    out.playing = st.isPlaying;
    return out;
})()`;


/** 阶段二：播放推进、暂停、指令、天气、对话框、增删 */
const SCRIPT_INTERACT = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    const out = {
        timeAfterPlay: Math.round(st.time),
        frames: A.stats ? A.stats.frames : -1,
        progressItems: document.querySelectorAll('#progress-list .progress-item').length,
        overlayItems: document.querySelectorAll('#progress-list-overlay .progress-item').length,
        moved: st.aircraft.some(ac => Math.abs((ac.displayX ?? ac.x) - ac.x) > 1 || Math.abs((ac.displayY ?? ac.y) - ac.y) > 1),
        saved: localStorage.getItem('atc_simulator_state_v2') !== null
    };
    document.getElementById('play-pause-btn').click();
    out.paused = !st.isPlaying;

    const input = document.getElementById('comm-input');
    input.value = '下降 3000';
    document.getElementById('comm-send-btn').click();
    out.altConApplied = st.aircraft.some(ac => ac.altCon === 3000);
    out.commAfterCmd = document.querySelectorAll('#comm-messages .comm-msg').length;

    /* ---- 塔台 / 进近 / 区调：许可、移交、席位过滤 ---- */
    const target = st.aircraft[0];
    input.value = target.flightNo + ' ILS 进近 跑道 02L';
    document.getElementById('comm-send-btn').click();
    out.approachApplied = target.approachType === 'ILS' && target.runway === '02L';
    input.value = target.flightNo + ' 可以落地';
    document.getElementById('comm-send-btn').click();
    out.landingClearanceIssued = target.clearance === 'land';
    input.value = target.flightNo + ' 跑道 20R';
    document.getElementById('comm-send-btn').click();
    out.runwayCommandApplied = target.runway === '20R';

    const autoBox = document.getElementById('auto-handoff-toggle');
    autoBox.checked = false;
    autoBox.dispatchEvent(new Event('change'));
    out.autoHandoffOff = st.autoHandoff === false;
    input.value = target.flightNo + ' 移交塔台';
    document.getElementById('comm-send-btn').click();
    out.manualHandoff = target.unit === 'TWR';
    autoBox.checked = true;
    autoBox.dispatchEvent(new Event('change'));
    out.autoHandoffOn = st.autoHandoff === true;

    out.seatComms = document.querySelectorAll(
        '#comm-messages .comm-msg.twr, #comm-messages .comm-msg.app, #comm-messages .comm-msg.acc'
    ).length;
    out.unitsAssigned = st.aircraft.filter(ac => ac.unit).length;
    out.unitBoundaries = A.seat.resolveUnitForDistance(10, null) === 'TWR'
        && A.seat.resolveUnitForDistance(30, null) === 'APP'
        && A.seat.resolveUnitForDistance(200, null) === 'ACC'
        && A.seat.resolveUnitForDistance(18, 'TWR') === 'TWR'
        && A.seat.resolveUnitForDistance(18, 'APP') === 'APP';

    const beforeFilter = document.querySelectorAll('#progress-list .progress-item').length;
    document.querySelector('#seat-list .seat-row[data-unit="TWR"]').click();
    out.seatFilterOn = st.seatFilter === 'TWR';
    out.filteredItems = document.querySelectorAll('#progress-list .progress-item').length;
    out.filterWorks = out.filteredItems >= 1 && out.filteredItems <= beforeFilter;
    document.querySelector('#seat-list .seat-row[data-unit="TWR"]').click();
    out.seatFilterOff = st.seatFilter === null;

    /* ---- P0：领域层 API（阶段 FSM / 指令合法性 / 间隔预测 / 许可记录 / 班次 / 采样 / 时钟） ---- */
    const cruiseAc = st.aircraft.find(a => a.unit === 'ACC' && !a.clearance && !a.approachType);
    if (cruiseAc) {
        out.altAllowedInDescent = A.phase.canIssue(cruiseAc, 'ALT') === true;
        out.takeoffDeniedInDescent = A.phase.canIssue(cruiseAc, 'TAKEOFF') === false;
        out.landDeniedInDescent = A.phase.canIssue(cruiseAc, 'LAND') === false;
        out.issueHintText = A.phase.issueHint(cruiseAc, 'LAND');
    }
    const sep = A.sep.predictMinSeparation(st.aircraft[0], st.aircraft[1], 60, 30);
    out.sepPredictionFinite = Number.isFinite(sep.minKm) && sep.minKm > 0;
    out.predictedConflictsShape = Array.isArray(A.sep.predictedConflicts(60));
    out.clearanceRecords = st.aircraft.reduce((n, ac) => n + (ac.clearances ? ac.clearances.length : 0), 0);
    const s = A.session();
    out.sessionInputs = s ? s.inputs.length : -1;
    out.sessionRecordedText = s && s.inputs.length ? s.inputs[0].text : '';
    out.historySamples = st.aircraft.reduce((n, ac) => Math.max(n, ac.history ? ac.history.length : 0), 0);
    out.clockSteps = A.clock.steps;

    /* ---- Endless ATC 位置文件兼容：解析 → 换算 → 应用（真实按钮路径） ---- */
    const locText = A.location.sample('ZUUU');
    const parsedLoc = A.location.parse(locText);
    out.locSections = parsedLoc.sections.length;
    out.locWarnings = parsedLoc.warnings.length;
    const imp = A.location.import(locText);            // 文本 → 场景 → 写入 state
    out.locCode = imp.applied.code;
    out.locRunways = imp.applied.runways;
    out.locBeacons = imp.applied.beacons;
    out.locAreas = imp.applied.areas;
    out.locConfigs = imp.applied.configurations;
    out.locEvents = imp.applied.events;
    out.locNmToKm = Math.round(imp.scene.airspace.radiusKm * 100) / 100;
    out.locAreaAltitude = imp.scene.areas.length ? Math.round(imp.scene.areas[0].altM) : -1;
    out.locSepNm = st.defaults.minSeparationNm;
    out.locAltMinM = st.defaults.altMinM;
    out.locAltMaxM = st.defaults.altMaxM;
    const zuuu = A.airports.get('ZUUU');
    out.locRunwayPair = zuuu && zuuu.runways ? zuuu.runways.join(',') : '';
    out.locLatLonMode = imp.scene.mode;
    document.getElementById('location-sample-btn').click();   // 端到端：示例机场按钮（含信标→航路点）
    out.locBeaconPoint = st.routePoints.filter(p => (p.name || '').toLowerCase() === 'ctu').length;
    out.locFocus = st.focusAirport;
    out.locCommMentionsImport = st.commMessages.some(m => (m.text || '').includes('已导入位置文件'));

    document.getElementById('weather-toggle-btn').click();
    out.weatherOn = st.weatherEnabled === true && !!st.storm;
    document.getElementById('weather-toggle-btn').click();
    out.weatherOff = st.weatherEnabled === false;

    document.querySelector('#aircraft-list .panel-item').click();
    const dlg = document.getElementById('aircraft-edit-dialog');
    out.dialogVisible = !dlg.classList.contains('hidden');
    out.routeOptions = document.querySelectorAll('#ac-route option').length;
    dlg.querySelector('.dialog-close').click();
    out.dialogClosed = dlg.classList.contains('hidden');

    document.getElementById('add-point-btn').click();
    document.getElementById('add-point-btn').click();
    out.pointItemsAfterAdd = document.querySelectorAll('#route-points-list .panel-item').length;
    document.querySelector('#route-points-list .panel-item').click();
    document.getElementById('tool-delete').click();
    out.pointItemsAfterDelete = document.querySelectorAll('#route-points-list .panel-item').length;

    document.getElementById('play-pause-btn').click();
    out.resumed = st.isPlaying;
    document.getElementById('play-pause-btn').click();
    return out;
})()`;

/** 阶段三：自动许可链与自动移交（60× 快速推进，验证 塔台放行 → 进近 → 区调 全流程） */
const SCRIPT_AUTO = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    const out = {
        seatCommsBeforeAuto: document.querySelectorAll(
            '#comm-messages .comm-msg.twr, #comm-messages .comm-msg.app, #comm-messages .comm-msg.acc'
        ).length
    };
    const speed = document.getElementById('speed-select');
    speed.value = '60';
    speed.dispatchEvent(new Event('change'));
    out.speed = st.timeSpeed;
    document.getElementById('play-pause-btn').click();
    out.playing = st.isPlaying;
    return out;
})()`;

/** 阶段四：读取自动流程结果并暂停 */
const SCRIPT_AUTO_VERIFY = `(async () => {
    const A = window.__ATC__;
    const st = A.state;
    const out = {
        simTimeAuto: Math.round(st.time),
        seatCommsAfterAuto: document.querySelectorAll(
            '#comm-messages .comm-msg.twr, #comm-messages .comm-msg.app, #comm-messages .comm-msg.acc'
        ).length,
        autoTakeoffIssued: st.aircraft.some(ac => ac.flow === 'departure' && ac.clearance === 'takeoff'),
        runwayAssigned: st.aircraft.every(ac => !!ac.runway),
        departureAutoHandoff: st.aircraft.some(
            ac => ac.flow === 'departure' && ac.handoffTime !== undefined && ac.unit === 'ACC'
        ),
        phaseVariety: new Set(st.aircraft.filter(ac => ac.phase).map(ac => ac.phase)).size,
        units: [...new Set(st.aircraft.filter(ac => ac.unit && !ac.landed).map(ac => ac.unit))].sort().join('/')
    };
    // 应用图标是否随包提供（验证 electron-builder files 配置 + app:// 协议）
    try {
        const iconResp = await fetch('app://bundle/build/icon.ico');
        out.iconServed = iconResp.ok;
    } catch (e) {
        out.iconServed = false;
    }
    document.getElementById('play-pause-btn').click();
    return out;
})()`;

/** 阶段五：班次玩法（装载关卡 + 导演无限流量 + 评分 + HUD + 时间轴锁定） */
const SCRIPT_GAME = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    const out = {};
    document.getElementById('session-start-btn').click();
    const dir = A.game.director();
    out.gameStarted = A.game.active() === true;
    out.gameScenarioId = dir.scenarioId;
    out.gameAirport = dir.airport;
    out.gameEntrypoints = dir.entrypoints;
    out.gameAirlines = dir.airlines;
    out.gameTimeline = dir.timeline;
    out.clearedSandboxTraffic = st.aircraft.every(ac => ac.spawnedBy === 'director');

    /* 班次内实时不可回溯：拖动时间轴应被拦截 */
    const beforeTime = Math.round(st.time);
    const slider = document.getElementById('time-slider');
    slider.value = '900';
    slider.dispatchEvent(new Event('input'));
    out.timeLocked = Math.round(st.time) === beforeTime;

    /* [configurations] 分数门槛：进度 5 → 仅 02L；进度 6 → 02L + 02R（反向端见 config2） */
    out.planAt5 = A.game.runwayPlan(5).land.join('/');
    out.planAt6 = A.game.runwayPlan(6).land.join('/');

    /* [areaN] 最低高度区：机场中心处于 2000ft/10NM 与 3500ft/20NM 两区重叠内 → 取更高者 1067m */
    const ap = A.airports.get('ZUUU');
    const mva = A.mva.limitAt(ap.x, ap.y);
    out.mvaLimitM = mva ? Math.round(mva.limitM) : 0;

    const speed = document.getElementById('speed-select');
    speed.value = '60';
    speed.dispatchEvent(new Event('change'));
    return out;
})()`;

/** 阶段六：关闭自动许可并把一架进港航班压到最低高度区以下（确定性触发 MVA 记分） */
const SCRIPT_GAME_MVA = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    const out = {};
    const autoBox = document.getElementById('auto-clearance-toggle');
    autoBox.checked = false;
    autoBox.dispatchEvent(new Event('change'));
    out.autoClearanceOff = st.autoClearance === false;
    out.gameLandedBefore = st.aircraft.filter(ac => ac.landed).length;

    const arr = st.aircraft.find(ac => ac.flow === 'arrival' && !ac.landed && ac.spawnedBy === 'director');
    out.mvaTargetFound = !!arr;
    if (arr) {
        arr.approachType = null;
        arr.clearance = null;
        const input = document.getElementById('comm-input');
        input.value = arr.flightNo + ' 下降 600';
        document.getElementById('comm-send-btn').click();
        out.mvaTargetAlt = arr.altCon;
        out.mvaTargetCallsign = arr.flightNo;
    }
    return out;
})()`;

/** 阶段七：校核导演/评分/HUD/结算，并结束班次 */
const SCRIPT_GAME_VERIFY = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    const dir = A.game.director();
    const sc = A.game.scoring();
    const hud = A.game.hud();
    const out = {
        gameSimTime: Math.round(st.time),
        gameCursor: dir.cursor,
        gameTimelineDone: dir.timelineDone === true,
        gameSpawnedArrival: dir.spawned.arrival,
        gameSpawnedDeparture: dir.spawned.departure,
        gameTotalSpawned: dir.totalSpawned,
        gameDirectorAircraft: st.aircraft.filter(ac => ac.spawnedBy === 'director').length,
        gameRunwayAssigned: st.aircraft.filter(ac => ac.spawnedBy === 'director').every(ac => !!ac.runway),
        gameRunwayLand: sc.runway.land.join('/'),
        gameProgress: sc.progress,
        gameScore: sc.score,
        gameGrade: sc.grade,
        gameMvaCount: sc.counts.mva,
        gameLanded: sc.landed,
        gameScoreEvents: A.game.timeline(50).length,
        hudSessionActive: hud.sessionActive === true,
        hudTimeText: hud.timeText,
        hudScore: hud.score,
        hudGrade: hud.grade,
        hudRunwayLand: (hud.runwayLand || []).join('/'),
        hudPanelRows: document.querySelectorAll('#session-hud .session-row').length,
        sceneTextBanner: dir.banner ? dir.banner.text : '',
        sceneEventTypes: A.game.director().events.map(e => e.type).join(',')
    };
    document.getElementById('session-end-btn').click();
    const r = A.game.result();
    out.resultScore = r ? r.score : -1;
    out.resultGrade = r ? r.grade : '';
    out.resultObjectives = r ? r.objectives.total : -1;
    out.resultObjectivePassed = r ? r.objectives.passed : -1;
    out.resultTimeline = r ? r.timeline.length : -1;
    out.resultReason = r ? r.reason : '';
    out.sessionEnded = A.game.active() === false;
    const box = document.getElementById('session-result');
    out.resultPanelVisible = !!box && !box.classList.contains('hidden');
    out.resultHasObjectives = !!box && box.querySelectorAll('.result-objectives li').length === 5;
    return out;
})()`;

/** 阶段八：无位置文件时的自由流量班次（8 向入口 + 枢纽航司表 + 机场跑道回退） */
const SCRIPT_GAME_DEFAULT = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    st.location = null;                       // 清除位置文件：验证开箱即用的自由流量班次
    const diff = document.getElementById('session-difficulty');
    diff.value = 'arcade';
    diff.dispatchEvent(new Event('change'));
    document.getElementById('session-start-btn').click();
    const dir = A.game.director();
    const sc = A.game.scoring();
    return {
        defaultSessionActive: A.game.active() === true,
        defaultScenarioId: dir.scenarioId,
        defaultEntrypoints: dir.entrypoints,
        defaultAirlines: dir.airlines,
        defaultTimeline: dir.timeline,
        defaultDifficulty: dir.difficulty,
        defaultRunwayLand: sc.runway.land.join('/'),
        defaultRunwayStart: sc.runway.start.join('/')
    };
})()`;

/** 阶段九：校核自由流量班次的注入与结算 */
const SCRIPT_GAME_DEFAULT_VERIFY = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    const dir = A.game.director();
    const out = {
        defaultSimTime: Math.round(st.time),
        defaultSpawned: dir.totalSpawned,
        defaultSpawnedArrival: dir.spawned.arrival,
        defaultSpawnedDeparture: dir.spawned.departure,
        defaultRunwayAssigned: st.aircraft.filter(ac => ac.spawnedBy === 'director').every(ac => !!ac.runway),
        defaultMvaSilent: A.game.scoring().counts.mva === 0
    };
    document.getElementById('session-end-btn').click();
    const r = A.game.result();
    out.defaultResultGrade = r ? r.grade : '';
    out.defaultResultObjectives = r ? r.objectives.total : -1;
    out.defaultSessionEnded = A.game.active() === false;
    return out;
})()`;

/** 阶段十：内置关卡包（清单 / 选择 / 装载 L2） */
const SCRIPT_CONSOLE_LEVEL = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    const out = {};
    const levels = A.scenarios.list();
    out.levelCount = levels.length;
    out.levelIds = levels.map(l => l.id).join(',');
    out.levelObjectives = levels.map(l => l.objectives).join(',');
    out.levelEvents = levels.map(l => l.events).join(',');

    const sel = document.getElementById('session-scenario');
    sel.value = 'l2-departure-rush';
    sel.dispatchEvent(new Event('change'));
    out.difficultyLockedForLevel = document.getElementById('session-difficulty').disabled === true;
    out.panelShowsBrief = document.getElementById('session-hud').textContent.indexOf('L2') >= 0;

    document.getElementById('session-start-btn').click();
    const dir = A.game.director();
    const meta = A.session() ? A.session().meta : null;
    out.l2Active = A.game.active() === true;
    out.l2ScenarioId = dir.scenarioId;
    out.l2Difficulty = dir.difficulty;
    out.l2Events = dir.timeline;
    out.l2Objectives = meta ? meta.objectives.length : -1;
    out.l2ReadbackRate = A.readback.rate();
    out.l2PlanAt0 = A.game.runwayPlan(0).land.join('/');
    out.l2PlanAt5 = A.game.runwayPlan(5).land.join('/');
    return out;
})()`;

/** 阶段十一：指令台 2.0（推荐用语 / 灰显 / 一键下发）+ 复诵（错诵与纠正） */
const SCRIPT_CONSOLE_DOM = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    const out = {};
    const dep = st.aircraft.find(ac => ac.flow === 'departure') || st.aircraft[0];
    out.depFound = !!dep;
    if (!dep) return out;

    const items = Array.prototype.slice.call(document.querySelectorAll('#progress-list .progress-item'));
    const hit = items.find(el => el.dataset.flightNo === dep.flightNo);
    if (hit) hit.click();
    out.selectedIsAircraft = !!(st.selectedItem && st.selectedItem.type === 'aircraft');
    A.console.update(true);

    const buttons = Array.prototype.slice.call(document.querySelectorAll('#console-templates .console-btn'));
    out.consoleButtons = buttons.length;
    out.consoleGroups = document.querySelectorAll('#console-templates .console-group').length;
    out.consoleTargetText = document.getElementById('console-target').textContent.trim().slice(0, 60);
    const landBtn = buttons.find(b => b.textContent.indexOf('可以落地') >= 0);
    out.landBtnDisabled = !!landBtn && landBtn.disabled === true;
    out.landBtnHint = landBtn ? landBtn.title : '';
    const toBtn = buttons.find(b => b.textContent.indexOf('可以起飞') >= 0);
    out.takeoffBtnEnabled = !!toBtn && toBtn.disabled === false;
    const before = document.querySelectorAll('#comm-messages .comm-msg').length;
    if (toBtn) toBtn.click();
    out.templateCommsAdded = document.querySelectorAll('#comm-messages .comm-msg').length - before;
    out.templateApplied = dep.clearance === 'takeoff';

    /* 复诵：强制漏项 → 「要求复诵」纠正 → 再造一次不纠正 */
    const input = document.getElementById('comm-input');
    st.defaults.readbackErrorRate = 1;
    input.value = dep.flightNo + ' 高度 1200';
    document.getElementById('comm-send-btn').click();
    out.pendingAfterForce = A.readback.pending(dep) === true;
    out.missing = dep.readback ? dep.readback.missing : '';
    out.readbackText = A.readback.text(dep);
    out.altConAfterCmd = dep.altCon;
    A.console.update(true);
    out.warnShown = document.getElementById('console-readback').className.indexOf('console-readback-warn') >= 0;
    out.reissueBtnVisible = document.getElementById('console-reissue-btn').classList.contains('hidden') === false;

    st.defaults.readbackErrorRate = 0;
    document.getElementById('console-reissue-btn').click();
    out.resolvedAfterReissue = A.readback.pending(dep) === false;
    out.lastReadbackCorrect = dep.readback.correct === true;
    out.readbackCountAfterCorrect = A.game.scoring().counts.readback;

    st.defaults.readbackErrorRate = 1;
    input.value = dep.flightNo + ' 高度 1800';
    document.getElementById('comm-send-btn').click();
    out.uncorrectedPending = A.readback.pending(dep) === true;

    /* 第一批（CCAR-93TM-R6 §118）：复诵清单分级 + 加权错诵抽取 */
    const crit = A.readback.critical || {};
    out.criticalGroups = ['runway', 'alt', 'route']
        .filter(k => Array.isArray(crit[k]) && crit[k].length > 0).join('/');
    const NEW_ACTIONS = ['lineUp', 'holdShort', 'crossRunway', 'backtrack', 'qnh', 'squawk', 'transitionLevel', 'route'];
    const texts = NEW_ACTIONS.map(k => A.readback.action({ type: k, value: 'W' }, dep));
    out.actionTextCount = texts.filter(t => String(t).length > 0).length;
    out.actionHits = NEW_ACTIONS.filter((k, i) => String(texts[i]).length > 0).join('/');
    out.weightsDesc = [A.readback.weights.runway, A.readback.weights.route, A.readback.weights.alt].join('>');
    out.fallbackNotPicked = A.readback.pickMissed([
        { key: 'handoff', text: '联系塔台' },
        { key: 'goaround', text: '复飞' }
    ]) === null;
    A.readback.seed(20261007);
    const mixed = [
        { key: 'land', text: '可以落地' },
        { key: 'route', text: '经 ZUUU-01' },
        { key: 'alt', text: '高度 1200' }
    ];
    const picked = { runway: 0, route: 0, alt: 0 };
    for (let i = 0; i < 600; i++) {
        const p = A.readback.pickMissed(mixed);
        const gk = p && A.readback.groupOf(p.key);
        if (gk && picked[gk] !== undefined) picked[gk]++;
    }
    out.pickCounts = [picked.runway, picked.route, picked.alt].join(',');
    out.runwayMostPicked = picked.runway > picked.route && picked.route > picked.alt;
    window.__SMOKE_DEP__ = dep.flightNo;
    return out;
})()`;

/** 阶段十二：L2 运行时（事件驱动解锁跑道 / 未纠正复诵扣分）+ 结算 */
const SCRIPT_L2_VERIFY = `(() => {
    const A = window.__ATC__;
    const st = A.state;
    const dir = A.game.director();
    const sc = A.game.scoring();
    const dep = st.aircraft.find(ac => ac.flightNo === window.__SMOKE_DEP__);
    const out = {
        l2SimTime: Math.round(st.time),
        l2Cursor: dir.cursor,
        l2Progress: sc.progress,
        l2PlanNow: sc.runway.land.join('/'),
        l2RunwayChanges: sc.runwayChanges,
        l2ReadbackCount: sc.counts.readback,
        l2ReadbackPenalized: !!(dep && dep.readback && dep.readback.penalized),
        l2ReadbackMissing: dep && dep.readback ? dep.readback.missing : ''
    };
    st.defaults.readbackErrorRate = 0;
    document.getElementById('session-end-btn').click();
    const r = A.game.result();
    out.l2ResultGrade = r ? r.grade : '';
    out.l2ResultObjectives = r ? r.objectives.total : -1;
    const rb = r ? r.objectives.items.find(i => i.kind === 'NO_READBACK_MISSED') : null;
    out.l2ReadbackObjectiveOk = rb ? rb.ok : null;
    out.l2ReadbackObjectiveActual = rb ? rb.actual : -1;
    out.l2Ended = A.game.active() === false;
    out.l2HudAfterEnd = A.game.hud().sessionActive;
    return out;
})()`;

async function runSmoke() {
    const win = createWindow({ show: false, headless: true });
    attachDiagnostics(win);
    const report = {};
    try {
        await new Promise((resolve, reject) => {
            win.webContents.once('did-finish-load', resolve);
            win.webContents.once('did-fail-load', () => reject(new Error('页面加载失败')));
            setTimeout(() => reject(new Error('加载超时')), 20000);
        });
        await wait(1000);
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_BOOT));
        await wait(3000);
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_INTERACT));
        await win.webContents.executeJavaScript(SCRIPT_AUTO);
        await wait(7000);
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_AUTO_VERIFY));
        // 阶段五~七：班次玩法（装载关卡 → 导演无限流量 → 评分/MVA → 结算）
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_GAME));
        await wait(6000);
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_GAME_MVA));
        await wait(4000);
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_GAME_VERIFY));
        // 阶段八~九：无位置文件时的自由流量班次（开箱即用路径）
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_GAME_DEFAULT));
        await wait(5000);
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_GAME_DEFAULT_VERIFY));
        // 阶段十~十二：内置关卡包 + 指令台 2.0（用语模板/灰显）+ 复诵（错诵/纠正/扣分）
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_CONSOLE_LEVEL));
        await wait(1200);
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_CONSOLE_DOM));
        await wait(11000);
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_L2_VERIFY));
        // 离屏渲染下抓取整屏截图，便于人工核验渲染效果
        // （打包后 APP_ROOT 位于 app.asar 内不可写，故写入 userData 目录）
        try {
            const image = await win.webContents.capturePage();
            const shotPath = path.join(app.getPath('userData'), 'smoke-shot.png');
            writeFileSync(shotPath, image.toPNG());
            report.screenshot = shotPath;
        } catch (e) {
            consoleErrors.push('截图失败: ' + String(e && e.message || e));
        }
    } catch (e) {
        pageFailures.push(String((e && e.message) || e));
    }

    report.consoleErrors = consoleErrors;
    report.pageFailures = pageFailures;

    const checks = [
        ['启动句柄存在', report.bootOk === true],
        ['画布已按容器尺寸初始化', report.canvasSized === true],
        ['启动通话消息已渲染', (report.bootCommMessages ?? 0) >= 4],
        ['随机场景生成航班', (report.aircraft ?? 0) >= 7],
        ['随机场景生成航线', (report.routes ?? 0) >= 7],
        ['航路点面板已重建', (report.pointItems ?? 0) > 0],
        ['航线面板已重建', (report.routeItems ?? 0) >= 7],
        ['飞机面板已重建', (report.aircraftItems ?? 0) >= 7],
        ['播放已开始', report.playing === true],
        ['动画循环持续运转', (report.frames ?? 0) > 10],
        ['模拟时间推进', (report.timeAfterPlay ?? 0) > 0],
        ['飞机位置随约束模型推进', report.moved === true],
        ['进程单已渲染', (report.progressItems ?? 0) >= 7],
        ['覆盖层进程单同步', (report.overlayItems ?? 0) === (report.progressItems ?? -1)],
        ['暂停生效', report.paused === true],
        ['管制指令生成高度约束', report.altConApplied === true],
        ['指令通话已记录', (report.commAfterCmd ?? 0) > (report.bootCommMessages ?? 0)],
        ['天气图层可开启', report.weatherOn === true],
        ['天气图层可关闭', report.weatherOff === true],
        ['飞机对话框可打开', report.dialogVisible === true],
        ['对话框航线下拉已填充（回归：缺导入 bug）', (report.routeOptions ?? 0) >= 2],
        ['对话框可关闭', report.dialogClosed === true],
        ['新增航路点生效', (report.pointItemsAfterAdd ?? 0) >= 2],
        ['删除选中生效', (report.pointItemsAfterDelete ?? -1) === (report.pointItemsAfterAdd ?? 0) - 1],
        ['可恢复播放', report.resumed === true],
        ['席位面板渲染三个席位', report.seatRows === 3],
        ['席位面板默认开启自动移交/许可', report.autoHandoffDefault === true && report.autoClearanceDefault === true],
        ['席位边界判定（含迟滞）', report.unitBoundaries === true],
        ['航空器席位已归属', (report.unitsAssigned ?? 0) >= 7],
        ['进近许可（ILS + 跑道）生效', report.approachApplied === true],
        ['落地许可生效', report.landingClearanceIssued === true],
        ['自动移交可关闭', report.autoHandoffOff === true],
        ['手动移交生效（→塔台）', report.manualHandoff === true],
        ['自动移交可恢复', report.autoHandoffOn === true],
        ['席位通话（塔台/进近/区调）已记录', (report.seatComms ?? 0) >= 1],
        ['席位过滤生效', report.seatFilterOn === true && report.filterWorks === true],
        ['席位过滤可取消', report.seatFilterOff === true],
        ['60× 推进到自动流程时段', (report.simTimeAuto ?? 0) > 200],
        ['自动离港放行生效（45s 后）', report.autoTakeoffIssued === true],
        ['自动跨界移交持续产生席位通话', (report.seatCommsAfterAuto ?? 0) > (report.seatCommsBeforeAuto ?? -1)],
        ['离港航班自动流转移交出区（塔台→进近→区调）', report.departureAutoHandoff === true],
        ['全部航班均已指派跑道', report.runwayAssigned === true],
        ['应用图标随包提供（app:// 可加载）', report.iconServed === true],
        ['阶段 FSM 字段已初始化（phase/flow/wake）', (report.phasesAssigned ?? 0) >= 7],
        ['许可记录写入领域对象', report.clearanceArrays === true && (report.clearanceRecords ?? 0) >= 3],
        ['阶段随流程推进（≥2 种阶段并存）', (report.phaseVariety ?? 0) >= 2],
        ['指令合法性判定（下降阶段：高度可发、起飞/落地不可发）', report.altAllowedInDescent === true
            && report.takeoffDeniedInDescent === true && report.landDeniedInDescent === true],
        ['跑道指令生效（领域记录）', report.runwayCommandApplied === true],
        ['非法指令给出提示文案', typeof report.issueHintText === 'string' && report.issueHintText.length > 0],
        ['间隔预测可用（确定性外推）', report.sepPredictionFinite === true && report.predictedConflictsShape === true],
        ['班次已录制管制输入', (report.sessionInputs ?? 0) >= 1],
        ['状态采样已写入（剖面图数据源）', (report.historySamples ?? 0) >= 1],
        ['时钟模块驱动时间推进', (report.clockSteps ?? 0) > 0],
        ['EATC 位置文件解析（节数 ≥10、零告警）', (report.locSections ?? 0) >= 10 && report.locWarnings === 0],
        ['位置文件导入（跑道/信标/最低高度区/构型/事件）', report.locCode === 'ZUUU' && report.locRunways === 2
            && report.locBeacons === 4 && report.locAreas === 2 && report.locConfigs === 2 && report.locEvents === 10],
        ['NM→km 与 ft→m 换算正确（半径 55.56km / MVA 610m）',
            report.locNmToKm === 55.56 && report.locAreaAltitude === 610],
        ['隔离标准与高度上下限按文件生效（3NM / 610m / 3658m）',
            report.locSepNm === 3 && report.locAltMinM === 610 && report.locAltMaxM === 3658],
        ['跑道对被登记为 02L/20R + 02R/20L', report.locRunwayPair === '02L/20R,02R/20L'],
        ['示例机场按钮端到端（信标→航路点 + 焦点机场 + 播报）', report.locBeaconPoint === 1
            && report.locFocus === 'ZUUU' && report.locCommMentionsImport === true],
        /* ---- P1 班次玩法（导演 / 评分 / HUD / 结算） ---- */
        ['班次装载：由位置文件派生关卡并清空沙盒流量', report.gameStarted === true
            && report.gameScenarioId === 'loc-ZUUU' && report.gameAirport === 'ZUUU'
            && report.clearedSandboxTraffic === true],
        ['导演消费 entrypoints/airlines/[scenario]（4 入口 · ≥5 航司 · 8 事件）',
            (report.gameEntrypoints ?? 0) >= 4 && (report.gameAirlines ?? 0) >= 5 && (report.gameTimeline ?? 0) === 8],
        ['班次内时间轴不可回溯（拖动被拦截）', report.timeLocked === true],
        ['[configurations] 分数门槛解锁跑道（5→02L，6→02L/02R）',
            report.planAt5 === '02L' && report.planAt6 === '02L/02R'],
        ['[areaN] 最低高度区判定（重叠取更高者：机场中心 3500ft ≈ 1067m）',
            Math.abs((report.mvaLimitM ?? 0) - 1067) <= 2],
        ['导演无限流量注入（进港 + 离港）', (report.gameTotalSpawned ?? 0) >= 3
            && (report.gameSpawnedArrival ?? 0) >= 1 && (report.gameSpawnedDeparture ?? 0) >= 1
            && (report.gameDirectorAircraft ?? 0) >= 3],
        ['[scenario] 时间轴执行完毕（elapse 已并入时间轴）', report.gameTimelineDone === true
            && (report.gameCursor ?? 0) === 8 && String(report.sceneEventTypes || '').includes('arr')
            && String(report.sceneEventTypes || '').includes('dep')],
        ['[scenario] text 事件生成 HUD 字幕', String(report.sceneTextBanner || '').length > 0],
        ['导演航班跑道取自构型计划', report.gameRunwayAssigned === true && String(report.gameRunwayLand || '').includes('02L')],
        ['解锁分由 score 事件设定并随落地增长', (report.gameProgress ?? 0) >= 5],
        ['MVA 违规计入评分（确定性：压到 610m 下限）', report.mvaTargetFound === true
            && report.mvaTargetAlt === 610 && (report.gameMvaCount ?? 0) >= 1 && (report.autoClearanceOff ?? false) === true],
        ['绩效分与评级（S/A/B/C/D）', (report.gameScore ?? 100) < 100 && /^[SABCD]$/.test(String(report.gameGrade || ''))
            && report.hudScore === report.gameScore],
        ['HUD 读值可用（班次/时钟/评级/跑道）', report.hudSessionActive === true
            && /^\d\d:\d\d:\d\d$/.test(String(report.hudTimeText)) && String(report.hudRunwayLand).includes('02L')],
        ['班次面板渲染实时读数', (report.hudPanelRows ?? 0) >= 6],
        ['结算：评级 + 目标达成 + 事件时间轴', (report.resultScore ?? -1) >= 0
            && /^[SABCD]$/.test(String(report.resultGrade || '')) && report.sessionEnded === true
            && report.resultObjectives === 5 && (report.resultObjectivePassed ?? -1) >= 0
            && (report.resultTimeline ?? 0) >= 1],
        ['结算结果面板可见并列出 5 项目标', report.resultPanelVisible === true && report.resultHasObjectives === true],
        /* ---- 开箱即用：无位置文件时的自由流量班次 ---- */
        ['自由流量班次：无位置文件时按机场生成 8 向入口 + 枢纽航司表',
            report.defaultSessionActive === true && report.defaultScenarioId === 'free-ZUUU'
            && report.defaultEntrypoints === 8 && (report.defaultAirlines ?? 0) >= 3
            && report.defaultTimeline === 0 && report.defaultDifficulty === 'arcade'],
        ['自由流量班次：跑道回退机场表并持续注入航班',
            String(report.defaultRunwayLand || '').includes('02L') && String(report.defaultRunwayStart || '').includes('02L')
            && (report.defaultSpawned ?? 0) >= 2 && report.defaultRunwayAssigned === true
            && (report.defaultSpawnedArrival ?? 0) >= 1],
        ['自由流量班次：无 MVA 数据时不计违规并可结算',
            report.defaultMvaSilent === true && report.defaultSessionEnded === true
            && /^[SABCD]$/.test(String(report.defaultResultGrade || '')) && report.defaultResultObjectives === 5],
        /* ---- P1-B：关卡包 + 指令台 2.0 + 复诵 ---- */
        ['关卡包：内置 L1/L2/L3（目标数与事件数随关卡）', report.levelCount === 3
            && report.levelIds === 'l1-approach-basic,l2-departure-rush,l3-reverse-wind'
            && report.levelObjectives === '5,6,5' && report.levelEvents === '10,16,11'],
        ['选中关卡后难度随关卡（下拉灰显 + 任务简述）', report.difficultyLockedForLevel === true
            && report.panelShowsBrief === true],
        ['L2 关卡装载（标准难度 · 16 条事件 · 6 项目标 · 复诵率 8%）', report.l2Active === true
            && report.l2ScenarioId === 'l2-departure-rush' && report.l2Difficulty === 'standard'
            && report.l2Events === 16 && report.l2Objectives === 6 && report.l2ReadbackRate === 0.08],
        ['L2 分数门槛：进度 0 → 02L，进度 5 → 02L/02R', report.l2PlanAt0 === '02L' && report.l2PlanAt5 === '02L/02R'],
        ['指令台按席位渲染推荐用语（分组/按钮/选中机摘要）', report.selectedIsAircraft === true
            && (report.consoleGroups ?? 0) >= 3 && (report.consoleButtons ?? 0) >= 8
            && String(report.consoleTargetText || '').length >= 8],
        ['指令台灰显：不可下发项禁用并给出原因', report.landBtnDisabled === true
            && String(report.landBtnHint || '').length > 0],
        ['指令台一键下发（可以起飞 → 放行 + 通话记录）', report.takeoffBtnEnabled === true
            && report.templateApplied === true && (report.templateCommsAdded ?? 0) >= 2],
        ['复诵：定向指令漏项 → 复诵不符（高亮 + 要求复诵入口）', report.pendingAfterForce === true
            && String(report.missing || '').length > 0 && String(report.readbackText || '').length > 0
            && report.warnShown === true && report.reissueBtnVisible === true && report.altConAfterCmd === 1200],
        ['复诵纠正：重新下发即视为纠正（未扣分）', report.resolvedAfterReissue === true
            && report.lastReadbackCorrect === true && report.readbackCountAfterCorrect === 0],
        ['未纠正复诵：宽限期后记一次未复诵', report.l2ReadbackPenalized === true
            && (report.l2ReadbackCount ?? 0) >= 1 && String(report.l2ReadbackMissing || '').length > 0],
        ['关卡事件驱动跑道解锁（t=600 score 事件 → 跑道变更）', (report.l2Progress ?? 0) >= 5
            && String(report.l2PlanNow || '').includes('02R') && (report.l2RunwayChanges ?? 0) >= 1],
        ['结算目标含复诵项且该项因漏项失败', report.l2ResultObjectives === 6
            && report.l2ReadbackObjectiveOk === false && (report.l2ReadbackObjectiveActual ?? 0) >= 1
            && report.l2Ended === true && report.l2HudAfterEnd === false
            && /^[SABCD]$/.test(String(report.l2ResultGrade || ''))],
        /* ---- 第一批（CCAR-93TM-R6 §118）：复诵清单分级 + 加权错诵抽取 ---- */
        ['§118 复诵清单分级（跑道/高度/航路三组齐备）', report.criticalGroups === 'runway/alt/route'],
        ['§118 八个新增复诵措辞函数就位', report.actionTextCount === 8
            && report.actionHits === 'lineUp/holdShort/crossRunway/backtrack/qnh/squawk/transitionLevel/route'],
        ['错诵按类别加权抽取（跑道 ≥ 航路 ≥ 高度，兜底项不参与）', report.weightsDesc === '6>3>2'
            && report.fallbackNotPicked === true && report.runwayMostPicked === true
            && /^(\d+),(\d+),(\d+)$/.test(String(report.pickCounts || ''))
&& String(report.pickCounts).split(',').every(n => Number(n) > 0)],
        ['无控制台错误', consoleErrors.length === 0],
        ['无页面级失败', pageFailures.length === 0]
    ];

    const failed = checks.filter(([, ok]) => !ok);
    const summary = {
        report,
        checks: checks.map(([name, ok]) => ({ name, ok })),
        failedCount: failed.length,
        total: checks.length
    };
    // 打包后退出码可能被便携启动器吞掉，故把报告落盘以便核验
    try {
        writeFileSync(path.join(app.getPath('userData'), 'smoke-report.json'), JSON.stringify(summary, null, 2));
    } catch { /* 报告落盘失败不影响断言结果 */ }

    console.log('\n===== 冒烟测试报告 =====');
    console.log(JSON.stringify(report, null, 2));
    console.log('\n===== 断言结果 =====');
    for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    console.log(`\n总计 ${checks.length} 项，失败 ${failed.length} 项`);

    app.exit(failed.length === 0 ? 0 : 1);
}

/* ---------------- 生命周期 ---------------- */

if (!app.requestSingleInstanceLock() && !SMOKE) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const [win] = BrowserWindow.getAllWindows();
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    app.whenReady().then(() => {
        protocol.handle('app', serveApp);
        app.setAppUserModelId('com.swingmonkey.atc-animate-simulator');
        if (SMOKE) {
            // 冒烟测试窗口使用独立内存分区，需为该分区的 session 单独注册协议
            session.fromPartition('atc-smoke').protocol.handle('app', serveApp);
            runSmoke();
        } else {
            createWindow();
            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) createWindow();
            });
        }
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}

