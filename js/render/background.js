/**
 * render/background.js — 背景、网格、地图底图、天气图层（绘制层）
 *
 * v1.9 宝可梦掌机画风：底图像「掌机大地图」——羊皮纸/草原/雪原的柔和色块 +
 * 确定性像素小景物（树林 / 花丛 / 池塘），随缩放缩放；网格淡到只作距离参考。
 */

import {
    ctx, canvasWidth, canvasHeight, kmToPxFixed, toWorldX, toWorldY, viewScale
} from '../core/viewport.js';
import { state } from '../core/store.js';
import { windAt } from '../weather/weather.js';
import { drawPixelTree, drawPixelHouse } from './pixel.js';

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
    return 'rgba(' + last.c[0] + ',' + last.c[1] + ',' + last.c[2] + ',' + last.a.toFixed(3) + ')';
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

/* ---------------- v1.9：掌机大地图底色与像素小景物 ---------------- */

/** 三张地图的「地貌」底色（掌机大地图：草原 / 湖畔 / 雪原） */
function terrainPalette(profile) {
    if (profile.code === 'TWR') return { base: '#f4ead0', patch: '#ead9b4', patchAlt: '#e6d3a6' };
    if (profile.code === 'ACC') return { base: '#e9e9f6', patch: '#dedef0', patchAlt: '#d6d6ec' };
    return { base: '#e6f3e8', patch: '#d8ecd9', patchAlt: '#d0e8d2' };
}

/** 确定性二维哈希（无随机源，同屏永远一致；重启/缩放不闪烁） */
function hash2(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 圆角小矩形路径（像素景物的柔角） */
function pixelBlob(x, y, w, h, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); }
    else {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    }
    ctx.fill();
}

/** 在可视范围内铺像素小景物（世界坐标网格 + 哈希决定种类，密度低不干扰雷达信息） */
function drawTerrainDecor(profile) {
    const cell = 150;                                  // 世界坐标扫描格
    const x0 = Math.floor(Math.min(toWorldX(0), toWorldX(canvasWidth)) / cell) * cell;
    const x1 = Math.max(toWorldX(0), toWorldX(canvasWidth));
    const y0 = Math.floor(Math.min(toWorldY(0), toWorldY(canvasHeight)) / cell) * cell;
    const y1 = Math.max(toWorldY(0), toWorldY(canvasHeight));
    const u = 1 / viewScale;                           // 屏幕像素 → 世界单位
    const areaTint = profile.code === 'TWR' ? 0.35 : profile.code === 'ACC' ? 0.5 : 0.42;
    ctx.save();
    for (let gx = x0; gx <= x1; gx += cell) {
        for (let gy = y0; gy <= y1; gy += cell) {
            const h = hash2(gx, gy);
            const jx = gx + (hash2(gx + 7, gy) - 0.5) * cell * 0.7;
            const jy = gy + (hash2(gx, gy + 7) - 0.5) * cell * 0.7;
            if (h < 0.16) {
                ctx.globalAlpha = areaTint + 0.35;
                drawPixelTree(jx, jy, 15 * u);
            } else if (h < 0.24) {
                ctx.globalAlpha = areaTint + 0.3;
                pixelFlowers(jx, jy, 10 * u);
            } else if (h < 0.27) {
                ctx.globalAlpha = 0.85;
                pixelPond(jx, jy, 15 * u);
            } else if (h < 0.30) {
                ctx.globalAlpha = areaTint + 0.4;
                drawPixelHouse(jx, jy, 13 * u);
            }
            ctx.globalAlpha = 1;
        }
    }
    ctx.restore();
}

/** 像素花丛：草窝 + 两朵小花 */
function pixelFlowers(x, y, s) {
    pixelBlob(x - s, y - s * 0.35, s * 2, s * 0.7, s * 0.3, '#8fbf6a');
    pixelBlob(x - s * 0.55, y - s * 0.75, s * 0.34, s * 0.34, s * 0.1, '#f2e6a0');
    pixelBlob(x + s * 0.25, y - s * 0.55, s * 0.28, s * 0.28, s * 0.09, '#f0a8b8');
    ctx.fillStyle = '#f7f2d8';
    ctx.fillRect(x - s * 0.47, y - s * 0.67, s * 0.16, s * 0.16);
}

