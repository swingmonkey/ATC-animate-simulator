/**
 * core/accessors.js — 飞机显示值访问器（内核层·叶子模块）
 * 收口原先重复 30+ 处的 `displayX !== undefined ? displayX : x` 模式。
 * 约束模型收敛过程中 display* 字段逐步趋近 base 字段，未初始化时回退。
 */

export function posX(ac) { return ac.displayX ?? ac.x; }
export function posY(ac) { return ac.displayY ?? ac.y; }
export function altOf(ac) { return ac.displayAltitude ?? ac.altitude; }
export function spdOf(ac) { return ac.displaySpeed ?? ac.speed; }
export function hdgOf(ac) { return ac.displayHeading ?? (ac.heading || 90); }

/** 当前显示状态快照 {x, y, alt, spd, hdg} */
export function acPos(ac) {
    return {
        x: posX(ac),
        y: posY(ac),
        alt: altOf(ac),
        spd: spdOf(ac),
        hdg: hdgOf(ac)
    };
}

/** 飞机在模拟时间上是否已出现 */
export function isStarted(ac, time) {
    return time >= (ac.startTime || 0);
}