/**
 * weather/stormRadar.js — 风暴雷达（天气层）
 * 由 Perlin 噪声场生成风暴网格（危险等级），并提供世界坐标采样。
 * 风暴以「云团」形式在雷达背景平铺，飞机落入高危单元即触发危险判定。
 */

import { octave } from './perlin.js';

export const STORM_LEVELS = [
    { max: 0.45, color: null, label: '无', danger: false },        // 晴空
    { max: 0.60, color: 'rgba(120,200,120,0.18)', label: '弱', danger: false },
    { max: 0.75, color: 'rgba(240,210,80,0.28)', label: '中', danger: false },
    { max: 0.88, color: 'rgba(230,140,40,0.38)', label: '强', danger: true },
    { max: 1.01, color: 'rgba(200,40,40,0.50)', label: '雷暴', danger: true }
];

function levelOf(v) {
    for (const lv of STORM_LEVELS) if (v < lv.max) return lv;
    return STORM_LEVELS[STORM_LEVELS.length - 1];
}

/**
 * 生成风暴场。
 * @param {number} width 世界宽度(km)
 * @param {number} height 世界高度(km)
 * @param {number} cell 单元格边长(km)
 * @param {number} scale 噪声缩放（越小云团越大）
 * @param {number} intensity 整体强度偏移 [0,1]，越大越容易出雷暴
 */
export function generateStorm(width = 1200, height = 1200, cell = 25, scale = 0.006, intensity = 0.5) {
    const cols = Math.ceil(width / cell) + 1;
    const rows = Math.ceil(height / cell) + 1;
    const grid = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            // 椭圆抛物面塑形：中心更可能生成大云团
            const nx = (c / cols - 0.5), ny = (r / rows - 0.5);
            const shape = 1 - (nx * nx + ny * ny) * 1.6;
            let v = octave(c * scale * 60, r * scale * 60, 4, 0.5, 2);
            v = v * shape + (intensity - 0.5) * 0.4;
            v = Math.max(0, Math.min(1, v));
            row.push(v);
        }
        grid.push(row);
    }
    return {
        cols, rows, cell, width, height,
        originX: -width / 2, originY: -height / 2,
        grid,
        generatedAt: Date.now()
    };
}

/** 世界坐标 (x,y) → 风暴等级信息 */
export function sampleStorm(storm, x, y) {
    if (!storm) return STORM_LEVELS[0];
    const c = Math.round((x - storm.originX) / storm.cell);
    const r = Math.round((y - storm.originY) / storm.cell);
    if (r < 0 || r >= storm.rows || c < 0 || c >= storm.cols) return STORM_LEVELS[0];
    return levelOf(storm.grid[r][c]);
}

export function isStormDangerousAt(storm, x, y) {
    return sampleStorm(storm, x, y).danger;
}
