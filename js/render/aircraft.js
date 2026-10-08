/**
 * render/aircraft.js — 飞机、冲突告警、自由导航目标（绘制层）
 */

import {
    ctx, viewScale, kmToPx, pxToKmFixed, getPixelsPerKm
} from '../core/viewport.js';
import { state } from '../core/store.js';
import { acPos, altOf, hdgOf, posX, posY, spdOf } from '../core/accessors.js';
import { isAircraftInConflictAt, getConflictPairs } from '../domain/separation.js';
import { unit } from '../data/atcUnits.js';

export function drawAircraft(profile) {
    state.aircraft.forEach(ac => {
        const acStartTime = ac.startTime || 0;
        if (state.time < acStartTime) return;
        if (ac._visible === false) return;

        const p = acPos(ac);
        ctx.save();
        if (!state.selectedItem || state.selectedItem.id !== ac.id) {
            if (ac.unit && !ac.unit.startsWith(profile.code)) ctx.globalAlpha = 0.43;
        }
        const heading = p.hdg;
        const headRad = (heading - 90) * Math.PI / 180;
        const isWarning = isAircraftInConflictAt(p.x, p.y, p.alt, ac.id);
        const isSelected = state.selectedItem && state.selectedItem.type === 'aircraft' && state.selectedItem.id === ac.id;

        const trailLengthKm = 5;
        const trailPixels = kmToPx(trailLengthKm);
        const speedKmPerSec = (p.spd * 0.00051444) * 1.852;
        const trailPoints = Math.min(20, Math.max(5, Math.round(trailPixels / (speedKmPerSec * 0.5 * getPixelsPerKm()))));

        if (ac.trail && ac.trail.length > 1) {
            ctx.save();
            ctx.strokeStyle = isSelected ? 'rgba(24,140,135,0.52)' : 'rgba(83,128,136,0.3)';
            ctx.lineWidth = 1 / viewScale;
            ctx.setLineDash([3 / viewScale, 4 / viewScale]);
            ctx.lineCap = 'round';
            ctx.beginPath();
            const startIdx = Math.max(0, ac.trail.length - trailPoints);
            ctx.moveTo(ac.trail[startIdx].x, ac.trail[startIdx].y);
            for (let i = startIdx + 1; i < ac.trail.length; i++) ctx.lineTo(ac.trail[i].x, ac.trail[i].y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(headRad);
        ctx.scale(1 / viewScale, 1 / viewScale);
        if (isWarning) { ctx.shadowColor = '#d85c51'; ctx.shadowBlur = 14; }
        else if (isSelected) { ctx.shadowColor = '#168c87'; ctx.shadowBlur = 10; }
        else { ctx.shadowColor = '#00000022'; ctx.shadowBlur = 3; }
        ctx.fillStyle = isWarning ? '#d85c51' : (isSelected ? '#168c87' : '#28445a');
        ctx.strokeStyle = isWarning ? '#9e3838' : (isSelected ? '#0c625e' : '#28445a');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(14, 0); ctx.lineTo(-8, -7); ctx.lineTo(-4, 0); ctx.lineTo(-8, 7); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = isWarning ? '#fff1e4' : '#f8e6bc';
        ctx.beginPath(); ctx.arc(-2, 0, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        ctx.save();
        const labelColor = isWarning ? '#a63838' : (isSelected ? '#0c625e' : '#28445a');
        const bgColor = isWarning ? 'rgba(255,229,219,0.96)' : (isSelected ? 'rgba(221,247,234,0.97)' : 'rgba(255,249,233,0.95)');
        const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
        const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;
        const labelX = p.x + labelOffsetX / viewScale, labelY = p.y + labelOffsetY / viewScale;
        ctx.font = `bold ${11 / viewScale}px 'Microsoft YaHei', sans-serif`;
        const line1 = ac.flightNo || `AC${ac.id}`;
        const line2 = profile.code === 'ACC'
            ? `FL${Math.round(p.alt / 30.48)}  ${p.spd}kt`
            : `${p.alt}m  ${p.spd}kt`;
        const seat = unit(ac.unit || 'ACC');
        const groundLabel = { parked: '停机位', pushed: '已推出', started: '已开车', taxi: '滑行中', lineup: '跑道等待' }[ac.groundStage];
        const line3 = ac.landed ? '已落地' : profile.code === 'TWR'
            ? `R${ac.runway || '--'}  ${ac.clearance === 'land' ? '落地许可' : ac.clearance === 'takeoff' ? '起飞许可' : groundLabel || '待许可'}`
            : profile.code === 'APP'
                ? `${ac.arrivalOrder ? `#${ac.arrivalOrder} ` : ''}${ac.crossingFix ? `${ac.crossingFix} ${ac.crossingAltM}m` : ac.approachType || '待排序'}`
                : `${ac.areaAltitudeLimitM ? `≤${ac.areaAltitudeLimitM}m` : '无限高'}  ${ac.flowSpeedKt ? `${ac.flowSpeedKt}kt` : ac.destination || '--'}`;
        const boxW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width, ctx.measureText(line3).width) + 14 / viewScale;
        const boxH = 43 / viewScale;

        const corners = [
            { x: labelX, y: labelY }, { x: labelX + boxW, y: labelY },
            { x: labelX, y: labelY + boxH }, { x: labelX + boxW, y: labelY + boxH }
        ];
        let nearestCorner = corners[0], minDist = Infinity;
        for (const c of corners) {
            const d = Math.sqrt((c.x - p.x) ** 2 + (c.y - p.y) ** 2);
            if (d < minDist) { minDist = d; nearestCorner = c; }
        }
        ctx.strokeStyle = isSelected ? '#168c8788' : 'rgba(83,128,136,0.45)';
        ctx.lineWidth = 0.5 / viewScale;
        ctx.setLineDash([2 / viewScale, 2 / viewScale]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nearestCorner.x, nearestCorner.y); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = bgColor;
        ctx.fillRect(labelX, labelY, boxW, boxH);
        ctx.strokeStyle = isWarning ? '#d85c51' : (isSelected ? '#168c87' : '#6f938a');
        ctx.lineWidth = 1.2 / viewScale;
        ctx.strokeRect(labelX, labelY, boxW, boxH);
        ctx.fillStyle = labelColor;
        ctx.fillText(line1, labelX + 7 / viewScale, labelY + 13 / viewScale);
        ctx.font = `${9 / viewScale}px Consolas, monospace`;
        ctx.fillStyle = isWarning ? '#a63838' : '#557171';
        ctx.fillText(line2, labelX + 7 / viewScale, labelY + 26 / viewScale);
        ctx.fillText(line3, labelX + 7 / viewScale, labelY + 38 / viewScale);

        if (isSelected) {
            ctx.strokeStyle = '#168c87';
            ctx.lineWidth = 1.5 / viewScale;
            ctx.setLineDash([4 / viewScale, 3 / viewScale]);
            ctx.beginPath(); ctx.arc(p.x, p.y, 18 / viewScale, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();
        ctx.restore();
    });
}

export function drawAircraftWarnings() {
    const thresholdPx = kmToPx(state.defaults.minSeparationNm);
    const altThreshold = 300;
    const pairs = getConflictPairs();
    pairs.forEach(([a, b]) => {
        const pa = acPos(a), pb = acPos(b);
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const alpha = Math.max(0.1, 0.5 - dist / thresholdPx * 0.4);
        ctx.save();
        ctx.strokeStyle = `rgba(255,50,50,${alpha})`;
        ctx.lineWidth = 1.5 / viewScale;
        ctx.setLineDash([3 / viewScale, 3 / viewScale]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        ctx.setLineDash([]);
        const midX = (pa.x + pb.x) / 2, midY = (pa.y + pb.y) / 2;
        ctx.fillStyle = `rgba(220,40,40,${alpha + 0.2})`;
        ctx.font = `bold ${14 / viewScale}px Consolas`;
        ctx.fillText('⚠', midX + 2 / viewScale, midY - 3 / viewScale);
        ctx.restore();
    });
}

export function drawFreeNavTargets() {
    state.aircraft.forEach(ac => {
        if (ac.navMode !== 'free' || ac.targetX === undefined || ac.targetY === undefined) return;
        const p = acPos(ac);
        ctx.strokeStyle = '#0369a1';
        ctx.lineWidth = 1 / viewScale;
        ctx.setLineDash([4 / viewScale, 4 / viewScale]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ac.targetX, ac.targetY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(3,105,161,0.15)';
        ctx.beginPath(); ctx.arc(ac.targetX, ac.targetY, 8 / viewScale, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#0369a1';
        ctx.lineWidth = 1.5 / viewScale;
        ctx.beginPath(); ctx.arc(ac.targetX, ac.targetY, 8 / viewScale, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#0369a1';
        ctx.beginPath(); ctx.arc(ac.targetX, ac.targetY, 2 / viewScale, 0, Math.PI * 2); ctx.fill();
        const distPx = Math.sqrt((ac.targetX - p.x) ** 2 + (ac.targetY - p.y) ** 2);
        const distKm = pxToKmFixed(distPx);
        const midX = (p.x + ac.targetX) / 2, midY = (p.y + ac.targetY) / 2;
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
            const p = acPos(ac);
            ctx.strokeStyle = 'rgba(3,105,161,0.5)';
            ctx.lineWidth = 1 / viewScale;
            ctx.setLineDash([3 / viewScale, 3 / viewScale]);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(state.tempTargetPoint.x, state.tempTargetPoint.y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(3,105,161,0.3)';
            ctx.beginPath(); ctx.arc(state.tempTargetPoint.x, state.tempTargetPoint.y, 10 / viewScale, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#0369a1';
            ctx.lineWidth = 1.5 / viewScale;
            ctx.stroke();
        }
    }
}

/** 拖动时显示指令预览；飞机本体不会随鼠标瞬移。 */
export function drawRadarDragPreview() {
    const preview = state.radarDragPreview;
    if (!preview) return;
    const ac = state.aircraft.find(item => item.id === preview.acId);
    if (!ac) return;
    const x = posX(ac), y = posY(ac);
    const color = preview.waypointId !== null ? '#168c87' : '#dc695e';
    const label = preview.waypointId !== null ? `直飞 ${preview.waypointName}` : `航向 ${String(preview.heading).padStart(3, '0')}°`;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 / viewScale;
    ctx.setLineDash([8 / viewScale, 5 / viewScale]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(preview.x, preview.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff7e9';
    ctx.beginPath(); ctx.arc(preview.x, preview.y, 12 / viewScale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(preview.x, preview.y, 12 / viewScale, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `bold ${12 / viewScale}px 'Microsoft YaHei', sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#fff7e9';
    ctx.fillRect(preview.x + 15 / viewScale, preview.y - 10 / viewScale, tw + 14 / viewScale, 24 / viewScale);
    ctx.fillStyle = color;
    ctx.fillText(label, preview.x + 22 / viewScale, preview.y + 6 / viewScale);
    ctx.restore();
}