/** 像素池塘：蓝绿水面 + 高光 */
function pixelPond(x, y, s) {
    pixelBlob(x - s * 1.6, y - s * 0.9, s * 3.2, s * 1.8, s * 0.7, '#7cc4d8');
    pixelBlob(x - s * 1.2, y - s * 0.7, s * 2.2, s * 1.1, s * 0.45, '#a5dde8');
    pixelBlob(x - s * 0.9, y - s * 0.55, s * 0.8, s * 0.3, s * 0.12, '#e8f6f8');
}

export function drawMapBackground(profile) {
    const terrain = terrainPalette(profile);
    ctx.fillStyle = terrain.base;
    ctx.fillRect(-10000, -10000, 20000, 20000);

    /* 大色块「地貌补丁」（同哈希，低透明度，给地图掌机式的色块层次） */
    const cell = 300;
    const x0 = Math.floor(Math.min(toWorldX(0), toWorldX(canvasWidth)) / cell) * cell;
    const x1 = Math.max(toWorldX(0), toWorldX(canvasWidth));
    const y0 = Math.floor(Math.min(toWorldY(0), toWorldY(canvasHeight)) / cell) * cell;
    const y1 = Math.max(toWorldY(0), toWorldY(canvasHeight));
    ctx.save();
    for (let gx = x0; gx <= x1; gx += cell) {
        for (let gy = y0; gy <= y1; gy += cell) {
            const h = hash2(gx + 131, gy + 57);
            if (h > 0.42) continue;
            ctx.globalAlpha = 0.5;
            const jx = gx + (hash2(gx + 7, gy) - 0.5) * cell * 0.4;
            const jy = gy + (hash2(gx, gy + 7) - 0.5) * cell * 0.4;
            pixelBlob(jx, jy, cell * 0.72, cell * 0.62, cell * 0.22,
                h > 0.21 ? terrain.patch : terrain.patchAlt);
            ctx.globalAlpha = 1;
        }
    }
    ctx.restore();

    drawTerrainDecor(profile);
}

export function drawGrid(profile) {
    if (!profile.layers.grid) return;
    const step = kmToPxFixed(profile.gridSpacingKm);
    const x0 = Math.min(toWorldX(0), toWorldX(canvasWidth));
    const x1 = Math.max(toWorldX(0), toWorldX(canvasWidth));
    const y0 = Math.min(toWorldY(0), toWorldY(canvasHeight));
    const y1 = Math.max(toWorldY(0), toWorldY(canvasHeight));
    ctx.save();
    ctx.strokeStyle = profile.code === 'TWR' ? 'rgba(154,124,84,0.13)' :
        profile.code === 'ACC' ? 'rgba(96,104,168,0.11)' : 'rgba(80,130,120,0.11)';
    ctx.lineWidth = 0.75 / viewScale;
    ctx.beginPath();
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
        ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
        ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    }
    ctx.stroke();
    ctx.restore();
}

