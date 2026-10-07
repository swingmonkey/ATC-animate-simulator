/**
 * interaction/palette.js — 拖放（输入层）
 * 从右侧工具调色板拖拽航路点/飞机到雷达画布。
 * 创建逻辑在 factory.js（会自动 commitScene 触发面板刷新与持久化）。
 */

import { state, isEditMode, select } from '../core/store.js';
import { toWorldX, toWorldY } from '../core/viewport.js';
import { addPoint, addAircraft } from './factory.js';

const radarContainer = document.getElementById('radar-container');

radarContainer.addEventListener('dragover', e => {
    e.preventDefault();
    if (!isEditMode()) return;
    e.dataTransfer.dropEffect = 'copy';
    radarContainer.classList.add('drag-over');
});

radarContainer.addEventListener('dragleave', () => {
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
        select({ type: 'aircraft', id: ac.id });
    }
});

document.querySelectorAll('.draggable-item').forEach(item => {
    item.addEventListener('dragstart', e => {
        if (!isEditMode()) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/type', item.dataset.type);
        e.dataTransfer.setData('text/subtype', item.dataset.pointType || '');
        e.dataTransfer.effectAllowed = 'copy';
    });
});
