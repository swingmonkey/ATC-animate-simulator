/**
 * commands/parser.js — 文本指令解析（指令层·纯函数）
 * 移植参考项目 commands.py 的「关键词 + 数值 + 航班号定向」思路，并支持中英文。
 * 仅做解析，不修改状态；执行见 executor.js。
 *
 * parseCommand(text) → {
 *   target: string|null,   // 航班号（命中则定向，否则广播；含“全体/所有”强制广播）
 *   actions: [ {type, value, raw} ]
 * }
 *
 * 指令类型：
 *   alt        到达某绝对高度（高度/上高度/下高度/alt）
 *   climb      上升（爬升/上升，带数字=到该高度，否则 +600）
 *   descend    下降（下降/descend，带数字=到该高度，否则 -600）
 *   level      保持当前高度（保持高度/平飞/level）
 *   hdg        航向（航向/左转航向/右转航向/雷达引导/vector + 数字）
 *   turnLeft   左转相对角度（左转/left，默认 30）
 *   turnRight  右转相对角度（右转/right，默认 30）
 *   spd        到达某绝对速度（速度/减速到/加速到/speed + 数字）
 *   speedUp    加速（加速/faster，+20）
 *   slowDown   减速（减速/slower，-20）
 *   expedite   尽快（尽快/expedite：速度 +50）
 *   hold       盘旋/保持航向（盘旋/hold/进跑道/lineup）
 *   goaround   复飞（复飞/goaround：爬升 1500 并保持航向）
 *   direct     直飞某航路点（直飞/direct + 点名）
 *   approach   进近许可（进近许可/ILS/RNAV/VOR/目视进近/approach，可带跑道）
 *   land       落地许可（可以落地/cleared to land/land）
 *   takeoff    起飞许可（可以起飞/cleared for takeoff/cto）
 *   handoff    席位移交（移交塔台/联系进近/contact tower/handoff app）
 *   runway     指派跑道（跑道 02L / runway 02L）
 */

import { approachFromText, unitFromText } from '../data/atcUnits.js';

const NUM = '(-?\\d+(?:\\.\\d+)?)';

function findCallsign(text, knownCallsigns) {
    const lower = text.toLowerCase();
    // 全体/所有/大家 → 强制广播
    if (/全体|所有|大家|all|everyone/.test(lower)) return null;
    // 仅把完整呼号当作目标，避免 CCA123 误匹配 CCA1234。
    const upper = text.toUpperCase();
    for (const cs of knownCallsigns) {
        const at = upper.indexOf(cs.toUpperCase());
        if (at < 0) continue;
        const before = upper[at - 1], after = upper[at + cs.length];
        if ((!before || !/[A-Z0-9]/.test(before)) && (!after || !/[A-Z0-9]/.test(after))) return cs;
    }
    // 不存在的完整呼号仍需返回给执行层明确拒绝，不能退化成广播。
    const m = text.match(/(?:^|[^A-Za-z0-9])([A-Za-z]{3}\d{3,4})(?=$|[^A-Za-z0-9])/);
    if (m) return m[1].toUpperCase();
    return null;
}