/** 风场箭头（天气开启时叠加） */
function drawWindField() {
    const storm = state.storm;
    if (!storm) return;
    const step = 200;
    const x0 = storm.originX, y0 = storm.originY;
    const x1 = storm.originX + storm.width, y1 = storm.originY + storm.height;
    ctx.lineWidth = 1.2 / viewScale;
    ctx.strokeStyle = 'rgba(43,47,74,0.34)';
    ctx.fillStyle = 'rgba(43,47,74,0.34)';
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

/** 风暴雷达图层：像素积雨云团 + 雨幕 + 雷暴核心标注 + 风场 */
export function drawWeather() {
    const storm = state.storm;
    if (!state.weatherEnabled || !storm) return;
    const cell = storm.cell;

    /* ① 云底：反射率柔边色块（按格填色，边缘格降透明度形成羽化） */
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

    /* ② 像素云团轮廓：强反射格画「团絮」边，让风暴像一朵朵积雨云 */
    ctx.save();
    for (let r = 0; r < storm.rows; r++) {
        for (let c = 0; c < storm.cols; c++) {
            const v = storm.grid[r][c];
            if (v < 0.5) continue;
            const x = storm.originX + c * cell;
            const y = storm.originY + r * cell;
            const heavy = v >= 0.8;
            ctx.fillStyle = heavy ? 'rgba(122,72,140,0.5)' : 'rgba(150,160,180,0.35)';
            // 云团上沿的「团絮」像素簇
            if (r === 0 || storm.grid[r - 1][c] < v - 0.05) {
                ctx.fillRect(x + cell * 0.2, y - cell * 0.16, cell * 0.6, cell * 0.16);
            }
            if (heavy) {
                ctx.fillStyle = 'rgba(96,54,120,0.55)';
                ctx.fillRect(x + cell * 0.1, y + cell * 0.1, cell * 0.8, cell * 0.8);
            }
        }
    }
    ctx.restore();

    /* ③ 雨幕：强降雨格下挂短斜线（动态飘移由帧间重绘自然形成） */
    ctx.save();
    ctx.strokeStyle = 'rgba(120,150,190,0.5)';
    ctx.lineWidth = 1 / viewScale;
    for (let r = 0; r < storm.rows; r++) {
        for (let c = 0; c < storm.cols; c++) {
            if (storm.grid[r][c] < 0.62) continue;
            const x = storm.originX + c * cell;
            const y = storm.originY + r * cell;
            for (let i = 0; i < 3; i++) {
                const rx = x + cell * (0.15 + i * 0.32);
                const ry = y + cell * 0.75 + ((state.time * 24 + i * 37 + r * 11 + c * 7) % Math.round(cell * 0.6));
                ctx.beginPath();
                ctx.moveTo(rx, ry);
                ctx.lineTo(rx - cell * 0.1, ry + cell * 0.22);
                ctx.stroke();
            }
        }
    }
    ctx.restore();

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
                ctx.fillStyle = 'rgba(150,15,15,0.95)';
                ctx.font = `bold ${13 / viewScale}px 'Microsoft YaHei', sans-serif`;
                const tw = ctx.measureText('雷暴').width;
                ctx.fillStyle = 'rgba(255,253,242,0.9)';
                ctx.fillRect(x - tw / 2 - 4 / viewScale, y - 18 / viewScale, tw + 8 / viewScale, 15 / viewScale);
                ctx.strokeStyle = '#b3271a';
                ctx.lineWidth = 1 / viewScale;
                ctx.strokeRect(x - tw / 2 - 4 / viewScale, y - 18 / viewScale, tw + 8 / viewScale, 15 / viewScale);
                ctx.fillStyle = '#b3271a';
                ctx.fillText('雷暴', x, y - 7 / viewScale);
            }
        }
    }
    ctx.textAlign = 'left';

    drawWindField();
}

/** 屏幕空间图例（不受视图变换影响）——宝可梦对话框样式 */
export function drawWeatherLegend() {
    if (!state.weatherEnabled) return;
    const dpr = (typeof devicePixelRatio !== 'undefined') ? devicePixelRatio : 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = 10, y = canvasHeight - 96, w = 150, h = 86;
    ctx.fillStyle = 'rgba(255,253,242,0.96)';
    ctx.strokeStyle = '#2b2f4a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, 9);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#23398c';
    ctx.font = "bold 11px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = 'left';
    ctx.fillText('天气图层', x + 8, y + 15);
    const items = [
        { t: '弱', c: 'rgba(90,200,130,0.95)' },
        { t: '中', c: 'rgba(230,220,70,0.95)' },
        { t: '强', c: 'rgba(235,140,40,0.95)' },
        { t: '雷暴', c: 'rgba(200,40,40,0.98)' }
    ];
    let yy = y + 31;
    for (const it of items) {
        ctx.fillStyle = it.c;
        ctx.fillRect(x + 8, yy - 9, 12, 10);
        ctx.fillStyle = '#3a4160';
        ctx.fillText(it.t, x + 26, yy);
        yy += 14;
    }
    ctx.restore();
}
