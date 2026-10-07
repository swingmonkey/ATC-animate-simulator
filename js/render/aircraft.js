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

export function drawAircraft() {
    state.aircraft.forEach(ac => {
        const acStartTime = ac.startTime || 0;
        if (state.time < acStartTime) return;
        if (ac._visible === false) return;

        const p = acPos(ac);
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
            ctx.strokeStyle = isSelected ? 'rgba(0,100,0,0.4)' : 'rgba(100,120,180,0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 4]);
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
        if (isWarning) { ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 14; }
        else if (isSelected) { ctx.shadowColor = '#006400'; ctx.shadowBlur = 10; }
        else { ctx.shadowColor = '#00000022'; ctx.shadowBlur = 3; }
        ctx.fillStyle = isWarning ? '#ff2222' : (isSelected ? '#006400' : '#1a1a2e');
        ctx.strokeStyle = isWarning ? '#ff6666' : (isSelected ? '#228b22' : '#334155');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(14, 0); ctx.lineTo(-8, -7); ctx.lineTo(-4, 0); ctx.lineTo(-8, 7); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = isWarning ? '#ffaaaa' : '#94a3b8';
        ctx.beginPath(); ctx.arc(-2, 0, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        ctx.save();
        const labelColor = isWarning ? '#ff3333' : (isSelected ? '#006400' : '#16a34a');
        const bgColor = isWarning ? 'rgba(255,0,0,0.15)' : (isSelected ? 'rgba(0,100,0,0.12)' : 'rgba(255,255,255,0.85)');
        const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
        const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;
        const labelX = p.x + labelOffsetX, labelY = p.y + labelOffsetY;
        ctx.font = `bold ${10 / viewScale}px Consolas`;
        const line1 = ac.flightNo || `AC${ac.id}`;
        const line2 = `${p.alt}m ${p.spd}kt`;
        const line3 = ac.acType || '';
        const line4 = ac.destination ? `→ ${ac.destination}` : '';
        // 第 5 行：管制席位 + 跑道 + 进近方式（塔台/进近管制内容在雷达标签上的体现）
        const seat = unit(ac.unit || 'ACC');
        const line5 = ac.landed
            ? '已落地'
            : `${seat.short}${ac.runway ? ` R${ac.runway}` : ''}${ac.approachType ? ` ${ac.approachType}` : ''}`;
        const boxW = Math.max(
            ctx.measureText(line1).width, ctx.measureText(line2).width,
            ctx.measureText(line3).width, ctx.measureText(line4).width,
            ctx.measureText(line5).width
        ) / viewScale + 8 / viewScale;
        const boxH = (line5 ? 66 : (line4 ? 54 : 44)) / viewScale;

        const corners = [
            { x: labelX, y: labelY }, { x: labelX + boxW, y: labelY },
            { x: labelX, y: labelY + boxH }, { x: labelX + boxW, y: labelY + boxH }
        ];
        let nearestCorner = corners[0], minDist = Infinity;
        for (const c of corners) {
            const d = Math.sqrt((c.x - p.x) ** 2 + (c.y - p.y) ** 2);
            if (d < minDist) { minDist = d; nearestCorner = c; }
        }
        ctx.strokeStyle = isSelected ? '#00640088' : 'rgba(100,120,180,0.4)';
        ctx.lineWidth = 0.5 / viewScale;
        ctx.setLineDash([2 / viewScale, 2 / viewScale]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nearestCorner.x, nearestCorner.y); ctx.stroke();
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
        if (line5) {
            ctx.font = `bold ${8 / viewScale}px Consolas`;
            ctx.fillStyle = ac.landed ? '#94a3b8' : seat.color;
            ctx.fillText(line5, labelX + 3 / viewScale, labelY + (line4 ? 60 : 48) / viewScale);
        }

        if (isSelected) {
            ctx.strokeStyle = '#006400';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 2]);
            ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }
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
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        ctx.setLineDash([]);
        const midX = (pa.x + pb.x) / 2, midY = (pa.y + pb.y) / 2;
        ctx.fillStyle = `rgba(220,40,40,${alpha + 0.2})`;
        ctx.font = 'bold 9px Consolas';
        ctx.fillText('⚠', midX + 2, midY - 3);
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
