/**
 * comm.js — 陆空通话日志（独立模块）
 * 界面层与指令层都依赖它，故独立成模块以避免循环依赖。
 */

import { state } from './core.js';

export function addComm(sender, text) {
    const now = new Date(0);
    now.setSeconds(state.time);
    const timeStr = now.toTimeString().slice(0, 8);
    state.commMessages.push({ sender, text, time: timeStr });
    const container = document.getElementById('comm-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `comm-msg ${sender}`;
    div.innerHTML = `<span class="comm-time">${timeStr}</span><span class="comm-label">${sender === 'atc' ? '[管制]' : `[${sender}]:`}</span> ${text}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}
