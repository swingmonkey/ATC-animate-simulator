/**
 * render/routes.js — 航线、航路点、连线、测量（绘制层）
 */

import {
    state, ctx, kmToPx, pxToKmFixed, viewScale, tempMeasureLine
} from '../core.js';
import { POINT_COLORS, POINT_LABELS } from '../data/waypointTypes.js';
import { pointOnRoute } from '../simulation/geometry.js';

export function drawRouteSegments() {
    state.routes.forEach(route => {
        if (route.points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = route.color || '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(route.points[0].x, route.points[0].y);
        for (let i = 1; i < route.points.length; i++) ctx.lineTo(route.points[i].x, route.points[i].y);
        ctx.stroke();

        ctx.shadowColor = route.color || '#2563eb';
        ctx.shadowBlur = 3;
        ctx.strokeStyle = (route.color || '#2563eb') + '22';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(route.points[0].x, route.points[0].y);
        for (let i = 1; i < route.points.length; i++) ctx.lineTo(route.points[i].x, route.points[i].y);
        ctx.stroke();
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

export function drawRoutePoints() {
    state.routePoints.forEach(pt => {
        const color = POINT_COLORS[pt.type] || POINT_COLORS.normal;
        const isSelected = state.selectedItem && state.selectedItem.type === 'point' && state.selectedItem.id === pt.id;
        const isConnectMode = state.routeConnectMode && state.routeConnectPoints.includes(pt.id);

        ctx.save();
        if (isSelected) { ctx.shadowColor = '#ff6600'; ctx.shadowBlur = 10; }
        ctx.fillStyle = isConnectMode ? '#16a34a' : color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        const r = isSelected ? 8 : 6;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (pt.type !== 'normal') {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 8px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(POINT_LABELS[pt.type] || '', pt.x, pt.y);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }

        ctx.fillStyle = color;
        ctx.font = 'bold 9px Consolas';
        ctx.fillText(pt.name || `P${pt.id}`, pt.x + 8, pt.y - 6);

        if (isSelected) {
            ctx.strokeStyle = '#ff6600';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 11, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();
    });
}

export function drawConnections() {
    state.connections.forEach(conn => {
        const ac1 = state.aircraft.find(a => a.id === conn.from);
        const ac2 = state.aircraft.find(a => a.id === conn.to);
        if (!ac1 || !ac2) return;
        if (state.time < (ac1.startTime || 0) || state.time < (ac2.startTime || 0)) return;
        const x1 = ac1.displayX !== undefined ? ac1.displayX : ac1.x;
        const y1 = ac1.displayY !== undefined ? ac1.displayY : ac1.y;
        const x2 = ac2.displayX !== undefined ? ac2.displayX : ac2.x;
        const y2 = ac2.displayY !== undefined ? ac2.displayY : ac2.y;
        ctx.strokeStyle = 'rgba(234,179,8,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
        const distKm = pxToKmFixed(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)).toFixed(1);
        ctx.fillStyle = 'rgba(234,179,8,0.8)';
        ctx.font = 'bold 9px Consolas';
        ctx.fillText(distKm + 'km', midX + 3, midY - 3);
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

export function drawDistanceLines() {
    state.distanceLines.forEach(line => {
        ctx.strokeStyle = 'rgba(239,68,68,0.6)';
        ctx.lineWidth = 1 / viewScale;
        ctx.setLineDash([5 / viewScale, 3 / viewScale]);
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y1);
        ctx.lineTo(line.x2, line.y2);
        ctx.stroke();
        ctx.setLineDash([]);
        const midX = (line.x1 + line.x2) / 2, midY = (line.y1 + line.y2) / 2;
        const distPx = Math.sqrt((line.x2 - line.x1) ** 2 + (line.y2 - line.y1) ** 2);
        const distKm = pxToKmFixed(distPx).toFixed(1);
        ctx.fillStyle = 'rgba(239,68,68,0.9)';
        ctx.font = `bold ${10 / viewScale}px Consolas`;
        ctx.fillText(distKm + 'km', midX + 4 / viewScale, midY - 4 / viewScale);
    });
}

export function drawMeasuringPreview() {
    if (!tempMeasureLine) return;
    ctx.strokeStyle = 'rgba(239,68,68,0.3)';
    ctx.lineWidth = 1 / viewScale;
    ctx.setLineDash([3 / viewScale, 3 / viewScale]);
    ctx.beginPath();
    ctx.moveTo(tempMeasureLine.x1, tempMeasureLine.y1);
    ctx.lineTo(tempMeasureLine.x2, tempMeasureLine.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    const dx = tempMeasureLine.x2 - tempMeasureLine.x1;
    const dy = tempMeasureLine.y2 - tempMeasureLine.y1;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const distKm = pxToKmFixed(distPx);
    const distNm = distKm / 1.852;
    const bearing = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    const midX = (tempMeasureLine.x1 + tempMeasureLine.x2) / 2;
    const midY = (tempMeasureLine.y1 + tempMeasureLine.y2) / 2;
    ctx.font = `${9 / viewScale}px Consolas`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.5 / viewScale;
    const text = `${distNm.toFixed(1)}nm ${bearing.toFixed(0)}°`;
    const tw = ctx.measureText(text).width;
    ctx.fillRect(midX - tw / 2 - 2 / viewScale, midY - 10 / viewScale, tw + 4 / viewScale, 12 / viewScale);
    ctx.strokeRect(midX - tw / 2 - 2 / viewScale, midY - 10 / viewScale, tw + 4 / viewScale, 12 / viewScale);
    ctx.fillStyle = '#333';
    ctx.fillText(text, midX - tw / 2, midY);
}
