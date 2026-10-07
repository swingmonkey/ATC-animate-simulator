/**
 * ui/seatPanel.js — 管制席位面板（界面层）
 *
 * 显示 区域（ACC）/ 进近（APP）/ 塔台（TWR）三个席位的频率、在管架数与待移交数；
 * 点击席位行 = 切换进程单的席位过滤（store.setSeatFilter）。
 * 自动移交 / 自动许可两个开关的控件绑定在 ui/formBindings.js（界面层自管控件）。
 */

import { state, setSeatFilter } from '../core/store.js';
import { escapeHtml } from '../core/dom.js';
import { ATC_UNITS, UNIT_ORDER, unitFrequency } from '../data/atcUnits.js';
import { airportName, runwayList } from '../data/airports.js';
import { unitSummary } from '../domain/airspace.js';

export function updateSeatPanel() {
    const list = document.getElementById('seat-list');
    if (!list) return;
    const focus = state.focusAirport;
    const summary = unitSummary();
    list.innerHTML = '';

    UNIT_ORDER.forEach(code => {
        const u = ATC_UNITS[code];
        const stat = summary[code] || { count: 0, pending: 0 };
        const freq = unitFrequency(code, focus);
        const scopeText = u.scopeKm === Infinity ? '全域' : `${u.scopeKm}km`;
        const row = document.createElement('div');
        row.className = 'seat-row' + (state.seatFilter === code ? ' active' : '');
        row.dataset.unit = code;
        row.title = `${u.name}：${u.duty}（管制范围 ${scopeText}）`;
        row.innerHTML = `
            <span class="seat-code" style="background:${u.color}1a;color:${u.color};border-color:${u.color}66;">${escapeHtml(u.short)}</span>
            <span class="seat-name">${escapeHtml(u.name)}</span>
            <span class="seat-freq">${freq ? escapeHtml(freq) : '--'}</span>
            <span class="seat-count" title="在管架数">${stat.count}</span>
            ${stat.pending ? `<span class="seat-pending" title="等待移交">⟳${stat.pending}</span>` : ''}
        `;
        row.addEventListener('click', () => setSeatFilter(code));
        list.appendChild(row);
    });

    const info = document.getElementById('seat-airport-info');
    if (info) {
        info.innerHTML = `参考机场：<strong>${escapeHtml(airportName(focus))}</strong> (${escapeHtml(focus)})`
            + `<br>跑道：${escapeHtml(runwayList(focus).join(' / '))}`;
    }

    const handoffBox = document.getElementById('auto-handoff-toggle');
    if (handoffBox) handoffBox.checked = !!state.autoHandoff;
    const clearanceBox = document.getElementById('auto-clearance-toggle');
    if (clearanceBox) clearanceBox.checked = !!state.autoClearance;
}
