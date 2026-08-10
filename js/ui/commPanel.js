/**
 * ui/commPanel.js — 通讯输入框（界面层）
 * 管制指令经指令层解析执行（容错），普通通话照常播报。
 */

import { state } from '../core.js';
import { addComm } from '../comm.js';
import { executeCommand } from '../commands/executor.js';
import { updateCommTargetSelect, updateProgressList, updateAircraftPanelList } from './index.js';

export function sendComm() {
    const input = document.getElementById('comm-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const target = document.getElementById('comm-target').value;

    if (target === 'atc') {
        addComm('atc', text);
        executeCommand(text);
        updateAircraftPanelList();
        updateProgressList();
    } else {
        const ac = state.aircraft.find(a => a.id === parseInt(target));
        if (ac) {
            addComm('atc', `→${ac.flightNo}: ${text}`);
            addComm(ac.flightNo, `收到指令：${text}`);
            executeCommand(`${ac.flightNo} ${text}`);
            updateAircraftPanelList();
            updateProgressList();
        } else {
            executeCommand(text);
        }
    }
    input.value = '';
}
