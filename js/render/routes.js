/**
 * render/routes.js — 航线、航路点、连接预览（绘制层）
 * （原 drawConnections/drawDistanceLines/drawMeasuringPreview 已删除：
 *   对应数据源 connections/distanceLines/tempMeasureLine 全库只声明无写入，属死代码）
 */

import {
    ctx, viewScale, pxToKmFixed
} from '../core/viewport.js';
import { state } from '../core/store.js';
import { POINT_COLORS, POINT_LABELS } from '../data/waypointTypes.js';
import { getAirport } from '../data/airports.js';
import { kmToPxFixed } from '../core/viewport.js';

export function drawRouteSegments() {
    state.routes.forEach(route => {
        if (route.points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = route.color || '#168c87';
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2 / viewScale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(route.points[0].x, route.points[0].y);
        for (let i = 1; i < route.points.length; i++) ctx.lineTo(route.points[i].x, route.points[i].y);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.10;
        ctx.strokeStyle = route.color || '#168c87';
        ctx.lineWidth = 6 / viewScale;
        ctx.beginPath();
        ctx.moveTo(route.points[0].x, route.points[0].y);
        for (let i = 1; i < route.points.length; i++) ctx.lineTo(route.points[i].x, route.points[i].y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        for (let i = 1; i < route.points.length; i++) {
            const p1 = route.points[i - 1], p2 = route.points[i];
            const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const segLenKm = pxToKmFixed(Math.sqrt(dx * dx + dy * dy));
            const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
            const headingNorm = heading < 0 ? heading + 360 : heading;
            ctx.fillStyle = 'rgba(60,90,130,0.5)';
            ctx.font = '8px Consolas';
            ctx.fillText(`${Math.round(segLenKm)}km ${Math.round(headingNorm)}°`, midX + 4, midY - 4);
        }

        if (state.selectedItem && state.selectedItem.type === 'route' && state.selectedItem.id === route.id) {
            ctx.strokeStyle = '#ff6600';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(route.points[0].x, route.points[0].y);
            for (let i = 1; i < route.points.length; i++) ctx.lineTo(route.points[i].x, route.points[i].y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();
    });
}

export function drawRoutePoints(profile) {
    const airport = getAirport(state.focusAirport);
    const nearRadius = kmToPxFixed(100);
    state.routePoints.forEach(pt => {
        if (profile?.layers.routePoints === 'near' && airport &&
            Math.hypot(pt.x - airport.x, pt.y - airport.y) > nearRadius) return;
        const color = POINT_COLORS[pt.type] || POINT_COLORS.normal;
        const isSelected = state.selectedItem && state.selectedItem.type === 'point' && state.selectedItem.id === pt.id;
        const isConnectMode = state.routeConnectMode && state.routeConnectPoints.includes(pt.id);

        ctx.save();
        if (isSelected) { ctx.shadowColor = '#ff6600'; ctx.shadowBlur = 10; }
        ctx.fillStyle = isConnectMode ? '#16a34a' : color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / viewScale;
        const r = (isSelected ? 8 : 6) / viewScale;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (pt.type !== 'normal') {
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${8 / viewScale}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(POINT_LABELS[pt.type] || '', pt.x, pt.y);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }

        ctx.fillStyle = color;
        ctx.font = `bold ${9 / viewScale}px Consolas`;
        ctx.fillText(pt.name || `P${pt.id}`, pt.x + 8 / viewScale, pt.y - 6 / viewScale);

        if (isSelected) {
            ctx.strokeStyle = '#ff6600';
            ctx.lineWidth = 1 / viewScale;
            ctx.setLineDash([2 / viewScale, 2 / viewScale]);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 11 / viewScale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();
    });
}

export function drawConnectionPreview() {
    if (!state.routeConnectMode || state.routeConnectPoints.length === 0) return;
    ctx.save();
    ctx.strokeStyle = '#16a34a88';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    let first = true;
    state.routeConnectPoints.forEach(ptId => {
        const pt = state.routePoints.find(p => p.id === ptId);
        if (pt) {
            if (first) { ctx.moveTo(pt.x, pt.y); first = false; }
            else ctx.lineTo(pt.x, pt.y);
        }
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}
