/**
 * render/index.js — 绘制层总调度（分层 Z 序）
 * 背景 → 网格 → 天气 → 航线 → 点 → 告警 → 飞机 → 自由目标 → 预览
 *
 * 重绘策略见 main.js：播放中每帧绘制；暂停时仅在 eventBus 脏标记置位后绘制。
 */

import {
    ctx, canvasWidth, canvasHeight, centerX, centerY, viewOffsetX, viewOffsetY, viewScale
} from '../core/viewport.js';
import { drawMapBackground, drawGrid, drawWeather, drawWeatherLegend } from './background.js';
import { drawControlAreas, drawAirports } from './airports.js';
import { drawLocationBackground, drawRestrictedAreas } from './location.js';
import {
    drawRouteSegments, drawRoutePoints, drawConnectionPreview
} from './routes.js';
import { drawAircraft, drawAircraftWarnings, drawFreeNavTargets } from './aircraft.js';
import { drawHud } from './hud.js';

export function drawRadar() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.save();
    ctx.translate(canvasWidth / 2 + viewOffsetX, canvasHeight / 2 + viewOffsetY);
    ctx.scale(viewScale, viewScale);
    ctx.translate(-centerX, -centerY);

    drawMapBackground();
    drawGrid();
    drawLocationBackground();      // 位置文件：背景线 + 空域边界
    drawRestrictedAreas();         // 位置文件：最低高度区（MVA）
    drawWeather();
    drawControlAreas();
    drawAirports();
    drawRouteSegments();
    drawRoutePoints();
    drawAircraftWarnings();
    drawAircraft();
    drawFreeNavTargets();
    drawConnectionPreview();

    ctx.restore();
    drawWeatherLegend();
    drawHud();                     // 屏幕空间 HUD：班次/分数/评级/告警/跑道/字幕
}
