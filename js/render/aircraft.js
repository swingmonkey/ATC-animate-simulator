/**
 * render/aircraft.js — 飞机、冲突告警、自由导航目标（绘制层）
 *
 * v1.9 宝可梦掌机画风：
 *   · 飞机为「像素小飞机」精灵图（粗描边 + 机身填色 + 座舱亮点），与掌机 RPG 的
 *     俯视小精灵同一观感；常机浅色机身深墨描边，选中/告警/飞越换属性色。
 *   · 数据标牌为「对话框」：米白底、粗墨描边、硬投影、指向飞机的小尾巴。
 */

import {
    ctx, viewScale, kmToPx, pxToKmFixed, getPixelsPerKm
} from '../core/viewport.js';
import { state } from '../core/store.js';
import { acPos, altOf, hdgOf, posX, posY, spdOf } from '../core/accessors.js';
import { isAircraftInConflictAt, getConflictPairs } from '../domain/separation.js';
import { unit } from '../data/atcUnits.js';
import { PLANE_VARIANTS, planeVariantFor } from '../data/sprites.js';
import { cargoOf } from '../game/cargo.js';
import { drawSprite } from './pixel.js';

/* ---------------- 宝可梦画ffect tokens ---------------- */
const PK_INK = '#2b2f4a';
const PK_PAPER = '#fffdf2';
const PK_PAPER_WARM = '#fff6dd';

/** 状态 → 像素机身的属性配色（机身 / 座舱） */
function planePalette(isWarning, isSelected, overflight) {
    if (isWarning) return { body: '#e8503a', glass: '#ffe9e2' };
    if (isSelected) return { body: '#2ba8a0', glass: '#e2f7f4' };
    if (overflight) return { body: '#8878d8', glass: '#efedfc' };
    return { body: '#fffdf2', glass: '#ffe9a8' };
}

/** 画一只像素小飞机：按机型取精灵（窄体/宽体/巨无霸/支线），先描边再填机身 */
function drawPixelPlane(palette, variantKey) {
    const variant = PLANE_VARIANTS[variantKey] || PLANE_VARIANTS.narrow;
    drawSprite(variant.rows, {
        x: 0, y: 0,
        px: 2.4 * variant.scale,
        body: palette.body,
        glass: palette.glass,
        ink: PK_INK
    });
}

