/**
 * render/location.js — Endless ATC 位置文件图层（绘制层）
 *
 * 数据源：state.location（domain/locations.js 导入，坐标已是世界坐标 km）。
 * 绘制内容：最低高度区（MVA，圆/多边形 + 英尺标注）、空域边界（多边形或半径圆）、
 * 背景线（[background] 与 [airspace] 的 lineN：coast/airspace/runway 或 RGB）。
 * 未导入位置文件时不绘制任何内容（零开销）。
 */

import { ctx, kmToPxFixed, viewScale } from '../core/viewport.js';
import { state } from '../core/store.js';
import { getAirport } from '../data/airports.js';

const COLOR_BY_NAME = {
    coast: 'rgba(14,116,144,0.55)',
    airspace: 'rgba(37,99,235,0.55)',
    runway: 'rgba(100,116,139,0.75)'
};

/** 背景线颜色：命名色或 'r,g,b' */
function lineColor(color) {
    if (COLOR_BY_NAME[color]) return COLOR_BY_NAME[color];
    const parts = String(color || '').split(',').map(v => parseInt(v, 10));
    if (parts.length === 3 && parts.every(v => Number.isFinite(v))) {
        return `rgba(${parts[0]},${parts[1]},${parts[2]},0.6)`;
    }
    return COLOR_BY_NAME.coast;
}

function tracePath(points, close) {
    ctx.beginPath();
    points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    if (close) ctx.closePath();
}

function strokePolyline(points, color, width, close = false) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width / viewScale;
    tracePath(points, close);
    ctx.stroke();
    ctx.restore();
}

/** 背景线 + 空域边界（在网格之上、航线之下绘制） */
export function drawLocationBackground() {
    const loc = state.location;
    if (!loc) return;

    (loc.airspace && loc.airspace.lines ? loc.airspace.lines : []).forEach(line => {
        strokePolyline(line.points, lineColor(line.color), 1.2);
    });
    (loc.background || []).forEach(line => {
        strokePolyline(line.points, lineColor(line.color), 1.4);
    });

    const boundary = loc.airspace ? loc.airspace.boundary : null;
    if (boundary && boundary.length >= 3) {
        ctx.save();
        ctx.setLineDash([6 / viewScale, 5 / viewScale]);
        strokePolyline(boundary, 'rgba(37,99,235,0.7)', 1.6, true);
        ctx.restore();
    } else if (loc.airspace && loc.airspace.radiusKm) {
        const ap = getAirport(loc.code);
        if (ap) {
            ctx.save();
            ctx.setLineDash([6 / viewScale, 5 / viewScale]);
            ctx.strokeStyle = 'rgba(37,99,235,0.5)';
            ctx.lineWidth = 1.4 / viewScale;
            ctx.beginPath();
            ctx.arc(ap.x, ap.y, kmToPxFixed(loc.airspace.radiusKm), 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }
}

/** 最低高度区（MVA）：可用高度边界，低于该高度进入即为违规（P1 评分接入） */
export function drawRestrictedAreas() {
    const loc = state.location;
    if (!loc || !loc.areas || !loc.areas.length) return;

    loc.areas.forEach(area => {
        ctx.save();
        ctx.strokeStyle = 'rgba(217,119,6,0.85)';
        ctx.fillStyle = 'rgba(217,119,6,0.06)';
        ctx.lineWidth = 1.2 / viewScale;
        ctx.setLineDash([3 / viewScale, 3 / viewScale]);

        if (area.shape === 'polygon' && area.points.length >= 3) {
            tracePath(area.points, true);
        } else {
            const r = kmToPxFixed(area.radiusKm || 5);
            ctx.beginPath();
            ctx.arc(area.x, area.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        const altFt = Math.round(area.altM / 0.3048);
        const lx = area.labelX !== null ? area.labelX : area.x;
        const ly = area.labelY !== null ? area.labelY : area.y;
        ctx.font = `${9 / viewScale}px Consolas`;
        ctx.fillStyle = '#b45309';
        ctx.fillText(`${area.name ? area.name + ' ' : ''}${altFt}ft`, lx + 4 / viewScale, ly);
        ctx.restore();
    });
}