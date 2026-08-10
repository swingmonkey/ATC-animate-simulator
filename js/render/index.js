/**
 * render/index.js — 绘制层总调度（分层 Z 序）
 * 背景 → 网格 → 天气 → 航线 → 点 → 连线 → 告警 → 飞机 → 自由目标 → 预览
 */

import {
    ctx, canvasWidth, canvasHeight, centerX, centerY, viewOffsetX, viewOffsetY, viewScale
} from '../core.js';
import { drawMapBackground, drawGrid, drawWeather, drawWeatherLegend } from './background.js';
import {
    drawRouteSegments, drawRoutePoints, drawConnections, drawConnectionPreview,
    drawDistanceLines, drawMeasuringPreview
} from './routes.js';
import { drawAircraft, drawAircraftWarnings, drawFreeNavTargets } from './aircraft.js';

export { POINT_COLORS, POINT_LABELS } from '../data/waypointTypes.js';
export * from './aircraft.js';
export * from './routes.js';
export * from './background.js';

export function drawRadar() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.save();
    ctx.translate(canvasWidth / 2 + viewOffsetX, canvasHeight / 2 + viewOffsetY);
    ctx.scale(viewScale, viewScale);
    ctx.translate(-centerX, -centerY);

    drawMapBackground();
    drawGrid();
    drawWeather();
    drawRouteSegments();
    drawRoutePoints();
    drawConnections();
    drawDistanceLines();
    drawAircraftWarnings();
    drawAircraft();
    drawFreeNavTargets();
    drawMeasuringPreview();
    drawConnectionPreview();

    ctx.restore();
    drawWeatherLegend();
}

export function drawModeIndicator() {}
