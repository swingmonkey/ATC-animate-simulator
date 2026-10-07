/**
 * ui/console.js — 指令台 2.0（界面层）
 *
 * 设计（docs/PLAN-v2.md §7.4、§8.1）：
 *   · **合法且推荐**：按选中飞机的当前席位（TWR/APP/ACC）与阶段，从 data/phraseology.js 取用语模板；
 *     非法项灰显（disabled）并以 domain/phases.js 的 issueHint() 作为原因提示 —— 教玩家"此刻能说什么"
 *   · **一键可点**：点击模板即用该机呼号填充并直接下发（走 ui/commPanel.js 的 submitAtcText，
 *     与输入框同一条路径：录制 → 播报 → 执行 → 刷新）
 *   · **复诵回显**：显示该机最近一次复诵（domain/readback.js），漏项未纠正时高亮，
 *     并提供「重新下发（要求复诵）」按钮原地纠正
 *
 * 刷新：main.js 动画循环按 PROGRESS_REFRESH_MS 节流调用 updateConsole()（读数），
 * 选中/席位/阶段变化时由 ui/subscriptions.js 以 force=true 立即刷新（含模板重建）。
 */

import { state } from '../core/store.js';
import { escapeHtml } from '../core/dom.js';
import { PROGRESS_REFRESH_MS } from '../core/constants.js';
import { altOf } from '../core/accessors.js';
import { canIssue, issueHint, phaseLabel } from '../domain/phases.js';
import { readbackTextOf, isReadbackPending } from '../domain/readback.js';
import { clearanceText } from '../domain/clearances.js';
import { PHRASE_GROUPS, phrasesForUnit, fillPhrase } from '../data/phraseology.js';
import { unit, approachLabel } from '../data/atcUnits.js';
import { runwayEndsFor } from '../domain/airspace.js';
import { submitAtcText } from './commPanel.js';

let _lastSig = '';
let _lastRender = 0;

/** 选中航空器（指令台的操作对象） */
function selectedAircraft() {
    const sel = state.selectedItem;
    if (!sel || sel.type !== 'aircraft') return null;
    return state.aircraft.find(a => a.id === sel.id) || null;
}

/** 直飞模板用的航路点：优先取该机下一个航路点，其次航线末点，最后焦点机场 */
function nextFixFor(ac) {
    const route = ac.routeId ? state.routes.find(r => r.id === ac.routeId) : null;
    const idx = ac.nextWaypointIdx;
    if (route && Number.isFinite(idx) && route.points[idx]) return route.points[idx].name;
    if (route && route.points.length) return route.points[route.points.length - 1].name;
    return state.focusAirport || '本场';
}

/** 模板占位符上下文（呼号 / 跑道 / 航路点） */
function phraseContext(ac) {
    const ends = runwayEndsFor(state.focusAirport);
    return {
        cs: ac.flightNo,
        rwy: ac.runway || ends[0] || '18',
        fix: nextFixFor(ac)
    };
}

/** 绑定事件（main.js 启动时调用一次；模板按钮用事件委托，故只需绑一次） */
export function initConsolePanel() {
    const box = document.getElementById('console-templates');
    box?.addEventListener('click', e => {
        const btn = e.target.closest('.console-btn');
        if (!btn || btn.disabled) return;
        submitAtcText(btn.dataset.phrase || '');
        updateConsole(true);                 // 立即回显新指令与复诵
    });
    document.getElementById('console-reissue-btn')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        if (ac && ac.lastCommandText) {
            submitAtcText(ac.lastCommandText);   // 原样重发 = 要求复诵
            updateConsole(true);
        }
    });
}

/** 渲染模板按钮组（按组分组；非法项灰显并给出原因） */
function renderTemplates(ac) {
    const box = document.getElementById('console-templates');
    if (!box) return;
    const list = phrasesForUnit(ac.unit || 'ACC');
    const ctx = phraseContext(ac);
    const parts = [];
    PHRASE_GROUPS.forEach(g => {
        const items = list.filter(p => p.group === g);
        if (!items.length) return;
        const buttons = items.map(p => {
            const text = fillPhrase(p.text, ctx);
            const ok = canIssue(ac, p.issue);
            const hint = ok ? text : `${issueHint(ac, p.issue)}（${p.label}）`;
            return `<button class="console-btn${ok ? '' : ' console-btn-off'}"`
                + `${ok ? '' : ' disabled'} data-phrase="${escapeHtml(text)}"`
                + ` title="${escapeHtml(hint)}">${escapeHtml(p.label)}</button>`;
        }).join('');
        parts.push(`<div class="console-group"><span class="console-group-title">${escapeHtml(g)}</span>`
            + `<div class="console-buttons">${buttons}</div></div>`);
    });
    box.innerHTML = parts.join('');
}


/** 渲染选中机摘要与复诵回显 */
function renderReadout(ac) {
    const target = document.getElementById('console-target');
    const readback = document.getElementById('console-readback');
    const reissue = document.getElementById('console-reissue-btn');

    if (target) {
        if (!ac) {
            target.innerHTML = '<span class="console-hint">点击进程单或雷达标签选中航空器：'
                + '此处按该席位列出推荐用语（灰显 = 当前阶段不可下发）</span>';
        } else {
            const seat = unit(ac.unit || 'ACC');
            target.innerHTML = `
                <div class="console-row"><strong>${escapeHtml(ac.flightNo)}</strong>
                    <em style="color:${seat.color}">${escapeHtml(seat.short)}</em>
                    <em>${escapeHtml(phaseLabel(ac.phase))}</em></div>
                <div class="console-row">${Math.round(altOf(ac))}m ·
                    ${Math.round(ac.displaySpeed ?? ac.speed)}kt ·
                    ${Math.round(ac.displayHeading ?? ac.heading ?? 0)}°</div>
                <div class="console-row">跑道 ${escapeHtml(ac.runway || '--')} ·
                    ${escapeHtml(approachLabel(ac.approachType))} · ${escapeHtml(clearanceText(ac))}</div>
            `;
        }
    }
    if (readback) {
        readback.className = 'console-readback' + (ac && isReadbackPending(ac) ? ' console-readback-warn' : '');
        readback.textContent = ac ? readbackTextOf(ac) : '';
    }
    if (reissue) {
        const pending = !!ac && isReadbackPending(ac) && !!ac.lastCommandText;
        reissue.classList.toggle('hidden', !pending);
    }
}

/**
 * 刷新指令台（读数 250ms 节流；模板仅在选中机/席位/阶段/跑道签名变化时重建）。
 * @param {boolean} [force] 忽略节流（选中/席位/阶段变化时由订阅调用）
 */
export function updateConsole(force = false) {
    const ac = selectedAircraft();
    const sig = ac
        ? `${ac.id}|${ac.unit || ''}|${ac.phase || ''}|${ac.runway || ''}|${ac.approachType || ''}|${ac.landed ? 1 : 0}`
        : '-';

    const now = Date.now();
    if (!force && now - _lastRender < PROGRESS_REFRESH_MS) return;
    _lastRender = now;

    if (sig !== _lastSig || force) {
        if (ac) renderTemplates(ac);
        else {
            const box = document.getElementById('console-templates');
            if (box) box.innerHTML = '';
        }
    }
    _lastSig = sig;
    renderReadout(ac);
}
