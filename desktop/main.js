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

