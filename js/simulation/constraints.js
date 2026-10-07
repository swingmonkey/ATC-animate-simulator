/**
 * simulation/constraints.js — 约束原语（模拟层·叶子模块）
 *
 * 约束模型：目标值 altCon/spdCon/hdgCon + 施加时刻 constraintTime + 施加瞬间基准值 base。
 * 运动学按 (targetTime - constraintTime) 确定性收敛（见 motion.js）。
 * 独立成叶子模块的原因：motion.js（收敛计算）与 units.js（塔台/进近许可）都要写入约束，
 * 若原语留在 motion.js 会形成 motion ⇄ units 循环依赖。
 */

import { state } from '../core/store.js';

export function setAltitudeConstraint(ac, targetAlt, t) {
    ac.altBase = ac.displayAltitude ?? ac.altitude;
    ac.altCon = targetAlt;
    ac.constraintTime = t ?? state.time;
}

export function setSpeedConstraint(ac, targetSpd, t) {
    ac.spdBase = ac.displaySpeed ?? ac.speed;
    ac.spdCon = targetSpd;
    ac.constraintTime = t ?? state.time;
}

export function setHeadingConstraint(ac, targetHdg, t) {
    ac.hdgBase = ac.displayHeading ?? (ac.heading || 90);
    ac.hdgCon = ((targetHdg % 360) + 360) % 360;
    ac.constraintTime = t ?? state.time;
}
