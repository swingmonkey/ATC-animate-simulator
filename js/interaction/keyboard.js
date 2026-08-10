/**
 * interaction/keyboard.js — 键盘输入（输入层）
 */

import {
    state, keysPressed, setDraggingPoint, setDraggingAc,
    setLabelFollowMouse, isEditMode
} from '../core.js';
import { moveView } from './view.js';
import { updateModeIndicator, updateProgressList, togglePlayPause } from '../ui/index.js';

document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    keysPressed[e.key.toLowerCase()] = true;

    if (e.key === 'Escape') {
        document.querySelectorAll('.dialog:not(.hidden)').forEach(d => d.classList.add('hidden'));
        if (state.routeConnectMode) {
            state.routeConnectMode = false;
            state.routeConnectPoints = [];
            document.getElementById('add-route-btn')?.classList.remove('active');
        }
        state.selectedItem = null;
        setLabelFollowMouse(null);
        updateModeIndicator();
        updateProgressList();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && isEditMode()) {
        if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
            document.getElementById('tool-delete')?.click();
        }
    }
    if (e.key === ' ') {
        if (document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            document.getElementById('play-pause-btn')?.click();
        }
    }
});

document.addEventListener('keyup', e => {
    keysPressed[e.key.toLowerCase()] = false;
});

function handleKeyboardMovement() {
    const step = 20;
    let dx = 0, dy = 0;
    if (keysPressed['w'] || keysPressed['arrowup']) dy += step;
    if (keysPressed['s'] || keysPressed['arrowdown']) dy -= step;
    if (keysPressed['a'] || keysPressed['arrowleft']) dx += step;
    if (keysPressed['d'] || keysPressed['arrowright']) dx += step;
    if (dx !== 0 || dy !== 0) moveView(dx, dy);
}

setInterval(handleKeyboardMovement, 16);
