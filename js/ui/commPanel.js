/**
 * ui/commPanel.js — 通讯输入框与消息渲染（界面层）
 * 管制指令经指令层解析执行（容错），普通通话照常播报。
 * 消息 DOM 追加由 subscriptions.js 在 comm:added 时触发，
 * 指令层不再直接触碰 DOM（原 comm.js 的职责已拆分）。
 */

import { state, addComm } from '../core/store.js';
import { escapeHtml, sanitizeClass, $ } from '../core/dom.js';
import { executeCommand } from '../commands/executor.js';
import { recordInput } from '../game/session.js';
import { updateCommTargetSelect, updateProgressList } from './indicators.js';
import { updateAircraftPanelList } from './panels.js';

/** 通话发送方 → 显示标签（管制员按席位着色：twr/app/acc 见 styles.css） */
const SENDER_LABELS = {
    atc: '[管制]',
    pilot: '[机组]',
    twr: '[塔台]',
    app: '[进近]',
    acc: '[区调]'
};

/** 由 comm:added 事件触发：向通话面板追加一条消息（已转义） */
export function appendCommMessage(msg) {
    const container = document.getElementById('comm-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `comm-msg ${sanitizeClass(msg.sender)}`;
    const label = SENDER_LABELS[msg.sender] || `[${msg.sender}]:`;
    div.innerHTML = `<span class="comm-time">${escapeHtml(msg.time)}</span><span class="comm-label">${escapeHtml(label)}</span> ${escapeHtml(msg.text)}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

/**
 * 提交一条管制指令文本（陆空通话输入框与「指令台 2.0」模板按钮共用）：
 * 验证并执行 → 成功后录制与播报 → 刷新受影响面板。
 * @param {string} text 指令文本（含呼号时定向，否则广播）
 * @returns {{ok:boolean, affected:number, message:string}|null}
 */
export function submitAtcText(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const res = executeCommand(t);
    const feedback = $('comm-feedback');
    if (feedback) {
        feedback.textContent = res.message;
        feedback.classList.toggle('comm-feedback-error', !res.ok);
    }
    if (!res.ok) return res;
    recordInput(t, 'console');          // 班次输入录制（复盘/评分数据基础）
    addComm('atc', t);
    addComm('atc', res.message);
    updateAircraftPanelList();
    updateProgressList(true);
    return res;
}

export function sendComm() {
    const input = $('comm-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const target = $('comm-target')?.value;

    let res;
    if (target === 'atc' || target === undefined) {
        res = submitAtcText(text);
    } else {
        const ac = state.aircraft.find(a => a.id === parseInt(target));
        if (ac) {
            res = submitAtcText(`${ac.flightNo} ${text}`);
        } else {
            const feedback = $('comm-feedback');
            if (feedback) {
                feedback.textContent = '目标航班已不存在，请重新选择';
                feedback.classList.add('comm-feedback-error');
            }
            return;
        }
    }
    if (res?.ok) input.value = '';
}

/* 通讯面板自绑定（界面层自管控件；输入层不再处理） */
$('comm-send-btn')?.addEventListener('click', sendComm);
$('comm-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendComm();
});
