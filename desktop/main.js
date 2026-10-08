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
import { createReadStream, existsSync, statSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
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
const SCRIPT_BOOT = `(async () => {
    const A = window.__ATC__;
    const st = A && A.state;
    const c = document.getElementById('radar-canvas');
    const out = {
        bootOk: !!A,
        canvasSized: !!c && c.width > 0 && c.height > 0,
        bootCommMessages: document.querySelectorAll('#comm-messages .comm-msg').length
    };
    const sandboxSlider = document.getElementById('time-slider');
    sandboxSlider.value = '30';
    sandboxSlider.dispatchEvent(new Event('input'));
    out.phase1SandboxUsable = A.game.active() === false
        && document.getElementById('session-scenario').disabled === false
        && Math.round(st.time) === 30;
    st.time = 0;
    sandboxSlider.value = '0';
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
    const vp = await import('./js/core/viewport.js');
    const rect = c.getBoundingClientRect();
    const mouse = (type, x, y, target = c) => target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, button: 0, clientX: rect.left + x, clientY: rect.top + y
    }));
    const savedAircraft = st.aircraft;
    const savedPoints = st.routePoints;
    const savedRoutes = st.routes;
    const testPoint = { id: -918, name: 'TEST', type: 'normal', x: vp.toWorldX(220), y: vp.toWorldY(220) };
    st.aircraft = [];
    st.routePoints = [testPoint];
    st.routes = [];
    mouse('dblclick', 220, 220);
    out.phase1FirstDblClick = !document.getElementById('point-edit-dialog').classList.contains('hidden');
    document.querySelector('#point-edit-dialog .dialog-close').click();

    const dragAc = savedAircraft[0];
    const old = { x: dragAc.x, y: dragAc.y, displayX: dragAc.displayX, displayY: dragAc.displayY, routeId: dragAc.routeId };
    dragAc.x = vp.toWorldX(400); dragAc.y = vp.toWorldY(400);
    dragAc.displayX = dragAc.x; dragAc.displayY = dragAc.y;
    st.aircraft = [dragAc];
    st.routePoints = [];
    mouse('mousedown', 400, 400);
    mouse('mousemove', 430, 420);
    mouse('mouseup', -10, -10, window);
    const releasedX = dragAc.x, releasedY = dragAc.y;
    mouse('mousemove', 450, 430);
    out.phase1DragEndsOutside = dragAc.x === releasedX && dragAc.y === releasedY;

    st.routePoints = [testPoint];
    mouse('mousedown', 10, 10);
    mouse('mousedown', 10, 10);
    let selections = 0;
    const offSelection = A.bus.on(A.EV.SELECTION_CHANGED, () => { selections++; });
    mouse('dblclick', 220, 220);
    offSelection();
    out.phase1DblClickOnce = selections === 1;
    document.querySelector('#point-edit-dialog .dialog-close').click();
    Object.assign(dragAc, old);
    st.aircraft = savedAircraft;
    st.routePoints = savedPoints;
    st.routes = savedRoutes;
    st.selectedItem = null;
    st.editingPointId = null;
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

    const beforeUnknown = st.aircraft.map(ac => ac.altCon);
    const inputsBeforeUnknown = A.session().inputs.length;
    input.value = 'ZZZ9999 高度 4000';
    document.getElementById('comm-send-btn').click();
    const feedback = document.getElementById('comm-feedback');
    out.phase1UnknownTargetRejected = st.aircraft.every((ac, i) => ac.altCon === beforeUnknown[i])
        && input.value === 'ZZZ9999 高度 4000'
        && A.session().inputs.length === inputsBeforeUnknown
        && !!feedback && feedback.textContent.includes('ZZZ9999');

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
    const endButton = document.getElementById('session-end-btn');
    out.phase1EndAvailableWhilePlaying = !endButton.disabled
        && getComputedStyle(endButton).pointerEvents !== 'none';

    document.getElementById('play-pause-btn').click();
    const pointsBeforePauseEdit = st.routePoints.length;
    document.getElementById('add-point-btn').click();
    out.phase1PausedGameLocked = st.routePoints.length === pointsBeforePauseEdit;
    document.getElementById('play-pause-btn').click();

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

const SCRIPT_R1_VERIFY = `(() => {
    const A = window.__ATC__;
    const S = A.seats;
    const out = {};
    const ON = "\u517c\u4efb";
    const has = (arr, v) => Array.isArray(arr) && arr.indexOf(v) >= 0;

    /* R1-A 席位门槛：严格「超过阈值」才开席（§47-§51） */
    out.seatGndBoundary = has(S.plan({ annualMovements: 40000 }).tower, 'GND') === false
        && has(S.plan({ annualMovements: 40001 }).tower, 'GND') === true;
    out.seatCdBoundary = has(S.plan({ annualMovements: 100000 }).tower, 'CD') === false
        && has(S.plan({ annualMovements: 100001 }).tower, 'CD') === true;
    out.seatAppBoundary = has(S.plan({ annualMovements: 36000 }).tower, 'APP') === true
        && has(S.plan({ annualMovements: 36001 }).approach, 'APP') === true
        && has(S.plan({ annualMovements: 36001 }).tower, 'APP') === false;
    out.seatAppSplitBoundary = has(S.plan({ annualMovements: 60000 }).approach, 'APP') === true
        && has(S.plan({ annualMovements: 60001 }).approach, 'APP-ARR') === true
        && has(S.plan({ annualMovements: 60001 }).approach, 'APP-DEP') === true;
    out.seatIlsForcesGnd = has(S.plan({ annualMovements: 0, ilsCat: 2 }).tower, 'GND') === true;
    out.seatNtz = has(S.plan({ annualMovements: 60000, parallelApproach: 'independent' }).approach, 'NTZ') === true
        && has(S.plan({ annualMovements: 60000, parallelApproach: 'none' }).approach, 'NTZ') === false;
    out.seatRadarOff = has(S.plan({ radarControl: false }).area, 'ACC-RDR') === false
        && has(S.plan({ radarControl: true }).area, 'ACC-RDR') === true;
    const small = S.plan({ annualMovements: 1000 });
    out.seatMergeWord = String(small.reasons.GND || '').indexOf(ON) >= 0
        && String(small.reasons.CD || '').indexOf(ON) >= 0;
    const ops = { annualMovements: 50000, ilsCat: 1, airspaceComplex: true, parallelApproach: 'independent', radarControl: true };
    out.seatIdempotent = JSON.stringify(S.plan(ops)) === JSON.stringify(S.plan(ops));
    out.seatThresholds = S.thresholds.GND === 40000 && S.thresholds.CD === 100000
        && S.thresholds.APP === 36000 && S.thresholds.APP_SPLIT === 60000;

    /* R1-B 九项工作日志字段（§63） */
    const fields = A.logs.fields;
    const needIds = ['seatOpenLog', 'staffLog', 'dutyLog', 'equipmentLog', 'navLog', 'weatherLog', 'serviceLog', 'safetyLog', 'violationLog'];
    out.logFieldCount = Array.isArray(fields) ? fields.length : -1;
    out.logFieldIds = Array.isArray(fields) && needIds.every(id => fields.some(f => f.id === id));
    out.logFieldEvents = Array.isArray(fields) && fields.every(f => Array.isArray(f.events) && f.events.length > 0);
    out.logFieldTitles = Array.isArray(fields) && fields.every(f => !!f.title);

    /* R1-C 值班 / 岗前准备 / 交接检查单 / 适勤（§56 / §60 / §123-§128） */
    out.rosterMode = A.roster.constants.mode;
    const prep = A.roster.prep({});
    out.prepCount = prep.items.length;
    out.prepConfirmSec = prep.confirmSec;
    out.prepAllSec = prep.allSec;
    out.prepPerItem3s = prep.items.every(it => it.confirmSec === 3);
    out.familiarizeSec = A.roster.familiarizeSec;
    const hc = A.roster.handover;
    out.handoverCount = Array.isArray(hc) ? hc.length : -1;
    out.handoverWeights = Array.isArray(hc) && hc.every(it => typeof it.weight === 'number' && it.weight > 0);
    const emergency = Array.isArray(hc) ? hc.find(it => it.id === 'emergency') : null;
    out.handoverEmergencyWeight = emergency ? emergency.weight : -1;
    out.handoverMaxIsEmergency = Array.isArray(hc) && hc.every(it => it.weight <= (emergency ? emergency.weight : 0));
    out.unfitAllowed = A.roster.unfit({ dutySec: 0 }).allowed === true;
    out.unfitStronglyAdvised = A.roster.unfit({ dutySec: A.roster.constants.dutySecMax + 10 }).stronglyAdvised === true;

    /* R1-D 评分新增权重与计数键 */
    const w = A.game.weights;
    out.scoreWeights = w.HANDOVER_MISSED === -2 && w.REST_IGNORED === -5 && w.NOT_FIT_FOR_DUTY === 2;
    const counts = A.game.scoring().counts;
    out.scoreCountKeys = Object.prototype.hasOwnProperty.call(counts, 'handover')
        && Object.prototype.hasOwnProperty.call(counts, 'notFit')
        && Object.prototype.hasOwnProperty.call(counts, 'restIgnored');

    /* R1-E 值班面板已挂载并渲染；事件联动不抛错 */
    out.rosterPanelMounted = !!document.getElementById('roster-section') && !!document.getElementById('roster-body');
    out.rosterPrepRows = document.querySelectorAll('#roster-prep-list .seat-row').length;
    out.rosterHandoverRows = document.querySelectorAll('#roster-handover-list .seat-row').length;
    const unfitBtn = document.getElementById('roster-unfit-btn');
    out.rosterUnfitBtn = !!unfitBtn && !unfitBtn.disabled;
    try {
        A.bus.emit(A.EV.NOT_FIT_FOR_DUTY, { source: 'smoke', reason: 'smoke' });
        A.bus.emit(A.EV.SEATS_PLANNED, { seats: S.plan(ops) });
        out.rosterPanelRefreshOk = !!document.getElementById('roster-body');
    } catch (e) {
        out.rosterPanelRefreshOk = false;
        out.rosterPanelRefreshError = String((e && e.message) || e);
    }

    return out;
})()`;

/** 阶段十三：空管单位经营（v1.7 M1）——招聘 / 任命 / 培训 / 设施 / 技术 / 合同 / 局方 / 日结算 */
const SCRIPT_MGMT = `(() => {
    const A = window.__ATC__;
    const M = A.management;
    const out = {};
    M.reset();

    /* 人事：招聘见习 + 管制员（扣招聘费） */
    const hireTrainee = M.hire('trainee');
    const hireController = M.hire('controller');
    out.mgmtHireOk = hireTrainee.ok === true && hireController.ok === true;
    out.mgmtHireFeeCharged = M.summary().cash < 5000000;
    const staff = M.summary().staff;
    const trainee = staff.find(s => s.role === 'trainee');
    const controller = staff.find(s => s.role === 'controller');
    out.mgmtStaffAfterHire = M.summary().staffCount;

    /* 设施：培训室 + 塔台 + 进近 + 区域 + 设备机房 */
    out.mgmtBuildOk = M.build('training').ok === true && M.build('tower').ok === true
        && M.build('approach').ok === true && M.build('area').ok === true
        && M.build('equipment').ok === true;
    out.mgmtRoomsAfterBuild = M.summary().roomCount;

    /* 培训 / 任命 / 合同 / 技术升级 */
    out.mgmtTrainOk = M.train(trainee.id).ok === true;
    out.mgmtTrainingCount = M.summary().trainingCount;
    out.mgmtAppointOk = M.appoint(controller.id).ok === true;
    out.mgmtSupervisorCount = M.summary().staffCounts.supervisor;
    out.mgmtSignOk = M.sign('regional').ok === true;
    out.mgmtContractCount = M.summary().contractCount;
    out.mgmtUpgradeOk = M.upgrade('surveillance').ok === true;
    out.mgmtTechAfterUpgrade = M.summary().tech;

    /* 席位安排：把管制员排到第一个已开放席位 */
    const seat = M.summary().availableSeats[0] || null;
    out.mgmtSeatAssigned = seat || '';
    out.mgmtAssignOk = seat ? M.assign(controller.id, seat).ok === true : false;

    /* 局方实验运行申请（声望 55 / 监视管制 / 设备机房） */
    out.mgmtTrialOk = M.trial().ok === true;
    out.mgmtTrialPending = M.summary().trial.status;

    /* 日结算：推进日次并写入历史 */
    const before = M.summary();
    out.mgmtEndDayOk = M.endDay().ok === true;
    const after = M.summary();
    out.mgmtDaySettled = after.day === before.day + 1;
    out.mgmtCashChanged = after.cash !== before.cash;
    out.mgmtRevenue = before.daily.revenue;
    out.mgmtTechAfter = after.tech;
    out.mgmtRadarSeat = Array.isArray(after.sectorPlan.area) && after.sectorPlan.area.indexOf('ACC-RDR') >= 0;
    out.mgmtTrialStatusAfter = after.trial.status;
    out.mgmtTrialDecided = after.trial.status === 'approved' || after.trial.status === 'rejected';
    out.mgmtHistoryDays = Array.isArray(after.history) ? after.history.length : -1;

    /* 面板与 HUD 联动 */
    out.mgmtPanelMounted = !!document.getElementById('management-section')
        && !!document.getElementById('management-body');
    const bodyEl = document.getElementById('management-body');
    out.mgmtBodyText = bodyEl ? bodyEl.textContent.length : 0;
    out.mgmtStaffRows = document.querySelectorAll('#management-staff-list .mgmt-staff').length;
    const hud = A.game.hud();
    out.mgmtHudCashText = hud.cashText;
    out.mgmtHudStaffCount = hud.staffCount;
    out.mgmtHudRoomCount = hud.roomCount;
    return out;
})()`;

/** 阶段十四：v1.8 M2 —— 事件引擎 / 存档迁移 / 多机场焦距 / 难度曲线 / 扇区拆分 */
const SCRIPT_M2 = `(() => {
    const A = window.__ATC__;
    const out = {};

    /* ① 事件图鉴：特情 ≥7 条（含 medical）· 经营 5 条 */
    const catalog = A.events.catalog();
    out.m2CatEmergency = catalog.emergency.length;
    out.m2CatManagement = catalog.management.length;
    out.m2CatHasMedical = catalog.emergency.some(e => e.id === 'medical');
    out.m2EventsCatalogOk = catalog.emergency.length >= 7
        && catalog.emergency.some(e => e.id === 'medical')
        && catalog.management.length === 5;

    /* ② 稳定复现一次特情：有未落地进港机就直接触发，否则临时合成一架（事后移除） */
    const arrival = A.state.aircraft.filter(ac => !ac.landed && (ac.flow || 'arrival') === 'arrival');
    const seeded = [];
    if (arrival.length === 0) {
        const synth = {
            id: '__m2smoke__', flightNo: 'M2SMK', callsign: 'M2SMK', flow: 'arrival', landed: false,
            runway: '20R', unit: 'APP', departure: 'ZUUU', destination: 'ZUUU', startTime: 0,
            altitude: 3000, speed: 250, x: 0, y: 0, heading: 0,
            displayAltitude: 3000, displaySpeed: 250, displayHeading: 0, displayX: 0, displayY: 0
        };
        A.state.aircraft.push(synth);
        seeded.push(synth);
    }
    let raisedCount = 0;
    const off = A.bus.on(A.EV.EMERGENCY_RAISED, () => { raisedCount += 1; });
    const record = A.events.trigger('medical');
    if (typeof off === 'function') off();
    seeded.forEach(s => { const i = A.state.aircraft.indexOf(s); if (i >= 0) A.state.aircraft.splice(i, 1); });
    out.m2TriggerRecordType = record ? record.type : null;
    out.m2TriggerEmitted = raisedCount;
    out.m2TriggerOk = !!record && record.type === 'medical' && raisedCount === 1;

    /* ③ 事件快照口径（HUD / 面板共用） */
    const sum = A.events.summary();
    out.m2SummaryOk = typeof sum.count === 'number' && Array.isArray(sum.log) && Array.isArray(sum.spawned);

    /* ④ 存档迁移 v1→v2：补齐 M2 字段且不改入参（纯函数） */
    const rawV1 = { schemaVersion: 1, aircraft: [] };
    const snapshot = JSON.stringify(rawV1);
    const mig = A.migration.migrateState(rawV1);
    out.m2MigrateVersion = A.migration.SCHEMA_VERSION;
    out.m2MigrateTo = mig.schemaVersion;
    out.m2MigrateSteps = mig.migrations.join(',');
    out.m2MigratePureOk = mig.schemaVersion === 2
        && mig.migrations.indexOf('v1->v2:m2-fields') >= 0
        && JSON.stringify(rawV1) === snapshot
        && Array.isArray(mig.data.eventLog);

    /* ⑤ 非法存档回落默认档：每次独立，不与模块级默认值共享引用 */
    const invA = A.migration.migrateState(null);
    const invB = A.migration.migrateState(null);
    out.m2MigrateInvalidOk = invA.schemaVersion === 2 && Array.isArray(invA.data.eventLog)
        && invA.data.eventLog !== invB.data.eventLog && invA.data !== invB.data;

    /* ⑥ 多机场焦距：焦点机场与显式编码对齐 */
    const ma = A.multiAirport();
    out.m2MultiAirport = ma ? (ma.focusAirportCode + '/' + ma.matches) : 'null';
    out.m2MultiAirportOk = !!ma && typeof ma.focusAirportCode === 'string' && ma.focusAirportCode.length > 0
        && ma.matches === true;

    /* ⑦ 难度曲线：随经营天数单调加压（流量↑ 事件频率↑ 生成间隔↓） */
    const d1 = A.difficulty.curve({ day: 1, difficulty: 'standard' });
    const d30 = A.difficulty.curve({ day: 30, difficulty: 'standard' });
    out.m2DifficultyOk = d30.trafficScale > d1.trafficScale
        && d30.eventRateScale >= d1.eventRateScale
        && d30.spawnIntervalSec <= d1.spawnIntervalSec;

    /* ⑧ 多扇区拆分：大流量拆进近东西扇 + 区域南北扇；小流量不拆 */
    const big = A.seats.plan({ annualMovements: 130000, radarControl: true });
    const small = A.seats.plan({ annualMovements: 20000 });
    const bigIds = big.sectors.map(s => s.id).join(',');
    out.m2SectorIds = bigIds;
    out.m2SectorSplitOk = big.sectors.length === 4
        && big.approach.indexOf('APP-W') >= 0 && big.approach.indexOf('APP-E') >= 0
        && big.area.indexOf('ACC-N') >= 0 && big.area.indexOf('ACC-S') >= 0
        && bigIds === 'APP-W,APP-E,ACC-N,ACC-S'
        && small.sectors.length === 0;

    return out;
})()`;

const SCRIPT_PHASE1_RESULTS = `(async () => {
    const A = window.__ATC__;
    const st = A.state;
    const out = {};
    A.game.start({ scenarioId: 'l1-approach-basic' });
    const abandoned = A.game.end({ reason: '试玩提前结束' });
    out.phase1AbandonFair = abandoned.outcome === 'abandoned'
        && abandoned.performanceScore === 100
        && abandoned.score <= 59 && abandoned.grade !== 'S';

    const base = A.scenarios.get('l1-approach-basic');
    A.game.start({ scenario: { ...base, id: 'phase1-timeout', finish: { count: 4, timeLimit: 1 } } });
    st.time = 2;
    A.bus.emit(A.EV.CLOCK_TICK, { time: 2, steps: 1, dt: 2 });
    const failed = A.game.result();
    out.phase1TimeoutFair = !!failed && failed.outcome === 'failed'
        && failed.landed === 0 && failed.score <= 59 && failed.grade !== 'S';

    const sep = await import('./js/domain/separation.js');
    const oldAircraft = st.aircraft;
    st.aircraft = [
        { id: -901, flightNo: 'TST901', x: 0, y: 0, displayX: 0, displayY: 0, altitude: 3000, displayAltitude: 3000, startTime: 0, landed: false },
        { id: -902, flightNo: 'TST902', x: 0, y: 0, displayX: 0, displayY: 0, altitude: 3000, displayAltitude: 3000, startTime: 0, landed: false }
    ];
    const pairBefore = sep.getConflictPairs().length;
    st.aircraft[1].landed = true;
    out.phase1LandedNoConflict = pairBefore === 1 && sep.getConflictPairs().length === 0;
    st.aircraft = oldAircraft;
    return out;
})()`;
const SCRIPT_PHASE1_CLOCK = `(async () => {
    const A = window.__ATC__;
    const st = A.state;
    const clock = await import('./js/core/clock.js');
    const { getAirport } = await import('./js/data/airports.js');
    const { scoreTimeline } = await import('./js/game/scoring.js');
    const oldLocation = st.location;
    st.location = null;
    const sampleTicks = (speed, frameCount, frameDt) => {
        A.game.start({ difficulty: 'standard', seed: 321 });
        st.timeSpeed = speed;
        const airport = getAirport(st.focusAirport);
        const holding = { x: airport.x + 1000, y: airport.y + 1000, altitude: 3000,
            speed: 0, heading: 90, acType: 'B738', flow: 'departure', clearance: 'takeoff',
            startTime: 0, landed: false, clearances: [], navMode: 'heading' };
        st.aircraft = [
            { ...holding, id: -931, flightNo: 'TST931' },
            { ...holding, id: -932, flightNo: 'TST932' },
            { id: -933, flightNo: 'TST933', x: airport.x, y: airport.y, altitude: 500,
                speed: 0, heading: 90, acType: 'B738', flow: 'arrival', clearance: 'land',
                approachType: 'ILS', startTime: 0, landed: false, clearances: [], navMode: 'heading' }
        ];
        const times = [];
        const off = A.bus.on(A.EV.CLOCK_TICK, ({ time }) => times.push(Math.round(time * 100) / 100));
        for (let i = 0; i < frameCount; i++) clock.tickClock(frameDt);
        off();
        const score = A.game.scoring();
        const result = { times, landed: score.landed, separation: score.counts.separation,
            timeline: scoreTimeline(20).map(({ kind, t }) => ({ kind, t })) };
        A.game.end({ reason: '时钟测试' });
        return result;
    };
    const normal = sampleTicks(1, 61, 0.1);
    const medium = sampleTicks(10, 6, 0.1017);
    const fast = sampleTicks(60, 1, 0.1017);
    const out = {
        phase1RateIndependent: normal.times.length === 6
            && JSON.stringify(normal) === JSON.stringify(medium)
            && JSON.stringify(normal) === JSON.stringify(fast)
            && normal.times.every((time, i) => time === i + 1)
            && normal.landed === 1 && normal.separation === 1
    };
    A.game.start({ difficulty: 'standard', seed: 321 });
    st.time = 2599.9;
    st.timeSpeed = 60;
    clock.resetClockAccumulator();
    clock.tickClock(0.1);
    out.phase1MonotonicClock = st.time >= 2600
        && A.game.director().totalSpawned > 0;
    A.game.end({ reason: '时钟测试' });
    st.location = oldLocation;
    return out;
})()`;
const SCRIPT_PHASE2_RULES = `(async () => {
    const A = window.__ATC__;
    const st = A.state;
    const clock = await import('./js/core/clock.js');
    const speedSelect = document.getElementById('speed-select');
    const clearanceToggle = document.getElementById('auto-clearance-toggle');
    st.autoClearance = true;
    st.timeSpeed = 1;
    speedSelect.value = '1';
    A.game.start({ scenarioId: 'l1-approach-basic' });
    const initialSpeed = st.timeSpeed;
    const manualAtStart = !st.autoClearance && clearanceToggle.disabled && !clearanceToggle.checked;
    st.timeSpeed = 60;
    for (let i = 0; i < 10; i++) clock.tickClock(0.1);
    const dir = A.game.director();
    const out = {
        phase2L1Controlled: initialSpeed === 5 && manualAtStart
            && dir.spawned.arrival === 1 && dir.spawned.departure === 0
            && dir.totalSpawned === 1 && A.events.summary().count === 0
    };
    A.game.end({ reason: '教学规则测试' });
    out.phase2PreferencesRestored = st.autoClearance === true && st.timeSpeed === 1
        && !clearanceToggle.disabled && speedSelect.value === '1';
    A.game.start({ scenarioId: 'l2-departure-rush' });
    out.phase2OtherLevelsUntouched = st.autoClearance === true && !clearanceToggle.disabled;
    A.game.end({ reason: '教学规则测试' });
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
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_R1_VERIFY));
        // 阶段十三：空管单位经营（v1.7 M1）——招聘 / 任命 / 培训 / 建设 / 技术 / 合同 / 局方 / 日结算
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_MGMT));
        // 阶段十四：v1.8 M2 —— 事件 / 迁移 / 多机场 / 难度曲线 / 扇区拆分
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_M2));
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
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_PHASE1_RESULTS));
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_PHASE1_CLOCK));
        Object.assign(report, await win.webContents.executeJavaScript(SCRIPT_PHASE2_RULES));
    } catch (e) {
        pageFailures.push(String((e && e.message) || e));
    }

    report.consoleErrors = consoleErrors;
    report.pageFailures = pageFailures;
    /* R1-F：js/** 静态扫描 —— 运行时不得出现网络上报 API（§69 合规边界） */
    try {
        const jsRoot = path.join(APP_ROOT, 'js');
        const netTokens = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource'];
        const hits = [];
        const walkJs = dir => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkJs(full);
                } else if (entry.isFile() && full.endsWith('.js')) {
                    const src = readFileSync(full, 'utf8');
                    for (const token of netTokens) {
                        if (src.includes(token)) hits.push(`${path.relative(APP_ROOT, full)}:${token}`);
                    }
                }
            }
        };
        walkJs(jsRoot);
        report.jsNetworkHits = hits;
        report.jsNetworkFree = hits.length === 0;
    } catch (e) {
        report.jsNetworkFree = false;
        report.jsNetworkScanError = String((e && e.message) || e);
    }

    const checks = [
        ['启动句柄存在', report.bootOk === true],
        ['画布已按容器尺寸初始化', report.canvasSized === true],
        ['启动通话消息已渲染', (report.bootCommMessages ?? 0) >= 4],
        ['第一阶段：沙盒启动可选关并可拖动时间轴', report.phase1SandboxUsable === true],
        ['第一阶段：空机时首次双击航路点有效', report.phase1FirstDblClick === true],
        ['第一阶段：画布外松开结束首次拖拽', report.phase1DragEndsOutside === true],
        ['第一阶段：反复点击后双击只触发一次', report.phase1DblClickOnce === true],
        ['第一阶段：未知呼号零影响且输入保留并提示', report.phase1UnknownTargetRejected === true],
        ['第一阶段：零落地提前结束不得获 S', report.phase1AbandonFair === true],
        ['第一阶段：超时未达标不得获 S', report.phase1TimeoutFair === true],
        ['第一阶段：落地机不参与冲突配对', report.phase1LandedNoConflict === true],
        ['第一阶段：1×/10×/60× 的落地与违规结果一致', report.phase1RateIndependent === true],
        ['第一阶段：游戏时钟跨过显示上限仍继续出流', report.phase1MonotonicClock === true],
        ['第二阶段：L1 手动许可且只生成教学航班', report.phase2L1Controlled === true],
        ['第二阶段：结束 L1 后恢复自动许可与倍率', report.phase2PreferencesRestored === true],
        ['第二阶段：L2 保留现有自动许可规则', report.phase2OtherLevelsUntouched === true],
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
        ['第一阶段：播放中可直接结束班次', report.phase1EndAvailableWhilePlaying === true],
        ['第一阶段：班次暂停后场景仍锁定', report.phase1PausedGameLocked === true],
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
            && report.levelObjectives === '5,6,5' && report.levelEvents === '8,16,11'],
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
        /* ---- 第二批（CCAR-93TM-R6 R1）：席位门槛 / 值班制度 / 疲劳 / 日志字段 ---- */
        ['§47 GND 席位门槛：严格超过 40000 才开席', report.seatGndBoundary === true],
        ['§48 CD 席位门槛：严格超过 100000 才开席', report.seatCdBoundary === true],
        ['§49 进近单位门槛：>36000 独立、≤36000 并入塔台', report.seatAppBoundary === true],
        ['§50 进近分席门槛：>60000 拆 APP-ARR/APP-DEP', report.seatAppSplitBoundary === true],
        ['§47 ILS Ⅱ 类运行强制开放 GND 席', report.seatIlsForcesGnd === true],
        ['§49 独立平行进近追加 NTZ 席位（否则不设）', report.seatNtz === true],
        ['§51 雷达管制席随 radarControl 开关', report.seatRadarOff === true],
        ['席位合并文案含「由 XX 席兼任」', report.seatMergeWord === true],
        ['planSeats 幂等（同输入两次结果一致）', report.seatIdempotent === true],
        ['席位门槛常量与规约一致（40000/100000/36000/60000）', report.seatThresholds === true],
        ['§63 九项工作日志字段齐备', report.logFieldCount === 9 && report.logFieldIds === true],
        ['§63 每个日志字段绑定事件名', report.logFieldEvents === true],
        ['§63 每个日志字段含中文标题', report.logFieldTitles === true],
        ['§123 短班模式为默认回归基线', report.rosterMode === 'short'],
        ['§56 岗前准备五项、逐项 3s、合计 15s', report.prepCount === 5 && report.prepConfirmSec === 3
            && report.prepAllSec === 15 && report.prepPerItem3s === true],
        ['§60 交接班熟悉期 60s', report.familiarizeSec === 60],
        ['§60 交接班检查单七项且各项有权重', report.handoverCount === 7 && report.handoverWeights === true],
        ['§60 特情项权重最大（权重 2）', report.handoverEmergencyWeight === 2 && report.handoverMaxIsEmergency === true],
        ['§128 管制员可随时申报不适合执勤（恒允许）', report.unfitAllowed === true],
        ['§123 超限执勤时强烈建议申报不适合执勤', report.unfitStronglyAdvised === true],
        ['评分新增权重：HANDOVER_MISSED −2 / REST_IGNORED −5 / NOT_FIT_FOR_DUTY +2',
            report.scoreWeights === true],
        ['评分新增计数键：handover / notFit / restIgnored', report.scoreCountKeys === true],
        ['值班面板已挂载（#roster-section/#roster-body）', report.rosterPanelMounted === true],
        ['值班面板渲染岗前准备五项', report.rosterPrepRows === 5],
        ['值班面板渲染交接检查单七项', report.rosterHandoverRows === 7],
        ['「申请不参加本次执勤」按钮可用', report.rosterUnfitBtn === true],
        ['值班面板事件联动刷新不抛错', report.rosterPanelRefreshOk === true],
        /* ---- 第三批（v1.7 M1）：空管单位经营（人事 / 设施 / 技术 / 合同 / 局方 / 日结算） ---- */
        ['经营面板已挂载并渲染概览', report.mgmtPanelMounted === true && (report.mgmtBodyText ?? 0) > 40],
        ['招聘见习/管制员：扣招聘费并计入人员', report.mgmtHireOk === true && report.mgmtHireFeeCharged === true
            && report.mgmtStaffAfterHire === 2],
        ['设施建设经 HUD 读数回显', report.mgmtRoomsAfterBuild === 5 && (report.mgmtHudRoomCount ?? 0) === 5],
        ['建设设施后房间计入维护口径（5 间）', report.mgmtBuildOk === true && report.mgmtRoomsAfterBuild === 5],
        ['见习管制员进入培训', report.mgmtTrainOk === true && (report.mgmtTrainingCount ?? 0) >= 1],
        ['任命管制主管', report.mgmtAppointOk === true && report.mgmtSupervisorCount === 1],
        ['承接航班合同：计入年架次并按日产生收入', report.mgmtSignOk === true && report.mgmtContractCount === 1
            && (report.mgmtRevenue ?? 0) > 0],
        ['技术升级：程序管制 → 监视管制', report.mgmtUpgradeOk === true && report.mgmtTechAfterUpgrade === 'surveillance'],
        ['席位安排：管制员值守已开放席位', report.mgmtAssignOk === true && String(report.mgmtSeatAssigned || '').length > 0],
        ['监视管制下区域现场增开 ACC-RDR 雷达席', report.mgmtRadarSeat === true],
        ['局方实验运行：递交 → 次日批复', report.mgmtTrialOk === true && report.mgmtTrialPending === 'pending'
            && report.mgmtTrialDecided === true],
        ['结束今日：日次 +1 且现金随结算变化', report.mgmtEndDayOk === true && report.mgmtDaySettled === true
            && report.mgmtCashChanged === true],
        ['结束今日写入结算历史', (report.mgmtHistoryDays ?? 0) >= 1],
        ['经营面板渲染员工卡片', report.mgmtStaffRows === 2],
        ['HUD 顶栏显示经营读数（资金/人员/设施）', /万$/.test(String(report.mgmtHudCashText || ''))
            && report.mgmtHudStaffCount === 2 && report.mgmtHudRoomCount === 5],
        /* ---- 第四批（v1.8 M2）：事件引擎 / 存档迁移 / 多机场 / 难度曲线 / 扇区拆分 ---- */
        ['事件图鉴：特情 ≥7 条（含 medical）+ 经营 5 条', report.m2EventsCatalogOk === true],
        ['特情稳定复现（medical → 记录 + EMERGENCY_RAISED）', report.m2TriggerOk === true],
        ['事件快照口径（count/log/spawned）', report.m2SummaryOk === true],
        ['存档迁移 v1→v2 补 M2 字段且不改入参（纯函数）', report.m2MigratePureOk === true],
        ['非法存档回落默认档且每次独立（不共享引用）', report.m2MigrateInvalidOk === true],
        ['多机场焦距：焦点机场与显式编码对齐', report.m2MultiAirportOk === true],
        ['难度曲线随经营天数单调加压', report.m2DifficultyOk === true],
        ['多扇区拆分：进近东西扇 + 区域南北扇（小流量不拆）', report.m2SectorSplitOk === true],
        ['js/** 无网络上报 API（fetch/XHR/SendBeacon/WebSocket/EventSource）', report.jsNetworkFree === true],
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
