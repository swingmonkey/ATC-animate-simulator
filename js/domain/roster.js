/**
 * domain/roster.js — 岗前准备与值班适合性（领域层·纯函数）
 *
 * 对齐 CCAR-93TM-R6 §55–§61（岗前准备 / 交接班）与 §123–§128（执勤 / 疲劳 / 不适合执勤）：
 *   · prepChecklist(state) —— §56 岗前准备五项，逐项确认（默认 3 s/项，支持一键确认）；
 *   · canReportUnfit(state) —— §126/§128 不适合执勤判定：**任何情况下都允许主动报告**，
 *     连续执勤超限 / 疲劳达阈值时给出「强烈建议」。
 *
 * 关键约定：
 *   · 所有时长/斜率取自 data/roster.js 的 ROSTER，业务逻辑不得硬编码；
 *   · 本模块只做纯计算，不读 DOM、不发事件、不改世界；
 *   · state 可能缺少 equipment / dutySec / fatigue 字段（现状存档即如此），一律走可选链 + 默认值，
 *     **不把 undefined 当成异常**。
 *
 * 依赖方向：data(1) 可向下引用；同层模块；无副作用、可复现。
 */

import { ROSTER } from '../data/roster.js';

/** 岗前准备每一项的默认确认时长（秒）——与 ROSTER 无关，属交互节奏。 */
export const PREP_CONFIRM_SEC = 3;

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 天气趋势子句：从 state 派生（无字段时视为平稳）。 */
function weatherTrend(state) {
    const t = num(state?.time);
    if (state?.weatherEnabled) {
        return state?.storm
            ? `雷雨/强对流活动，趋势转差（t≈${Math.round(t)}s）`
            : '有天气图数据，趋势平稳（t≈' + Math.round(t) + 's）';
    }
    return '暂无危险天气，趋势平稳';
}

/** 设备三态子句：state 无 equipment 字段时的兜底（雷达 / 通信 / 进程单）。 */
function equipmentStates(state) {
    const eq = state?.equipment || {};
    const dflt = '正常';
    return {
        radar: eq.radar || (state?.storm ? '降级' : dflt),
        comm: eq.comm || dflt,
        strip: eq.strip || dflt
    };
}

/**
 * §56 岗前准备清单（五项）。
 * @param {object} [state] 全局状态（可缺字段）
 * @returns {{mode:string, confirmSec:number, allSec:number, items:Array<{id,index,title,detail,confirmSec}>}}
 */
export function prepChecklist(state = {}) {
    const eq = equipmentStates(state);
    const items = [
        {
            id: 'self',
            index: 1,
            title: '身心与技术状态',
            detail: '身体 / 思想 / 技术状态正常，班组资源（人手 / 资历）已到位',
            confirmSec: PREP_CONFIRM_SEC
        },
        {
            id: 'weather',
            index: 2,
            title: '天气趋势',
            detail: weatherTrend(state),
            confirmSec: PREP_CONFIRM_SEC
        },
        {
            id: 'flow',
            index: 3,
            title: '空域与流量',
            detail: '空域限制 / 流量情况 / 交通态势已掌握',
            confirmSec: PREP_CONFIRM_SEC
        },
        {
            id: 'equipment',
            index: 4,
            title: '设备三态',
            detail: `雷达 ${eq.radar} · 通信 ${eq.comm} · 进程单 ${eq.strip}`,
            confirmSec: PREP_CONFIRM_SEC
        },
        {
            id: 'notice',
            index: 5,
            title: '值班注意事项',
            detail: '当值班组的注意事项 / 临时限制 / 移交事项已确认',
            confirmSec: PREP_CONFIRM_SEC
        }
    ];
    return {
        mode: ROSTER.mode,
        confirmSec: PREP_CONFIRM_SEC,
        allSec: PREP_CONFIRM_SEC * items.length,
        items
    };
}

/**
 * §126/§128 不适合执勤判定。
 * 报告不适合执勤是管制员的正当权利（§128），因此 allowed 恒为 true；
 * 连续执勤超过 ROSTER 阈值或疲劳达阈值时以 stronglyAdvised 提示「强烈建议报告」。
 * @param {object} [state] 全局状态（可缺 dutySec / fatigue）
 * @returns {{allowed:boolean, stronglyAdvised:boolean, dutySec:number, fatigue:number, thresholds:object, reason:string}}
 */
export function canReportUnfit(state = {}) {
    const roster = ROSTER;
    const dutySec = num(state?.dutySec);
    const fatigue = Number.isFinite(Number(state?.fatigue))
        ? Number(state.fatigue)
        : dutySec * roster.fatiguePerDutySec;

    const overAbsolute = dutySec > roster.dutySecMax;
    const overExtend = dutySec > roster.dutyExtendedThresholdSec;
    const tired = fatigue >= 1;

    let reason;
    if (overAbsolute) {
        reason = `连续执勤 ${Math.round(dutySec)}s 已超过上限 ${roster.dutySecMax}s（§123），必须休息`;
    } else if (overExtend) {
        reason = `连续执勤 ${Math.round(dutySec)}s 超过延长阈值 ${roster.dutyExtendedThresholdSec}s，`
            + `应先强制休息 ${roster.dutyExtendedRestSec}s（§124/§125）`;
    } else if (tired) {
        reason = `疲劳度 ${Math.round(fatigue * 100) / 100} 已达阈值（§128），建议报告不适合执勤`;
    } else {
        reason = '当前状态适合继续执勤（§128：管制员仍可随时主动报告不适合执勤）';
    }

    return {
        allowed: true,
        stronglyAdvised: overAbsolute || overExtend || tired,
        dutySec,
        fatigue: Math.round(fatigue * 100) / 100,
        thresholds: {
            dutySecMax: roster.dutySecMax,
            dutyExtendedThresholdSec: roster.dutyExtendedThresholdSec,
            dutyExtendedRestSec: roster.dutyExtendedRestSec,
            fatiguePerDutySec: roster.fatiguePerDutySec
        },
        reason
    };
}