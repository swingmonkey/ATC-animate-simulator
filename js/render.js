/**
 * render.js — 雷达画布渲染
 * 所有 draw* 函数与配色常量。
 */

import {
    state,
    ctx,
    canvasWidth,
    canvasHeight,
    centerX,
    centerY,
    viewScale,
    viewOffsetX,
    viewOffsetY,
    getPixelsPerKm,
    kmToPx,
    pxToKm,
    pxToKmFixed,
} from './core.js';
import {
    isAircraftInConflictAt,
    isAircraftInConflict,
} from './simulation.js';

export const POINT_COLORS = {
    normal: '#2563eb',
    intersection: '#9333ea',
    vor: '#dc2626',
    navaid: '#16a34a',
    reporting: '#ea580c'
};
export const POINT_LABELS = {
    normal: '',
    intersection: '✕',
    vor: '◎',
    navaid: '△',
    reporting: '◇'
};

export function drawRadar() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    ctx.save();
    ctx.translate(canvasWidth / 2 + viewOffsetX, canvasHeight / 2 + viewOffsetY);
    ctx.scale(viewScale, viewScale);
    ctx.translate(-centerX, -centerY);

    drawMapBackground();
    drawGrid();
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

    drawModeIndicator();
}

export function drawMapBackground() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-10000, -10000, 20000, 20000);
}

export function drawGrid() {
    const pixelsPerKm = getPixelsPerKm();
    ctx.strokeStyle = 'rgba(180,190,200,0.2)';
    ctx.lineWidth = 0.5;
    for (let x = -10000; x < 10000; x += pixelsPerKm * 10) {
        ctx.beginPath(); ctx.moveTo(x, -10000); ctx.lineTo(x, 10000); ctx.stroke();
    }
    for (let y = -10000; y < 10000; y += pixelsPerKm * 10) {
        ctx.beginPath(); ctx.moveTo(-10000, y); ctx.lineTo(10000, y); ctx.stroke();
    }
}

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
        if (isSelected) {
            ctx.shadowColor = '#ff6600';
            ctx.shadowBlur = 10;
        }

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

