/**
 * ui/rosterPanel.js — 值班准备 / 交接班 / 不适合执勤面板（界面层）
 *
 * 对齐 CCAR-93TM-R6 §56（岗前准备五项）、§60（交接班检查单七项）与 §126–§128（不适勤权利）：
 *   · 岗前准备清单（domain/roster.prepChecklist）逐项展示，时长数据化；
 *   · 交接班检查单（data/handoverChecklist）逐项展示，含熟悉期与漏项后果；
 *   · 「申请不参加本次执勤」按钮 —— 恒可用（§128 权利），点击即 emit NOT_FIT_FOR_DUTY。
 *
 * 刷新时机由 ui/subscriptions.js 订阅 seats:* / duty:* / not_fit_for_duty 等事件驱动；
 * 本模块只读状态、只发事件，不直接改世界。
 */

import { state } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { escapeHtml, formatHMS } from '../core/dom.js';
import { prepChecklist, canReportUnfit } from '../domain/roster.js';
import { HANDOVER_CHECKLIST, FAMILIARIZE_SEC } from '../data/handoverChecklist.js';
import { ROSTER } from '../data/roster.js';

/** 绑定「申请不参加本次执勤」按钮（main.js 启动时调用一次） */
export function initRosterPanel() {
    const btn = document.getElementById('roster-unfit-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const verdict = canReportUnfit(state);
        // §128：报告不适合执勤是正当权利，事件恒可发出（不阻塞、不反问）
        bus.emit(EV.NOT_FIT_FOR_DUTY, { ...verdict, source: 'ui', at: state.time });
        updateRosterPanel();
    });
}

/** 岗前准备五项（§56） */
function renderPrep(prep) {
    const list = document.getElementById('roster-prep-list');
    if (!list) return;
    const rows = prep.items.map(item => `
        <div class="seat-row" title="逐项确认约 ${item.confirmSec}s">
            <span class="seat-code">${item.index}</span>
            <span class="seat-name">${escapeHtml(item.title)}</span>
            <span class="seat-freq">${item.confirmSec}s</span>
        </div>
        <div class="seat-info">${escapeHtml(item.detail)}</div>
    `).join('');
    list.innerHTML = `<div class="seat-hint">岗前准备（§56 · 逐项约 ${prep.confirmSec}s，共 ${prep.allSec}s）</div>`
        + rows;
}

/** 交接班检查单七项（§60） */
function renderHandover() {
    const list = document.getElementById('roster-handover-list');
    if (!list) return;
    const rows = HANDOVER_CHECKLIST.map(item => `
        <div class="seat-row" title="${escapeHtml(item.source)}">
            <span class="seat-code">${item.index}</span>
            <span class="seat-name">${escapeHtml(item.title)}</span>
            <span class="seat-freq">×${item.weight}</span>
        </div>
        <div class="seat-info">${escapeHtml(item.source)} · 漏项 ${escapeHtml(item.consequence)}</div>
    `).join('');
    list.innerHTML = `<div class="seat-hint">交接班检查单（§60 · 熟悉期 ${FAMILIARIZE_SEC}s · ${HANDOVER_CHECKLIST.length} 项）</div>`
        + rows;
}

/** 值班状态与适勤判定（§123–§128） */
function renderStatus(verdict) {
    const box = document.getElementById('roster-body');
    if (!box) return;
    const mode = ROSTER.mode === 'full' ? '整班制度' : '短班模式';
    const advice = verdict.stronglyAdvised
        ? `<strong>⚠ ${escapeHtml(verdict.reason)}</strong>`
        : escapeHtml(verdict.reason);
    box.innerHTML = `<div>值班模式：<strong>${escapeHtml(mode)}</strong>（${escapeHtml(ROSTER.mode)}/${escapeHtml(ROSTER.shiftMode)}）`
        + ` · 连续执勤上限 ${formatHMS(ROSTER.dutySecMax)}</div>`
        + `<div>已连续执勤 ${formatHMS(verdict.dutySec)} · 疲劳 ${verdict.fatigue}</div>`
        + `<div>${advice}</div>`;
}

/** 刷新面板（岗前准备 / 交接班检查单 / 适勤状态） */
export function updateRosterPanel() {
    renderPrep(prepChecklist(state));
    renderHandover();
    renderStatus(canReportUnfit(state));
}