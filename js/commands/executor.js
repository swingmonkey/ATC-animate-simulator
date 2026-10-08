/**
 * commands/executor.js — 指令执行（指令层）
 * 将 parser 解析出的结构化指令施加到飞机（约束模型）。不依赖 UI 层，避免循环依赖。
 * 返回受影响飞机数量；通话播报通过 store.addComm（事件驱动，UI 自动追加 DOM）。
 */

import { state, addComm } from '../core/store.js';
import {
    setAltitudeConstraint, setSpeedConstraint, setHeadingConstraint
} from '../simulation/motion.js';
import { altOf, spdOf, hdgOf } from '../core/accessors.js';
import {
    ALT_MIN, ALT_MAX, SPD_MIN, SPD_MAX, EXPEDITE_BONUS, GOAROUND_ALT
} from '../core/constants.js';
import { parseCommand, hasActions } from './parser.js';
import {
    issueApproachClearance, issueLandingClearance, issueTakeoffClearance,
    assignRunwayClearance, markGoAround
} from '../domain/clearances.js';
import { handoffAircraft } from '../domain/airspace.js';
import { makeReadback, resolveReadback } from '../domain/readback.js';
import { unitLabel } from '../data/atcUnits.js';

/** 定向指令最多为几架生成复诵（避免广播时刷屏；广播指令由机组按需复诵） */
const READBACK_MAX_TARGETS = 3;

function findWaypointByName(name) {
    const n = (name || '').toLowerCase();
    return state.routePoints.find(p => (p.name || '').toLowerCase() === n) || null;
}

/** 可指令高度下限/上限（m）：导入 Endless ATC 位置文件后由 floor / above 改写 */
function altFloorM() { return state.defaults.altMinM || ALT_MIN; }
function altCeilingM() { return state.defaults.altMaxM || ALT_MAX; }

/**
 * @param {string} text 原始指令文本
 * @returns {{ok:boolean, affected:number, message:string}}
 */
export function executeCommand(text) {
    const callsigns = state.aircraft.map(a => a.flightNo);
    const parsed = parseCommand(text, callsigns);
    if (!hasActions(parsed)) {
        return { ok: false, affected: 0, message: '无法识别的指令' };
    }

    let targets = state.aircraft;
    let targetLabel = '全体';
    if (parsed.target) {
        const t = state.aircraft.find(a => a.flightNo.toUpperCase() === parsed.target.toUpperCase());
        if (t) { targets = [t]; targetLabel = t.flightNo; }
        else { return { ok: false, affected: 0, message: `未找到航班 ${parsed.target}` }; }
    }

    let affected = 0;
    const applied = [];
    for (const ac of targets) {
        if (state.time < (ac.startTime || 0)) continue;
        for (const act of parsed.actions) {
            switch (act.type) {
                case 'alt':
                    setAltitudeConstraint(ac, Math.max(altFloorM(), Math.min(altCeilingM(), act.value)));
                    break;
                case 'climb':
                    setAltitudeConstraint(ac, act.absolute
                        ? Math.min(altCeilingM(), act.value)
                        : Math.min(altCeilingM(), altOf(ac) + act.value));
                    break;
                case 'descend':
                    // 绝对高度同样受可指令高度下限约束（导入位置文件后为 floor）；
                    // 进近/落地许可的目标高度由 domain/clearances.js 直接下发，不受此限。
                    setAltitudeConstraint(ac, act.absolute
                        ? Math.max(altFloorM(), act.value)
                        : Math.max(altFloorM(), altOf(ac) - act.value));
                    break;
                case 'hdg':
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, act.value);
                    break;
                case 'turnLeft':
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, (hdgOf(ac) - act.value + 360) % 360);
                    break;
                case 'turnRight':
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, (hdgOf(ac) + act.value) % 360);
                    break;
                case 'spd':
                    setSpeedConstraint(ac, act.value);
                    break;
                case 'speedUp':
                    setSpeedConstraint(ac, Math.min(SPD_MAX, spdOf(ac) + act.value));
                    break;
                case 'slowDown':
                    setSpeedConstraint(ac, Math.max(SPD_MIN, spdOf(ac) - act.value));
                    break;
                case 'expedite':
                    setSpeedConstraint(ac, Math.min(SPD_MAX, spdOf(ac) + EXPEDITE_BONUS));
                    break;
                case 'level':
                    setAltitudeConstraint(ac, altOf(ac));
                    break;
                case 'hold':
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, hdgOf(ac));
                    break;
                case 'goaround':
                    setAltitudeConstraint(ac, Math.min(altCeilingM(), altOf(ac) + GOAROUND_ALT));
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, hdgOf(ac));
                    markGoAround(ac);          // 领域记录 + 阶段推导转入 GO_AROUND
                    break;
                case 'direct': {
                    const wp = findWaypointByName(act.value);
                    if (wp) {
                        ac.navMode = 'free';
                        ac.targetX = wp.x;
                        ac.targetY = wp.y;
                        setHeadingConstraint(ac, Math.atan2(wp.x - ac.x, -(wp.y - ac.y)) * 180 / Math.PI);
                    } else {
                        addComm('atc', `未找到航路点 ${act.value}`);
                    }
                    break;
                }
                /* ---- 塔台 / 进近 / 区调：许可与移交 ---- */
                case 'approach':
                    issueApproachClearance(ac, act.value, act.runway);
                    break;
                case 'land':
                    issueLandingClearance(ac, act.runway);
                    break;
                case 'takeoff':
                    issueTakeoffClearance(ac);
                    break;
                case 'handoff':
                    if (!handoffAircraft(ac, act.value)) {
                        addComm('atc', `${ac.flightNo} 已在${unitLabel(ac.unit)}席位，无需移交`);
                    }
                    break;
                case 'runway':
                    assignRunwayClearance(ac, act.value);
                    break;
            }
        }
        affected++;
        applied.push(ac);
    }

    // 机组复诵：定向指令逐架播报（含按难度概率抽取的漏项错诵，见 domain/readback.js）。
    // 重新下发视为纠正：先清掉上一轮「复诵不符」状态，再播报新的复诵。
    if (parsed.target) {
        applied.slice(0, READBACK_MAX_TARGETS).forEach(ac => {
            ac.lastCommandText = text;                 // 供指令台「要求复诵」原样重发
            resolveReadback(ac, { by: 'reissue' });
            makeReadback(ac, parsed);
        });
    }

    const desc = parsed.actions.map(a => a.type).join('、');
    return { ok: true, affected, message: `→ ${targetLabel}: ${text}（${affected} 架执行 ${desc}）` };
}
