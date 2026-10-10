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
import { drawAircraft, drawAircraftWarnings, drawFreeNavTargets, drawRadarDragPreview } from './aircraft.js';
import { drawHud } from './hud.js';
import { drawSeatMap } from './seatMaps.js';
import { drawEffects, drawToasts } from './effects.js';
import { state } from '../core/store.js';
import { profileFor } from '../data/viewProfiles.js';
import { stressSummary } from '../game/stress.js';

export function drawRadar() {
    const profile = profileFor(state.activeView);
    /* v2.0：压力「手抖」——整屏轻微抖动（纯画面表现，不影响任何判定） */
    const shaking = stressSummary().level === 'fried';
    ctx.clearRect(-6, -6, canvasWidth + 12, canvasHeight + 12);
    if (shaking) ctx.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
    ctx.save();
    ctx.translate(canvasWidth / 2 + viewOffsetX, canvasHeight / 2 + viewOffsetY);
    ctx.scale(viewScale, viewScale);
    ctx.translate(-centerX, -centerY);

    drawMapBackground(profile);
    drawGrid(profile);
    if (profile.layers.airspace || profile.layers.backgroundLines) drawLocationBackground();
    if (profile.layers.mva) drawRestrictedAreas();
    if (profile.layers.weather) drawWeather();
    if (profile.layers.controlAreas) drawControlAreas();
    drawSeatMap(profile);
    drawAirports(profile);
    if (profile.layers.routes) drawRouteSegments();
    if (profile.layers.routePoints !== 'none') drawRoutePoints(profile);
    drawAircraftWarnings();
    drawAircraft(profile);
    drawFreeNavTargets();
    drawRadarDragPreview();
    drawConnectionPreview();
    drawEffects();                  // v1.9：飘分 + 落地星光（世界坐标）

    ctx.restore();
    drawWeatherLegend();
    drawHud();                     // 屏幕空间 HUD：班次/分数/评级/告警/跑道/字幕
    drawToasts();                  // v1.9：徽章 toast（屏幕坐标）
}
