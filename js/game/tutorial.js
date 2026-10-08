/** L1 教学步骤：只描述当前航空器状态，不参与指令合法性或评分。 */

import { canIssue, issueHint } from '../domain/phases.js';
import { readbackTextOf } from '../domain/readback.js';

const checkedReadbacks = new Set();

function clearanceKey(ac) {
    const entries = ac.clearances || [];
    const last = entries[entries.length - 1];
    return last ? `${ac.id}:${entries.length}:${last.type}` : null;
}

export function resetTutorial() {
    checkedReadbacks.clear();
}

/** 只能核对当前航班最新一次正确或已纠正的复诵。 */
export function acknowledgeReadback(ac) {
    const key = ac && clearanceKey(ac);
    const rb = ac && ac.readback;
    if (!key || !rb || (!rb.correct && !rb.resolved)) return false;
    checkedReadbacks.add(key);
    return true;
}

/** @returns {object|null} 当前 L1 教学卡片模型；非教学班次返回 null。 */
export function tutorialModel({ tutorial, active, aircraft, selectedItem, finish }) {
    if (!active || tutorial !== 'arrival-basic') return null;
    const list = aircraft || [];
    const targetCount = finish?.count || 4;
    const landed = list.filter(ac => ac.flow === 'arrival' && ac.landed).length;
    const progress = `${landed}/${targetCount}`;
    const arrivals = list.filter(ac => ac.flow === 'arrival' && !ac.landed);
    if (!arrivals.length) {
        return { stage: 'waiting', title: '等待首架进港', detail: '航班进入后，点击雷达标签或进程单选中它。等待时可调整播放倍率。', progress };
    }

    const selected = selectedItem?.type === 'aircraft'
        ? arrivals.find(ac => ac.id === selectedItem.id) : null;
    const ac = selected || arrivals[0];
    if (!selected) {
        return { stage: 'select', title: `选中 ${ac.flightNo}`, detail: '点击雷达标签或进程单中的航班，查看可下达的指令。', progress, acId: ac.id };
    }
    if (!ac.approachType) {
        const hint = canIssue(ac, 'APPROACH')
            ? `在指令台点击“进近许可”，或输入“${ac.flightNo} ILS 进近 跑道 ${ac.runway || '02L'}”。`
            : `${issueHint(ac, 'APPROACH')}，继续监视航班。`;
        return { stage: 'approach', title: `向 ${ac.flightNo} 下达进近许可`, detail: hint, progress, acId: ac.id };
    }

    const last = (ac.clearances || []).at(-1);
    const needsCheck = last && !checkedReadbacks.has(clearanceKey(ac));
    if (ac.clearance !== 'land' && last?.type === 'APPROACH' && needsCheck) {
        const canAck = !!ac.readback && (ac.readback.correct || ac.readback.resolved);
        return { stage: 'approach-readback', title: `核对复诵 · ${ac.flightNo}`,
            detail: canAck ? '确认机组复诵了进近方式和跑道，再点击“已核对复诵”。' : '复诵有漏项，请在指令台重新下发纠正。',
            readback: readbackTextOf(ac), canAck, progress, acId: ac.id };
    }
    if (ac.clearance !== 'land') {
        const hint = canIssue(ac, 'LAND')
            ? `在指令台点击“可以落地”，或输入“${ac.flightNo} 可以落地”。`
            : `${issueHint(ac, 'LAND')}，继续监视航班。`;
        return { stage: 'land', title: `向 ${ac.flightNo} 下达落地许可`, detail: hint, progress, acId: ac.id };
    }
    if (last?.type === 'LAND' && needsCheck) {
        const canAck = !!ac.readback && (ac.readback.correct || ac.readback.resolved);
        return { stage: 'land-readback', title: `核对落地复诵 · ${ac.flightNo}`,
            detail: canAck ? '确认机组复诵了跑道号，再点击“已核对复诵”。' : '复诵有漏项，请在指令台重新下发纠正。',
            readback: readbackTextOf(ac), canAck, progress, acId: ac.id };
    }
    return { stage: 'touchdown', title: `等待接地 · ${ac.flightNo}`,
        detail: '继续监视间隔和高度；落地后选择下一架进港航班。', progress, acId: ac.id };
}
