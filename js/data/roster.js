/**
 * data/roster.js — 值班与疲劳参数（数据层·只读常量）
 *
 * 对齐 CCAR-93TM-R6 §123–§128 的压缩示意值；所有值均可调，业务逻辑不得硬编码。
 * mode:'short' 为默认回归保护：短班模式沿用 v1.6 的"直接执勤"行为。
 */

export const ROSTER = Object.freeze({
    mode: 'short',                        // 'short'（现状，单班剧情）| 'full'（整班制度）
    shiftMode: 'single',                  // 'single' | 'weekly'
    dutySecMax: 3600,                     // ① 连续执勤上限 → 60 min
    dutyExtendedThresholdSec: 2400,       // ② 超过则必须先休息
    dutyExtendedRestSec: 300,             // ② 强制休息时长 → 5 min
    weekDutySecMax: 10800,                // ③ 周一班累计 → 180 min
    positionSecMax: 1800,                 // ④ 管制席连续岗位执勤 → 30 min
    radarRotationSec: 120,                // ④ 雷达管制连续岗位执勤 → 2 min
    radarBreakMinSec: 30,                 // ④ 两次岗位执勤间隔 → 30 s
    weeklyRest: true,                     // ⑤ 播报而非空档
    annualRest: true,                     // ⑥ 叙事 / 成就
    fatiguePerDutySec: 1 / 3600           // 疲劳增长斜率（示意）
});

/** 整班模式才启用的强制制度；短班模式保留既有行为。 */
export function isFullDutyMode(roster = ROSTER) {
    return roster.mode === 'full';
}