/** 圆角矩形路径（老浏览器无 ctx.roundRect 时的兜底） */
function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

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
        const overflight = ac.flow === 'overflight';
        const palette = planePalette(isWarning, isSelected, overflight);
        const variantKey = planeVariantFor(ac.type);

        const trailLengthKm = 5;
        const trailPixels = kmToPx(trailLengthKm);
        const speedKmPerSec = (p.spd * 0.00051444) * 1.852;
        const trailPoints = Math.min(20, Math.max(5, Math.round(trailPixels / (speedKmPerSec * 0.5 * getPixelsPerKm()))));

        if (ac.trail && ac.trail.length > 1) {
            ctx.save();
            ctx.strokeStyle = isSelected ? 'rgba(43,135,130,0.5)' : 'rgba(122,132,160,0.28)';
            ctx.lineWidth = 1.6 / viewScale;
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

        /* ---- 像素小飞机 ---- */
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(headRad);
        ctx.scale(1 / viewScale, 1 / viewScale);
        if (isWarning) { ctx.shadowColor = '#e8503a'; ctx.shadowBlur = 12; }
        else if (isSelected) { ctx.shadowColor = '#2ba8a0'; ctx.shadowBlur = 10; }
        else { ctx.shadowColor = 'rgba(43,47,74,0.25)'; ctx.shadowBlur = 4; }
        drawPixelPlane(palette, variantKey);
        ctx.restore();

        /* ---- 对话框式数据标牌 ---- */
        ctx.save();
        const labelColor = isWarning ? '#a63838' : (isSelected ? '#0c625e' : overflight ? '#4c447f' : PK_INK);
        const bgColor = isWarning ? '#ffe9e2' : (isSelected ? '#e2f7f4' : overflight ? '#efedfc' : PK_PAPER);
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
            ? `R${ac.runway || '--'}  ${ac.taxiway ? `${ac.taxiway}道 ` : ''}${ac.clearance === 'land' ? '落地许可' : ac.clearance === 'takeoff' ? '起飞许可' : groundLabel || '待许可'}`
            : profile.code === 'APP'
                ? `${ac.arrivalOrder ? `#${ac.arrivalOrder} ` : ''}${ac.crossingFix ? `${ac.crossingFix} ${ac.crossingAltM}m` : ac.approachType || '待排序'}`
                : `起 ${ac.departure || '--'} → 到 ${ac.destination || '--'}`;
        const line4 = profile.code === 'ACC'
            ? `${overflight ? '飞越' : ac.flow === 'departure' ? '离港' : '进港'} · ${ac.areaAltitudeLimitM ? `≤${ac.areaAltitudeLimitM}m` : '无限高'} · ${ac.flowSpeedKt ? `${ac.flowSpeedKt}kt` : '无流控'}`
            : null;
        const padX = 7 / viewScale;
        const boxW = Math.max(...[line1, line2, line3, line4].filter(Boolean).map(line => ctx.measureText(line).width)) + padX * 2;
        const boxH = (line4 ? 55 : 43) / viewScale;
        const boxR = 7 / viewScale;

        /* 引线（飞机 → 标牌最近角） */
        const corners = [
            { x: labelX, y: labelY }, { x: labelX + boxW, y: labelY },
            { x: labelX, y: labelY + boxH }, { x: labelX + boxW, y: labelY + boxH }
        ];
        let nearestCorner = corners[0], minDist = Infinity;
        for (const c of corners) {
            const d = Math.sqrt((c.x - p.x) ** 2 + (c.y - p.y) ** 2);
            if (d < minDist) { minDist = d; nearestCorner = c; }
        }
        ctx.strokeStyle = isSelected ? 'rgba(43,135,130,0.55)' : 'rgba(122,132,160,0.4)';
        ctx.lineWidth = 0.8 / viewScale;
        ctx.setLineDash([2 / viewScale, 2 / viewScale]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nearestCorner.x, nearestCorner.y); ctx.stroke();
        ctx.setLineDash([]);

        /* 对话框主体：硬投影 + 粗描边 + 米白底 */
        ctx.save();
        ctx.shadowColor = 'rgba(43,47,74,0.28)';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 2.5 / viewScale;
        ctx.shadowOffsetY = 2.5 / viewScale;
        ctx.fillStyle = bgColor;
        roundRectPath(labelX, labelY, boxW, boxH, boxR);
        ctx.fill();
        ctx.restore();

        /* 指向飞机的对话小尾巴（盒边射线交点处，尖端朝飞机） */
        const tailSize = 5.5 / viewScale;
        const cx = labelX + boxW / 2, cy = labelY + boxH / 2;
        const dx = p.x - cx, dy = p.y - cy;
        const dLen = Math.hypot(dx, dy) || 1;
        const ux = dx / dLen, uy = dy / dLen;
        const sx = dx !== 0 ? (boxW / 2) / Math.abs(dx) : Infinity;
        const sy = dy !== 0 ? (boxH / 2) / Math.abs(dy) : Infinity;
        const edgeS = Math.min(sx, sy);
        const ex = cx + dx * edgeS, ey = cy + dy * edgeS;
        const nxp = -uy, nyp = ux;
        ctx.beginPath();
        ctx.moveTo(ex + ux * tailSize, ey + uy * tailSize);
        ctx.lineTo(ex + nxp * tailSize * 0.72, ey + nyp * tailSize * 0.72);
        ctx.lineTo(ex - nxp * tailSize * 0.72, ey - nyp * tailSize * 0.72);
        ctx.closePath();
        ctx.fillStyle = bgColor;
        ctx.fill();
        ctx.strokeStyle = isWarning ? '#e8503a' : (isSelected ? '#2ba8a0' : overflight ? '#8878d8' : PK_INK);
        ctx.lineWidth = 1.6 / viewScale;
        ctx.stroke();

        ctx.strokeStyle = isWarning ? '#e8503a' : (isSelected ? '#2ba8a0' : overflight ? '#8878d8' : PK_INK);
        ctx.lineWidth = 1.6 / viewScale;
        roundRectPath(labelX, labelY, boxW, boxH, boxR);
        ctx.stroke();

        ctx.fillStyle = labelColor;
        ctx.fillText(line1, labelX + padX, labelY + 14 / viewScale);
        ctx.font = `${9 / viewScale}px Consolas, monospace`;
        ctx.fillStyle = isWarning ? '#a63838' : '#5a6480';
        ctx.fillText(line2, labelX + padX, labelY + 27 / viewScale);
        ctx.fillText(line3, labelX + padX, labelY + 39 / viewScale);
        if (line4) ctx.fillText(line4, labelX + padX, labelY + 51 / viewScale);

        /* 货物徽章（v2.0）：右上角小圆章，一眼看出这架飞机运了什么离谱东西 */
        const cargo = cargoOf(ac);
        if (cargo && cargo.icon) {
            const badgeR = 7.5 / viewScale;
            const bx = labelX + boxW - badgeR * 0.7, by = labelY - badgeR * 0.7;
            ctx.fillStyle = '#f8c848';
            ctx.strokeStyle = PK_INK;
            ctx.lineWidth = 1.4 / viewScale;
            ctx.beginPath();
            ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#fffdf2';
            ctx.beginPath();
            ctx.arc(bx, by, badgeR * 0.42, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = PK_INK;
            ctx.font = `bold ${8 / viewScale}px 'Microsoft YaHei', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(cargo.icon, bx, by + 0.5 / viewScale);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }

        if (isSelected) {
            ctx.strokeStyle = '#2ba8a0';
            ctx.lineWidth = 2 / viewScale;
            ctx.setLineDash([5 / viewScale, 4 / viewScale]);
            ctx.beginPath(); ctx.arc(p.x, p.y, 19 / viewScale, 0, Math.PI * 2); ctx.stroke();
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
        ctx.strokeStyle = `rgba(232,80,58,${alpha})`;
        ctx.lineWidth = 2 / viewScale;
        ctx.setLineDash([4 / viewScale, 3 / viewScale]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        ctx.setLineDash([]);
        const midX = (pa.x + pb.x) / 2, midY = (pa.y + pb.y) / 2;
        ctx.font = `bold ${13 / viewScale}px 'Microsoft YaHei', sans-serif`;
        const text = '间隔不足';
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = `rgba(255,253,242,${Math.min(0.95, alpha + 0.35)})`;
        ctx.strokeStyle = '#e8503a';
        ctx.lineWidth = 1.2 / viewScale;
        roundRectPath(midX - tw / 2 - 4 / viewScale, midY - 16 / viewScale, tw + 8 / viewScale, 15 / viewScale, 4 / viewScale);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#b3271a';
        ctx.textAlign = 'center';
        ctx.fillText(text, midX, midY - 5 / viewScale);
        ctx.textAlign = 'left';
        ctx.restore();
    });
}

export function drawFreeNavTargets() {
    state.aircraft.forEach(ac => {
        if (ac.navMode !== 'free' || ac.targetX === undefined || ac.targetY === undefined) return;
        const p = acPos(ac);
        ctx.save();
        ctx.strokeStyle = '#3556c0';
        ctx.lineWidth = 1.6 / viewScale;
        ctx.setLineDash([5 / viewScale, 4 / viewScale]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ac.targetX, ac.targetY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(53,86,192,0.12)';
        ctx.beginPath(); ctx.arc(ac.targetX, ac.targetY, 9 / viewScale, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#3556c0';
        ctx.lineWidth = 1.8 / viewScale;
        ctx.beginPath(); ctx.arc(ac.targetX, ac.targetY, 9 / viewScale, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#3556c0';
        ctx.beginPath(); ctx.arc(ac.targetX, ac.targetY, 2.4 / viewScale, 0, Math.PI * 2); ctx.fill();
        const distPx = Math.sqrt((ac.targetX - p.x) ** 2 + (ac.targetY - p.y) ** 2);
        const distKm = pxToKmFixed(distPx);
        const midX = (p.x + ac.targetX) / 2, midY = (p.y + ac.targetY) / 2;
        ctx.font = `bold ${8.5 / viewScale}px Consolas, monospace`;
        ctx.fillStyle = PK_PAPER;
        ctx.strokeStyle = 'rgba(53,86,192,0.75)';
        ctx.lineWidth = 0.8 / viewScale;
        const text = `${distKm.toFixed(1)}km`;
        const tw = ctx.measureText(text).width;
        roundRectPath(midX - tw / 2 - 3 / viewScale, midY - 11 / viewScale, tw + 6 / viewScale, 13 / viewScale, 3 / viewScale);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#23398c';
        ctx.textAlign = 'center';
        ctx.fillText(text, midX, midY - 0.5 / viewScale);
        ctx.textAlign = 'left';
        ctx.restore();
    });

    if (state.targetSelectMode && state.tempTargetPoint) {
        const ac = state.aircraft.find(a => a.id === state.targetSelectMode);
        if (ac) {
            const p = acPos(ac);
            ctx.save();
            ctx.strokeStyle = 'rgba(53,86,192,0.5)';
            ctx.lineWidth = 1.4 / viewScale;
            ctx.setLineDash([4 / viewScale, 3 / viewScale]);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(state.tempTargetPoint.x, state.tempTargetPoint.y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(53,86,192,0.25)';
            ctx.beginPath(); ctx.arc(state.tempTargetPoint.x, state.tempTargetPoint.y, 10 / viewScale, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#3556c0';
            ctx.lineWidth = 1.8 / viewScale;
            ctx.beginPath(); ctx.arc(state.tempTargetPoint.x, state.tempTargetPoint.y, 10 / viewScale, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
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
    const color = preview.waypointId !== null ? '#1f8a80' : '#e8503a';
    const label = preview.waypointId !== null ? `直飞 ${preview.waypointName}` : `航向 ${String(preview.heading).padStart(3, '0')}°`;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6 / viewScale;
    ctx.setLineDash([8 / viewScale, 5 / viewScale]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(preview.x, preview.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = 'rgba(43,47,74,0.25)';
    ctx.shadowOffsetX = 2 / viewScale;
    ctx.shadowOffsetY = 2 / viewScale;
    ctx.fillStyle = PK_PAPER;
    ctx.beginPath(); ctx.arc(preview.x, preview.y, 12 / viewScale, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / viewScale;
    ctx.beginPath(); ctx.arc(preview.x, preview.y, 12 / viewScale, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(preview.x, preview.y, 3 / viewScale, 0, Math.PI * 2); ctx.fill();
    ctx.font = `bold ${12 / viewScale}px 'Microsoft YaHei', sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = PK_PAPER;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6 / viewScale;
    roundRectPath(preview.x + 15 / viewScale, preview.y - 11 / viewScale, tw + 14 / viewScale, 24 / viewScale, 6 / viewScale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, preview.x + 22 / viewScale, preview.y + 6 / viewScale);
    ctx.restore();
}
