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
    handoffAircraft, normalizeRunway
} from '../simulation/units.js';
import { unitLabel } from '../data/atcUnits.js';

function findWaypointByName(name) {
    const n = (name || '').toLowerCase();
    return state.routePoints.find(p => (p.name || '').toLowerCase() === n) || null;
}

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
        else { targetLabel = parsed.target; }
    }

    let affected = 0;
    for (const ac of targets) {
        if (state.time < (ac.startTime || 0)) continue;
        for (const act of parsed.actions) {
            switch (act.type) {
                case 'alt':
                    setAltitudeConstraint(ac, act.value);
                    break;
                case 'climb':
                    setAltitudeConstraint(ac, act.absolute ? act.value : Math.min(ALT_MAX, altOf(ac) + act.value));
                    break;
                case 'descend':
                    setAltitudeConstraint(ac, act.absolute ? act.value : Math.max(ALT_MIN, altOf(ac) - act.value));
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
                    setAltitudeConstraint(ac, Math.min(ALT_MAX, altOf(ac) + GOAROUND_ALT));
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, hdgOf(ac));
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
                case 'runway': {
                    const rn = normalizeRunway(act.value);
                    if (rn) {
                        ac.runway = rn;
                        addComm('atc', `${ac.flightNo}，预计使用跑道 ${rn}。`);
                    }
                    break;
                }
            }
        }
        affected++;
    }

    const desc = parsed.actions.map(a => a.type).join('、');
    addComm('atc', `→ ${targetLabel}: ${text}（${affected} 架执行 ${desc}）`);
    return { ok: true, affected, message: `已对 ${affected} 架飞机执行指令` };
}
