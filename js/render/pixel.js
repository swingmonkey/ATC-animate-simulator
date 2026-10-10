/**
 * render/pixel.js — 像素精灵绘制器（绘制层工具）
 *
 * 把「字符矩阵素材」（data/sprites.js）画成掌机 RPG 的粗描边小精灵：
 *   ① 每个实心像素外扩描边（墨色）
 *   ② 填机身色
 *   ③ 'o' 像素填座舱亮色
 * 全部在世界坐标系内绘制，线宽随缩放恒定为屏幕像素，缩放地图不失真。
 */

import { ctx, viewScale } from '../core/viewport.js';

const PK_INK = '#2b2f4a';

/**
 * 画一个字符矩阵精灵。
 * @param {string[]} rows 素材矩阵（'X' 主体 / 'o' 亮像素 / 其他镂空）
 * @param {{x:number, y:number, px:number, body:string, glass:string, ink?:string, angle?:number}} opts
 *   x/y 世界锚点（精灵中心）；px 单像素边长（屏幕像素）；angle 弧度旋转（默认机头朝右即 heading 约定）
 */
export function drawSprite(rows, opts) {
    const { x, y, px, body, glass } = opts;
    const ink = opts.ink || PK_INK;
    const cols = Math.max(...rows.map(r => r.length));
    const originX = x - (cols * px) / 2;
    const originY = y - (rows.length * px) / 2;

    ctx.save();
    if (opts.angle) {
        ctx.translate(x, y);
        ctx.rotate(opts.angle);
        ctx.translate(-x, -y);
    }

    // ① 描边：每个实心像素铺一圈略大的墨块（矩阵膨胀近似）
    ctx.fillStyle = ink;
    const outline = Math.max(0.9, px * 0.34);
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            if (rows[r][c] === '.') continue;
            ctx.fillRect(originX + c * px - outline, originY + r * px - outline,
                px + outline * 2, px + outline * 2);
        }
    }
    // ② 机身
    ctx.fillStyle = body;
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            if (rows[r][c] === '.') continue;
            ctx.fillRect(originX + c * px, originY + r * px, px, px);
        }
    }
    // ③ 座舱亮像素
    if (glass) {
        ctx.fillStyle = glass;
        for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < rows[r].length; c++) {
                if (rows[r][c] !== 'o') continue;
                ctx.fillRect(originX + c * px, originY + r * px, px, px);
            }
        }
    }
    ctx.restore();
}

/** 屏幕像素 → 世界单位（世界矩阵内绘制时用） */
export function pxToWorld(px) { return px / viewScale; }

/**
 * 像素小树（地物装饰）。
 * @param {number} x 世界 x
 * @param {number} y 世界 y（树根中心）
 * @param {number} size 树冠宽（世界单位）
 */
export function drawPixelTree(x, y, size) {
    const trunkW = Math.max(1.2 * (size / 7), 0.9);
    ctx.save();
    ctx.fillStyle = '#8a5a32';
    ctx.fillRect(x - trunkW / 2, y - size * 0.1, trunkW, size * 0.55);
    ctx.fillStyle = '#3f8f4e';
    ctx.beginPath();
    ctx.arc(x, y - size * 0.55, size * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#57aa5f';
    ctx.beginPath();
    ctx.arc(x - size * 0.18, y - size * 0.72, size * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/**
 * 像素小房子（区域地图民房）。
 * @param {number} x 屋顶中心世界 x
 * @param {number} y 屋顶中心世界 y
 * @param {number} size 房屋宽（世界单位）
 */
export function drawPixelHouse(x, y, size) {
    const w = size, h = size * 0.8;
    ctx.save();
    ctx.fillStyle = '#e8d8b8';
    ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = '#c96a4a';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.62, y);
    ctx.lineTo(x, y - h * 0.62);
    ctx.lineTo(x + w * 0.62, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8a6a48';
    ctx.fillRect(x - w * 0.11, y + h * 0.42, w * 0.22, h * 0.58);
    ctx.restore();
}

/**
 * 像素控制塔（焦点机场地物）。
 * @param {number} x 世界 x
 * @param {number} y 世界 y（塔基）
 * @param {number} h 塔身高（世界单位）
 */
export function drawPixelTower(x, y, h) {
    const w = Math.max(h * 0.14, 1.5);
    ctx.save();
    // 塔身（下宽上窄）
    ctx.fillStyle = '#d8d8d0';
    ctx.strokeStyle = PK_INK;
    ctx.lineWidth = Math.max(0.8, h * 0.035) / viewScale;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.7, y);
    ctx.lineTo(x - w * 0.4, y - h * 0.72);
    ctx.lineTo(x + w * 0.4, y - h * 0.72);
    ctx.lineTo(x + w * 0.7, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 瞭望台（玻璃舱）
    const cabW = h * 0.52, cabH = h * 0.3, cabY = y - h * 1.0;
    ctx.fillStyle = '#8ed0e8';
    ctx.strokeRect(x - cabW / 2, cabY, cabW, cabH);
    ctx.fillRect(x - cabW / 2, cabY, cabW, cabH);
    ctx.fillStyle = '#c9ecf8';
    ctx.fillRect(x - cabW / 2 + cabW * 0.12, cabY + cabH * 0.22, cabW * 0.76, cabH * 0.4);
    // 顶盖 + 雷达罩
    ctx.fillStyle = '#46576d';
    ctx.fillRect(x - cabW * 0.56, cabY - cabH * 0.32, cabW * 1.12, cabH * 0.3);
    ctx.beginPath();
    ctx.arc(x, cabY - cabH * 0.5, cabW * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** 风向袋（塔台图：指示当前风向） */
export function drawPixelWindsock(x, y, size) {
    ctx.save();
    ctx.strokeStyle = PK_INK;
    ctx.lineWidth = Math.max(0.8, size * 0.07) / viewScale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - size * 1.5);
    ctx.stroke();
    ctx.fillStyle = '#e8503a';
    ctx.strokeRect(x - size * 0.3, y - size * 1.72, size * 0.95, size * 0.42);
    ctx.fillRect(x - size * 0.3, y - size * 1.72, size * 0.95, size * 0.42);
    ctx.fillStyle = '#fffdf2';
    ctx.fillRect(x - size * 0.3, y - size * 1.72, size * 0.25, size * 0.42);
    ctx.restore();
}
