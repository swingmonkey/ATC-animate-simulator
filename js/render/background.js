/**
 * render/background.js — 背景、网格、地图底图（绘制层）
 */

import {
    state, ctx, canvasWidth, canvasHeight, getPixelsPerKm
} from '../core.js';
import { sampleStorm, STORM_LEVELS } from '../weather/weather.js';

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

/** 风暴雷达图层：在已变换坐标系中按世界坐标平铺颜色单元 */
export function drawWeather() {
    const storm = state.storm;
    if (!state.weatherEnabled || !storm) return;
    for (let r = 0; r < storm.rows; r++) {
        for (let c = 0; c < storm.cols; c++) {
            const v = storm.grid[r][c];
            let color = null;
            for (const lv of STORM_LEVELS) { if (v < lv.max) { color = lv.color; break; } }
            if (!color) continue;
            const x = storm.originX + c * storm.cell;
            const y = storm.originY + r * storm.cell;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, storm.cell + 1, storm.cell + 1);
        }
    }
}
