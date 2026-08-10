/**
 * render/background.js — 背景、网格、地图底图、天气图层（绘制层）
 */

import {
    state, ctx, canvasWidth, canvasHeight, getPixelsPerKm, viewScale
} from '../core.js';
import { windAt } from '../weather/weather.js';

/* 反射率色标：晴空→绿→黄→橙→红（类气象雷达），按噪声值平滑插值 */
const REFLECT_STOPS = [
    { t: 0.45, c: [0, 0, 0], a: 0 },
    { t: 0.55, c: [90, 200, 130], a: 0.20 },
    { t: 0.68, c: [230, 220, 70], a: 0.32 },
    { t: 0.82, c: [235, 140, 40], a: 0.46 },
    { t: 0.92, c: [220, 50, 40], a: 0.58 },
    { t: 1.00, c: [150, 20, 30], a: 0.70 }
];

function reflectivityColor(v) {
    if (v <= REFLECT_STOPS[0].t) return null;
    for (let i = 1; i < REFLECT_STOPS.length; i++) {
        const a = REFLECT_STOPS[i - 1], b = REFLECT_STOPS[i];
        if (v <= b.t) {
            const f = (v - a.t) / (b.t - a.t);
            const r = Math.round(a.c[0] + (b.c[0] - a.c[0]) * f);
            const g = Math.round(a.c[1] + (b.c[1] - a.c[1]) * f);
            const bl = Math.round(a.c[2] + (b.c[2] - a.c[2]) * f);
            const al = a.a + (b.a - a.a) * f;
            return 'rgba(' + r + ',' + g + ',' + bl + ',' + al.toFixed(3) + ')';
        }
    }
    const last = REFLECT_STOPS[REFLECT_STOPS.length - 1];
    return 'rgba(' + last.c[0] + ',' + last.c[1] + ',' + last.c[2] + ',' + last.a + ')';
}

function isLocalMax(storm, r, c) {
    const v = storm.grid[r][c];
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr >= storm.rows || cc < 0 || cc >= storm.cols) continue;
            if (storm.grid[rr][cc] > v) return false;
        }
    }
    return true;
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

/** 风场箭头（天气开启时叠加） */
function drawWindField() {
    const storm = state.storm;
    if (!storm) return;
    const step = 200;
    const x0 = storm.originX, y0 = storm.originY;
    const x1 = storm.originX + storm.width, y1 = storm.originY + storm.height;
    ctx.lineWidth = 1 / viewScale;
    ctx.strokeStyle = 'rgba(60,80,110,0.40)';
    ctx.fillStyle = 'rgba(60,80,110,0.40)';
    const ah = 6;
    for (let wx = x0; wx <= x1; wx += step) {
        for (let wy = y0; wy <= y1; wy += step) {
            const w = windAt(wx, wy);
            if (w.spd < 6) continue;
            const len = Math.min(55, 12 + w.spd * 0.4);
            const rad = w.hdg * Math.PI / 180;
            const dx = Math.sin(rad), dy = -Math.cos(rad);
            const ex = wx + dx * len, ey = wy + dy * len;
            ctx.beginPath();
            ctx.moveTo(wx, wy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            // 箭头：端点处的三角
            const p1x = ex - dx * ah + dy * ah * 0.6;
            const p1y = ey - dy * ah - dx * ah * 0.6;
            const p2x = ex - dx * ah - dy * ah * 0.6;
            const p2y = ey - dy * ah + dx * ah * 0.6;
            ctx.beginPath();
            ctx.moveTo(ex, ey); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y);
            ctx.closePath(); ctx.fill();
        }
    }
}

/** 风暴雷达图层：反射率填色 + 雷暴核心描边/标注 + 风场 */
export function drawWeather() {
    const storm = state.storm;
    if (!state.weatherEnabled || !storm) return;
    const cell = storm.cell;

    for (let r = 0; r < storm.rows; r++) {
        for (let c = 0; c < storm.cols; c++) {
            const color = reflectivityColor(storm.grid[r][c]);
            if (!color) continue;
            const x = storm.originX + c * cell;
            const y = storm.originY + r * cell;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, cell + 1, cell + 1);
        }
    }

    ctx.lineWidth = 1 / viewScale;
    ctx.font = (12 / viewScale) + 'px sans-serif';
    ctx.textAlign = 'center';
    for (let r = 0; r < storm.rows; r++) {
        for (let c = 0; c < storm.cols; c++) {
            const v = storm.grid[r][c];
            if (v >= 0.88) {
                const x = storm.originX + c * cell;
                const y = storm.originY + r * cell;
                ctx.strokeStyle = 'rgba(180,30,30,0.55)';
                ctx.strokeRect(x, y, cell + 1, cell + 1);
            }
            if (v >= 0.9 && isLocalMax(storm, r, c)) {
                const x = storm.originX + (c + 0.5) * cell;
                const y = storm.originY + (r + 0.5) * cell;
                ctx.fillStyle = 'rgba(180,20,20,0.92)';
                ctx.fillText('雷暴', x, y);
            }
        }
    }
    ctx.textAlign = 'left';

    drawWindField();
}

/** 屏幕空间图例（不受视图变换影响） */
export function drawWeatherLegend() {
    if (!state.weatherEnabled) return;
    const dpr = (typeof devicePixelRatio !== 'undefined') ? devicePixelRatio : 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = 10, y = canvasHeight - 96, w = 150, h = 86;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('天气图层', x + 8, y + 14);
    const items = [
        { t: '弱', c: 'rgba(90,200,130,0.95)' },
        { t: '中', c: 'rgba(230,220,70,0.95)' },
        { t: '强', c: 'rgba(235,140,40,0.95)' },
        { t: '雷暴', c: 'rgba(200,40,40,0.98)' }
    ];
    let yy = y + 30;
    for (const it of items) {
        ctx.fillStyle = it.c;
        ctx.fillRect(x + 8, yy - 9, 12, 10);
        ctx.fillStyle = '#333';
        ctx.fillText(it.t, x + 26, yy);
        yy += 14;
    }
    ctx.restore();
}
