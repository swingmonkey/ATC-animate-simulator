/**
 * ui/seatPanel.js — 管制席位面板（界面层）
 *
 * 显示 区域（ACC）/ 进近（APP）/ 塔台（TWR）三个基础席位的频率、在管架数与待移交数；
 * M2·T9：在基础席之下追加「已拆分扇区」列表（APP-W/E、ACC-N/S，随经营合同流量解算）。
 * 点击任意席位行 = 切换进程单的席位过滤（store.setSeatFilter）。
 * 自动移交 / 自动许可两个开关的控件绑定在 ui/formBindings.js（界面层自管控件）。
 */

import { state, setSeatFilter } from '../core/store.js';
import { escapeHtml } from '../core/dom.js';
import { ATC_UNITS, UNIT_ORDER, unitFrequency } from '../data/atcUnits.js';
import { airportName, runwayList } from '../data/airports.js';
import { unitSummary } from '../domain/airspace.js';
import { sectorPlanOf } from '../domain/management.js';
import { currentSession, isSessionActive } from '../game/session.js';

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

    updateSectorRows(focus);

    const info = document.getElementById('seat-airport-info');
    if (info) {
        info.innerHTML = `参考机场：<strong>${escapeHtml(airportName(focus))}</strong> (${escapeHtml(focus)})`
            + `<br>跑道：${escapeHtml(runwayList(focus).join(' / '))}`;
    }

    const handoffBox = document.getElementById('auto-handoff-toggle');
    if (handoffBox) handoffBox.checked = !!state.autoHandoff;
    const clearanceBox = document.getElementById('auto-clearance-toggle');
    if (clearanceBox) {
        clearanceBox.checked = !!state.autoClearance;
        const guided = isSessionActive() && currentSession()?.meta.tutorial === 'arrival-basic';
        clearanceBox.disabled = guided;
        clearanceBox.title = guided ? 'L1 教学班次由你亲自下达进近与落地许可' : '';
    }
}

/**
 * 已拆分扇区列表（M2·T9）：数据来源与 render/airports.js 同源（domain/management.sectorPlanOf），
 * 无经营状态或未达拆分门槛时为空（隐藏整个容器）。
 * 注意：本容器使用独立类名 seat-row-sector，不复用 .seat-row，
 * 以免改变既有 #seat-list .seat-row 的口径（冒烟断言「三个席位」）。
 */
function updateSectorRows(focus) {
    const list = document.getElementById('seat-list');
    if (!list) return;
    let container = document.getElementById('seat-sector-list');
    if (!container) {
        container = document.createElement('div');
        container.id = 'seat-sector-list';
        container.className = 'seat-sector-list';
        list.insertAdjacentElement('afterend', container);
    }
    const sectors = state.management ? (sectorPlanOf(state.management).sectors || []) : [];
    container.innerHTML = '';
    container.classList.toggle('hidden', sectors.length === 0);
    if (!sectors.length) return;

    const summary = unitSummary();
    const head = document.createElement('div');
    head.className = 'seat-sector-head';
    head.textContent = `已拆分扇区（${sectors.length}）`;
    container.appendChild(head);

    sectors.forEach(sec => {
        const unitCode = sec.unit === 'approach' ? 'APP' : 'ACC';
        const u = ATC_UNITS[unitCode];
        const stat = summary[sec.id] || { count: 0, pending: 0 };
        const freq = unitFrequency(unitCode, focus);
        const row = document.createElement('div');
        row.className = 'seat-row-sector' + (state.seatFilter === sec.id ? ' active' : '');
        row.dataset.unit = sec.id;
        row.title = `${sec.name}（${sec.id}）：隶属${u.name}，${sec.seats} 个席位；点击按该扇区过滤进程单`;
        row.innerHTML = `
            <span class="seat-sector-code" style="background:${u.color}1a;color:${u.color};border-color:${u.color}66;">${escapeHtml(sec.id)}</span>
            <span class="seat-sector-name">${escapeHtml(sec.name)}</span>
            <span class="seat-sector-meta">${escapeHtml(sec.seats)} 席</span>
            <span class="seat-sector-freq">${freq ? escapeHtml(freq) : '--'}</span>
            <span class="seat-count" title="在管架数">${stat.count}</span>
            ${stat.pending ? `<span class="seat-pending" title="等待移交">⟳${stat.pending}</span>` : ''}
        `;
        row.addEventListener('click', () => setSeatFilter(sec.id));
        container.appendChild(row);
    });
}
