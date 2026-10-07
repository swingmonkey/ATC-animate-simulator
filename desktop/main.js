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

