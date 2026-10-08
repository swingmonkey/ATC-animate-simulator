/** L1 教学卡片：呈现游戏层步骤，并在当前班次核对机组复诵。 */

import { state } from '../core/store.js';
import { currentSession, currentDirector, isSessionActive } from '../game/session.js';
import { acknowledgeReadback, resetTutorial, tutorialModel } from '../game/tutorial.js';

let lastError = '';

function setText(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent !== value) el.textContent = value;
}

export function initTutorialPanel() {
    document.getElementById('tutorial-ack-btn')?.addEventListener('click', () => {
        const model = currentTutorialModel();
        if (!model?.canAck) return;
        const ac = state.aircraft.find(a => a.id === model.acId);
        if (acknowledgeReadback(ac)) updateTutorialPanel();
    });
}

export function resetTutorialPanel() {
    resetTutorial();
    lastError = '';
    updateTutorialPanel();
}

export function handleTutorialCommandResult(result) {
    lastError = result?.ok ? '' : (result?.message || '指令未执行');
    updateTutorialPanel();
}

function currentTutorialModel() {
    return tutorialModel({
        tutorial: currentSession()?.meta.tutorial,
        active: isSessionActive(),
        aircraft: state.aircraft,
        selectedItem: state.selectedItem,
        finish: currentDirector().finish
    });
}

export function updateTutorialPanel() {
    const card = document.getElementById('tutorial-card');
    if (!card) return;
    const model = currentTutorialModel();
    card.classList.toggle('hidden', !model);
    if (!model) return;
    setText('tutorial-progress', `落地 ${model.progress}`);
    setText('tutorial-title', model.title);
    setText('tutorial-detail', model.detail);
    setText('tutorial-readback', model.readback || '');
    const error = document.getElementById('tutorial-error');
    if (error) {
        error.classList.toggle('hidden', !lastError);
        setText('tutorial-error', lastError ? `指令失败：${lastError}` : '');
    }
    const ack = document.getElementById('tutorial-ack-btn');
    if (ack) {
        ack.classList.toggle('hidden', !model.stage?.endsWith('readback'));
        ack.disabled = !model.canAck;
    }
}
