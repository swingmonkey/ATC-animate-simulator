/**
 * interaction/palette.js — 拖放（输入层）
 * 从左侧工具栏拖拽航路点/飞机到雷达画布。
 */

import { state, isEditMode, toWorldX, toWorldY, saveState } from '../core.js';
import { addPoint, addAircraft } from './factory.js';
import { updateModeIndicator, updateProgressList, addComm } from '../ui/index.js';

const radarContainer = document.getElementById('radar-container');

radarContainer.addEventListener('dragover', e => {
    e.preventDefault();
    if (!isEditMode()) return;
    e.dataTransfer.dropEffect = 'copy';
    radarContainer.classList.add('drag-over');
});

radarContainer.addEventListener('dragleave', e => {
    radarContainer.classList.remove('drag-over');
});

radarContainer.addEventListener('drop', e => {
    e.preventDefault();
    radarContainer.classList.remove('drag-over');
    if (!isEditMode()) return;
    const type = e.dataTransfer.getData('text/type');
    const subType = e.dataTransfer.getData('text/subtype');
    const rect = (document.getElementById('radar-canvas')).getBoundingClientRect();
    const x = toWorldX(e.clientX - rect.left);
    const y = toWorldY(e.clientY - rect.top);
    if (type === 'point') {
        addPoint(x, y, subType || 'normal');
    } else if (type === 'aircraft') {
        const ac = addAircraft(x, y);
        state.selectedItem = { type: 'aircraft', id: ac.id };
        updateModeIndicator();
        updateProgressList();
    }
    saveState();
});

document.querySelectorAll('.draggable-item').forEach(item => {
    item.addEventListener('dragstart', e => {
        if (!isEditMode()) { e.preventDefault(); return; }
        const type = item.dataset.type;
        const subType = item.dataset.pointType || '';
        e.dataTransfer.setData('text/type', type);
        e.dataTransfer.setData('text/subtype', subType);
        e.dataTransfer.effectAllowed = 'copy';
        state.isDraggingFromPalette = true;
        state.paletteDragType = type;
        state.paletteDragSubType = subType;
    });
    item.addEventListener('dragend', e => {
        state.isDraggingFromPalette = false;
        state.paletteDragType = null;
        state.paletteDragSubType = null;
    });
});
