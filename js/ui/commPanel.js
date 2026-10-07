/**
 * ui/commPanel.js — 通讯输入框与消息渲染（界面层）
 * 管制指令经指令层解析执行（容错），普通通话照常播报。
 * 消息 DOM 追加由 subscriptions.js 在 comm:added 时触发，
 * 指令层不再直接触碰 DOM（原 comm.js 的职责已拆分）。
 */

import { state, addComm } from '../core/store.js';
import { escapeHtml, sanitizeClass, $ } from '../core/dom.js';
import { executeCommand } from '../commands/executor.js';
import { updateCommTargetSelect, updateProgressList } from './indicators.js';
import { updateAircraftPanelList } from './panels.js';

/** 由 comm:added 事件触发：向通话面板追加一条消息（已转义） */
export function appendCommMessage(msg) {
    const container = document.getElementById('comm-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `comm-msg ${sanitizeClass(msg.sender)}`;
    const label = msg.sender === 'atc' ? '[管制]' : `[${msg.sender}]:`;
    div.innerHTML = `<span class="comm-time">${escapeHtml(msg.time)}</span><span class="comm-label">${escapeHtml(label)}</span> ${escapeHtml(msg.text)}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

export function sendComm() {
    const input = $('comm-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const target = $('comm-target')?.value;

    if (target === 'atc' || target === undefined) {
        addComm('atc', text);
        executeCommand(text);
        updateAircraftPanelList();
        updateProgressList(true);
    } else {
        const ac = state.aircraft.find(a => a.id === parseInt(target));
        if (ac) {
            addComm('atc', `→${ac.flightNo}: ${text}`);
            addComm(ac.flightNo, `收到指令：${text}`);
            executeCommand(`${ac.flightNo} ${text}`);
            updateAircraftPanelList();
            updateProgressList(true);
        } else {
            executeCommand(text);
        }
    }
    input.value = '';
}

/* 通讯面板自绑定（界面层自管控件；输入层不再处理） */
$('comm-send-btn')?.addEventListener('click', sendComm);
$('comm-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendComm();
});