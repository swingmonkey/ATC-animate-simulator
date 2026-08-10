/**
 * commands/executor.js — 指令执行（指令层）
 * 将 parser 解析出的结构化指令施加到飞机（约束模型）。不依赖 UI 层，避免循环依赖。
 * 返回受影响飞机数量；通话播报通过 comm.addComm 完成。
 */

import { state } from '../core.js';
import { addComm } from '../comm.js';
import {
    setAltitudeConstraint, setSpeedConstraint, setHeadingConstraint
} from '../simulation/motion.js';
import { parseCommand, hasActions } from './parser.js';

function curAlt(ac) { return ac.displayAltitude ?? ac.altitude; }
function curSpd(ac) { return ac.displaySpeed ?? ac.speed; }
function curHdg(ac) { return ac.displayHeading ?? (ac.heading || 90); }

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
                    setAltitudeConstraint(ac, act.absolute ? act.value : Math.min(15000, curAlt(ac) + act.value));
                    break;
                case 'descend':
                    setAltitudeConstraint(ac, act.absolute ? act.value : Math.max(3000, curAlt(ac) - act.value));
                    break;
                case 'hdg':
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, act.value);
                    break;
                case 'turnLeft':
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, (curHdg(ac) - act.value + 360) % 360);
                    break;
                case 'turnRight':
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, (curHdg(ac) + act.value) % 360);
                    break;
                case 'spd':
                    setSpeedConstraint(ac, act.value);
                    break;
                case 'speedUp':
                    setSpeedConstraint(ac, Math.min(600, curSpd(ac) + act.value));
                    break;
                case 'slowDown':
                    setSpeedConstraint(ac, Math.max(200, curSpd(ac) - act.value));
                    break;
                case 'expedite':
                    setSpeedConstraint(ac, Math.min(600, curSpd(ac) + 50));
                    break;
                case 'level':
                    setAltitudeConstraint(ac, curAlt(ac));
                    break;
                case 'hold':
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, curHdg(ac));
                    break;
                case 'goaround':
                    setAltitudeConstraint(ac, Math.min(15000, curAlt(ac) + 1500));
                    ac.navMode = 'heading';
                    ac.routeId = null;
                    setHeadingConstraint(ac, curHdg(ac));
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
            }
        }
        affected++;
    }

    const desc = parsed.actions.map(a => a.type).join('、');
    addComm('atc', `→ ${targetLabel}: ${text}（${affected} 架执行 ${desc}）`);
    return { ok: true, affected, message: `已对 ${affected} 架飞机执行指令` };
}