export function parseCommand(text, knownCallsigns = []) {
    const raw = text.trim();
    const lower = raw.toLowerCase();
    const actions = [];

    const callsign = findCallsign(raw, knownCallsigns);

    // 高度：到达某绝对高度
    let m;
    if ((m = lower.match(new RegExp(`(?:高度|上高度|下高度|alt(?:itude)?)\\s*${NUM}`)))) {
        actions.push({ type: 'alt', value: parseFloat(m[1]), raw: m[0] });
    }
    // 爬升 / 上升（带数字=上升到该高度，否则相对 +600）
    if ((m = lower.match(new RegExp(`(?:爬升|上升|爬升到|上升到|climb(?:\\s*to)?)\\s*${NUM}`)))) {
        actions.push({ type: 'climb', value: parseFloat(m[1]), absolute: true, raw: m[0] });
    } else if (lower.includes('爬升') || lower.includes('上升') || lower.includes('climb')) {
        actions.push({ type: 'climb', value: 600, absolute: false, raw: 'climb' });
    }
    // 下降 / 减速下降（带数字=下降到该高度，否则相对 -600）
    if ((m = lower.match(new RegExp(`(?:下降|下降到|descend(?:\\s*to)?)\\s*${NUM}`)))) {
        actions.push({ type: 'descend', value: parseFloat(m[1]), absolute: true, raw: m[0] });
    } else if (lower.includes('下降') || lower.includes('descend')) {
        actions.push({ type: 'descend', value: 600, absolute: false, raw: 'descend' });
    }
    // 保持高度 / 平飞
    if (lower.includes('保持高度') || lower.includes('平飞') || lower.includes('level')) {
        actions.push({ type: 'level', raw: 'level' });
    }

    // 航向（含左转航向/右转航向/雷达引导/vector + 数字）
    const hasAbsTurn = /左转航向|右转航向|turn left heading|turn right heading/.test(lower);
    if ((m = lower.match(new RegExp(`(?:航向|左转航向|右转航向|雷达引导|引导|vector)\\s*${NUM}`)))) {
        actions.push({ type: 'hdg', value: parseFloat(m[1]), raw: m[0] });
    }
    // 左转 / 右转（相对角度，默认 30；绝对航向形式已在上条处理）
    if (!hasAbsTurn && (lower.includes('左转') || lower.includes('turn left') || lower.includes('left'))) {
        actions.push({ type: 'turnLeft', value: 30, raw: 'left' });
    }
    if (!hasAbsTurn && (lower.includes('右转') || lower.includes('turn right') || lower.includes('right'))) {
        actions.push({ type: 'turnRight', value: 30, raw: 'right' });
    }

    // 速度（带数字=绝对速度；否则按方向加速/减速）
    if ((m = lower.match(new RegExp(`(?:速度|speed|减速到|加速到|加速|减速)\\s*${NUM}`)))) {
        actions.push({ type: 'spd', value: parseFloat(m[1]), raw: m[0] });
    } else {
        if (lower.includes('加速') || lower.includes('增加速度') || lower.includes('faster') || lower.includes('尽快') || lower.includes('expedite')) {
            actions.push({ type: 'expedite', raw: 'expedite' });
        }
        if (lower.includes('减速') || lower.includes('减小速度') || lower.includes('slower')) {
            actions.push({ type: 'slowDown', value: 20, raw: 'slowDown' });
        }
    }

    // 盘旋 / 进跑道 / lineup（保持当前航向）
    if (lower.includes('盘旋') || lower.includes('hold') || lower.includes('进跑道') || lower.includes('lineup') || lower.includes('hold short')) {
        actions.push({ type: 'hold', raw: 'hold' });
    }
    // 复飞
    if (lower.includes('复飞') || lower.includes('goaround') || lower.includes('go around')) {
        actions.push({ type: 'goaround', raw: 'goaround' });
    }

    // 直飞某点（点名取非空白 token）
    const dm = lower.match(/(?:直飞|direct(?:\s*to)?)\s*(\S+)/);
    if (dm) {
        actions.push({ type: 'direct', value: dm[1], raw: dm[0] });
    }

    /* ---------------- 塔台 / 进近 / 区调（管制席位内容） ---------------- */

    // 跑道号（可单独下发，也可随进近/落地许可一起下发）
    const rm = raw.match(/(?:跑道|rwy|runway)\s*([0-9]{1,2}[LRC]?)/i);
    const runwayLabel = rm ? rm[1].toUpperCase() : null;

    // 席位移交：移交塔台 / 联系进近 119.25 / contact tower / handoff app
    const handoffHit = /(?:移交|交给|联系|转频|handoff|hand\s*off|contact)/i.test(lower);
    const handoffUnit = handoffHit ? unitFromText(lower) : null;
    if (handoffUnit) {
        actions.push({ type: 'handoff', value: handoffUnit, raw: 'handoff' });
    }

    // 进近许可（含进近方式）：进近许可 / ILS 进近 / 目视进近 / cleared ILS approach
    const approachHit = /(?:进近许可|可以进近|建立盲降|建立ils|ils进近|rnav进近|vor进近|目视进近|cleared\s+ils|approach)/i.test(lower)
        || (/进近/.test(lower) && !handoffHit);
    if (approachHit) {
        actions.push({ type: 'approach', value: approachFromText(lower), runway: runwayLabel, raw: 'approach' });
    }

    // 起飞许可（塔台放行）
    if (/(?:可以起飞|准许起飞|起飞|cleared\s+for\s+takeoff|takeoff|\bcto\b)/i.test(lower)) {
        actions.push({ type: 'takeoff', raw: 'takeoff' });
    }
    // 落地许可（塔台）
    if (/(?:可以落地|准许落地|可以着陆|落地|着陆|cleared\s+to\s+land|\bland\b)/i.test(lower)) {
        actions.push({ type: 'land', runway: runwayLabel, raw: 'land' });
    }
    // 仅指派跑道（未同时下发进近/落地许可时）
    if (runwayLabel && !approachHit && !/(?:可以落地|准许落地|可以着陆|落地|着陆|land)/i.test(lower)) {
        actions.push({ type: 'runway', value: runwayLabel, raw: rm[0] });
    }

    return { target: callsign, actions };
}

/** 指令是否包含有效动作 */
export function hasActions(parsed) {
    return parsed.actions && parsed.actions.length > 0;
}