export function drawAircraft() {
    state.aircraft.forEach(ac => {
        const acStartTime = ac.startTime || 0;
        if (state.time < acStartTime) return;
        if (ac._visible === false) return;

        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;
        const heading = ac.displayHeading !== undefined ? ac.displayHeading : (ac.heading || 90);
        const headRad = (heading - 90) * Math.PI / 180;
        const isWarning = isAircraftInConflictAt(x, y, ac.id);
        const isSelected = state.selectedItem && state.selectedItem.type === 'aircraft' && state.selectedItem.id === ac.id;

        const trailLengthKm = 5;
        const trailPixels = kmToPx(trailLengthKm);
        const speedKmPerSec = ((ac.speed || 480) * 0.00051444) * 1.852;
        const trailPoints = Math.min(20, Math.max(5, Math.round(trailPixels / (speedKmPerSec * 0.5 * getPixelsPerKm()))));

        if (ac.trail && ac.trail.length > 1) {
            ctx.save();
            ctx.strokeStyle = isSelected ? 'rgba(0,100,0,0.4)' : 'rgba(100,120,180,0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 4]);
            ctx.lineCap = 'round';
            ctx.beginPath();

            const startIdx = Math.max(0, ac.trail.length - trailPoints);
            ctx.moveTo(ac.trail[startIdx].x, ac.trail[startIdx].y);
            for (let i = startIdx + 1; i < ac.trail.length; i++) {
                ctx.lineTo(ac.trail[i].x, ac.trail[i].y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(headRad);

        if (isWarning) {
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 14;
        } else if (isSelected) {
            ctx.shadowColor = '#006400';
            ctx.shadowBlur = 10;
        } else {
            ctx.shadowColor = '#00000022';
            ctx.shadowBlur = 3;
        }

        ctx.fillStyle = isWarning ? '#ff2222' : (isSelected ? '#006400' : '#1a1a2e');
        ctx.strokeStyle = isWarning ? '#ff6666' : (isSelected ? '#228b22' : '#334155');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, -7);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-8, 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isWarning ? '#ffaaaa' : '#94a3b8';
        ctx.beginPath();
        ctx.arc(-2, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        ctx.save();
        const labelColor = isWarning ? '#ff3333' : (isSelected ? '#006400' : '#16a34a');
        const bgColor = isWarning ? 'rgba(255,0,0,0.15)' : (isSelected ? 'rgba(0,100,0,0.12)' : 'rgba(255,255,255,0.85)');
        const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
        const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;

        const labelX = x + labelOffsetX;
        const labelY = y + labelOffsetY;

        ctx.font = `bold ${10 / viewScale}px Consolas`;
        const line1 = ac.flightNo || `AC${ac.id}`;
        const line2 = `${ac.altitude}m ${ac.speed}kt`;
        const line3 = ac.acType || '';
        const line4 = ac.destination ? `→ ${ac.destination}` : '';
        const lw1 = ctx.measureText(line1).width / viewScale;
        const lw2 = ctx.measureText(line2).width / viewScale;
        const lw3 = ctx.measureText(line3).width / viewScale;
        const lw4 = ctx.measureText(line4).width / viewScale;
        const boxW = Math.max(lw1, lw2, lw3, lw4) + 8 / viewScale;
        const boxH = (line4 ? 54 : 44) / viewScale;

        const corners = [
            { x: labelX, y: labelY },
            { x: labelX + boxW, y: labelY },
            { x: labelX, y: labelY + boxH },
            { x: labelX + boxW, y: labelY + boxH }
        ];
        let nearestCorner = corners[0];
        let minDist = Infinity;
        for (const c of corners) {
            const d = Math.sqrt((c.x - x) ** 2 + (c.y - y) ** 2);
            if (d < minDist) { minDist = d; nearestCorner = c; }
        }

        ctx.strokeStyle = isSelected ? '#00640088' : 'rgba(100,120,180,0.4)';
        ctx.lineWidth = 0.5 / viewScale;
        ctx.setLineDash([2 / viewScale, 2 / viewScale]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nearestCorner.x, nearestCorner.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = bgColor;
        ctx.fillRect(labelX, labelY, boxW, boxH);
        ctx.strokeStyle = isWarning ? '#ff6666' : (isSelected ? '#228b22' : '#64748b');
        ctx.lineWidth = 0.5 / viewScale;
        ctx.strokeRect(labelX, labelY, boxW, boxH);

        ctx.fillStyle = labelColor;
        ctx.fillText(line1, labelX + 3 / viewScale, labelY + 12 / viewScale);
        ctx.font = `${8 / viewScale}px Consolas`;
        ctx.fillStyle = isWarning ? '#ff6666' : (isSelected ? '#228b22' : '#64748b');
        ctx.fillText(line2, labelX + 3 / viewScale, labelY + 24 / viewScale);
        ctx.fillText(line3, labelX + 3 / viewScale, labelY + 36 / viewScale);
        if (line4) ctx.fillText(line4, labelX + 3 / viewScale, labelY + 48 / viewScale);

        if (isSelected) {
            ctx.strokeStyle = '#006400';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.arc(x, y, 18, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();
    });
}

export function drawAircraftWarnings() {
    const thresholdPx = kmToPx(state.defaults.minSeparationNm);
    const altThreshold = 300;
    for (let i = 0; i < state.aircraft.length; i++) {
        for (let j = i + 1; j < state.aircraft.length; j++) {
            const a = state.aircraft[i], b = state.aircraft[j];
            if (state.time < (a.startTime || 0) || state.time < (b.startTime || 0)) continue;
            if (Math.abs(a.altitude - b.altitude) > altThreshold) continue;

            const ax = a.displayX !== undefined ? a.displayX : a.x;
            const ay = a.displayY !== undefined ? a.displayY : a.y;
            const bx = b.displayX !== undefined ? b.displayX : b.x;
            const by = b.displayY !== undefined ? b.displayY : b.y;

            const dx = bx - ax, dy = by - ay;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < thresholdPx) {
                const alpha = Math.max(0.1, 0.5 - dist / thresholdPx * 0.4);
                ctx.save();
                ctx.strokeStyle = `rgba(255,50,50,${alpha})`;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
                ctx.setLineDash([]);
                const midX = (ax + bx) / 2, midY = (ay + by) / 2;
                ctx.fillStyle = `rgba(220,40,40,${alpha + 0.2})`;
                ctx.font = 'bold 9px Consolas';
                ctx.fillText('⚠', midX + 2, midY - 3);
                ctx.restore();
            }
        }
    }
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
        const distKm = pxToKm(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)).toFixed(1);
        ctx.fillStyle = 'rgba(234,179,8,0.8)';
        ctx.font = 'bold 9px Consolas';
        ctx.fillText(distKm + 'km', midX + 3, midY - 3);
    });
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

export function drawFreeNavTargets() {
    state.aircraft.forEach(ac => {
        if (ac.navMode !== 'free' || ac.targetX === undefined || ac.targetY === undefined) return;

        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;

        ctx.strokeStyle = '#0369a1';
        ctx.lineWidth = 1 / viewScale;
        ctx.setLineDash([4 / viewScale, 4 / viewScale]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ac.targetX, ac.targetY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(3,105,161,0.15)';
        ctx.beginPath();
        ctx.arc(ac.targetX, ac.targetY, 8 / viewScale, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#0369a1';
        ctx.lineWidth = 1.5 / viewScale;
        ctx.beginPath();
        ctx.arc(ac.targetX, ac.targetY, 8 / viewScale, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#0369a1';
        ctx.beginPath();
        ctx.arc(ac.targetX, ac.targetY, 2 / viewScale, 0, Math.PI * 2);
        ctx.fill();

        const distPx = Math.sqrt((ac.targetX - x) ** 2 + (ac.targetY - y) ** 2);
        const distKm = pxToKmFixed(distPx);
        const midX = (x + ac.targetX) / 2;
        const midY = (y + ac.targetY) / 2;

        ctx.font = `${8 / viewScale}px Consolas`;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeStyle = 'rgba(3,105,161,0.7)';
        ctx.lineWidth = 0.4 / viewScale;
        const text = `${distKm.toFixed(1)}km`;
        const tw = ctx.measureText(text).width;
        ctx.fillRect(midX - tw / 2 - 2 / viewScale, midY - 10 / viewScale, tw + 4 / viewScale, 11 / viewScale);
        ctx.strokeRect(midX - tw / 2 - 2 / viewScale, midY - 10 / viewScale, tw + 4 / viewScale, 11 / viewScale);
        ctx.fillStyle = '#0369a1';
        ctx.fillText(text, midX - tw / 2, midY);
    });

    if (state.targetSelectMode && state.tempTargetPoint) {
        const ac = state.aircraft.find(a => a.id === state.targetSelectMode);
        if (ac) {
            const x = ac.displayX !== undefined ? ac.displayX : ac.x;
            const y = ac.displayY !== undefined ? ac.displayY : ac.y;

            ctx.strokeStyle = 'rgba(3,105,161,0.5)';
            ctx.lineWidth = 1 / viewScale;
            ctx.setLineDash([3 / viewScale, 3 / viewScale]);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(state.tempTargetPoint.x, state.tempTargetPoint.y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = 'rgba(3,105,161,0.3)';
            ctx.beginPath();
            ctx.arc(state.tempTargetPoint.x, state.tempTargetPoint.y, 10 / viewScale, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#0369a1';
            ctx.lineWidth = 1.5 / viewScale;
            ctx.stroke();
        }
    }
}

export function drawModeIndicator() {}
