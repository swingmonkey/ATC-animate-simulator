/**
 * commands/parser.js — 文本指令解析（指令层·纯函数）
 * 移植参考项目 commands.py 的「关键词 + 数值 + 航班号定向」思路，并支持中英文。
 * 仅做解析，不修改状态；执行见 executor.js。
 *
 * parseCommand(text) → {
 *   target: string|null,   // 航班号（命中则定向，否则广播）
 *   actions: [ {type, value, raw} ]   // type: alt|climb|descend|hdg|turnLeft|turnRight|spd|direct|speedUp|slowDown
 * }
 */

const NUM = '(-?\\d+(?:\\.\\d+)?)';

function findCallsign(text, knownCallsigns) {
    // 直接包含某航班号（如 CCA1234）
    for (const cs of knownCallsigns) {
        if (text.toUpperCase().includes(cs.toUpperCase())) return cs;
    }
    // 形如 "CCA1234 上升" 开头
    const m = text.match(/^([A-Za-z]{3}\d{3,4})/);
    if (m) return m[1].toUpperCase();
    return null;
}

export function parseCommand(text, knownCallsigns = []) {
    const raw = text.trim();
    const lower = raw.toLowerCase();
    const actions = [];

    const callsign = findCallsign(raw, knownCallsigns);

    // 高度：到达某高度
    let m;
    if ((m = lower.match(new RegExp(`(?:高度|alt(?:itude)?)\\s*${NUM}`)))) {
        actions.push({ type: 'alt', value: parseFloat(m[1]), raw: m[0] });
    }
    // 爬升 / 上升
    if ((m = lower.match(new RegExp(`(?:爬升|上升|climb(?:\\s*to)?)\\s*${NUM}`)))) {
        actions.push({ type: 'climb', value: parseFloat(m[1]), raw: m[0] });
    } else if (lower.includes('爬升') || lower.includes('上升') || lower.includes('climb')) {
        actions.push({ type: 'climb', value: 600, raw: 'climb' });
    }
    // 下降 / 减速下降
    if ((m = lower.match(new RegExp(`(?:下降|descend(?:\\s*to)?)\\s*${NUM}`)))) {
        actions.push({ type: 'descend', value: parseFloat(m[1]), raw: m[0] });
    } else if (lower.includes('下降') || lower.includes('descend')) {
        actions.push({ type: 'descend', value: 600, raw: 'descend' });
    }

    // 航向
    if ((m = lower.match(new RegExp(`(?:航向|heading)\\s*${NUM}`)))) {
        actions.push({ type: 'hdg', value: parseFloat(m[1]), raw: m[0] });
    }
    // 左转 / 右转
    if (lower.includes('左转') || lower.includes('turn left') || lower.includes('left')) {
        actions.push({ type: 'turnLeft', value: 30, raw: 'left' });
    }
    if (lower.includes('右转') || lower.includes('turn right') || lower.includes('right')) {
        actions.push({ type: 'turnRight', value: 30, raw: 'right' });
    }

    // 速度
    if ((m = lower.match(new RegExp(`(?:速度|speed)\\s*${NUM}`)))) {
        actions.push({ type: 'spd', value: parseFloat(m[1]), raw: m[0] });
    }
    if (lower.includes('加速') || lower.includes('增加速度') || lower.includes('faster')) {
        actions.push({ type: 'speedUp', value: 20, raw: 'speedUp' });
    }
    if (lower.includes('减速') || lower.includes('减小速度') || lower.includes('slower')) {
        actions.push({ type: 'slowDown', value: 20, raw: 'slowDown' });
    }

    // 直飞某点
    const dm = lower.match(/(?:直飞|direct(?:\\s*to)?)\\s*([A-Za-z0-9一-龥]+)/);
    if (dm) {
        actions.push({ type: 'direct', value: dm[1], raw: dm[0] });
    }

    return { target: callsign, actions };
}

/** 指令是否包含有效动作 */
export function hasActions(parsed) {
    return parsed.actions && parsed.actions.length > 0;
}
