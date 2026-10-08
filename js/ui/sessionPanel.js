/**
 * ui/sessionPanel.js — 班次与评分面板（界面层）
 *
 * 组成：
 *   · 「开始班次」/「结束并结算」按钮与难度选择（本模块自绑定，与 formBindings 的控件绑定同一模式）
 *   · 实时读数：绩效分/评级、落地/解锁进度、跑道构型、告警计数（口径取自 render/hud.js 的 hudModel）
 *   · 结算结果：评级、得分、目标达成清单、评分事件时间轴（可复盘）
 *
 * 刷新时机由 ui/subscriptions.js 订阅 session:started / session:ended / score:changed 驱动。
 */

import { hudModel } from '../render/hud.js';
import { startGameSession, endGameSession, sessionResult } from '../game/session.js';
import { scenarioList } from '../data/scenarios.js';
import { escapeHtml } from '../core/dom.js';

/** 绑定按钮（main.js 启动时调用一次） */
export function initSessionPanel() {
    const scenarioSel = document.getElementById('session-scenario');
    if (scenarioSel) {
        const levels = scenarioList();
        levels.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = l.name;
            opt.title = l.brief || '';
            scenarioSel.appendChild(opt);
        });
        // 内置关卡自带难度：选中关卡时停用难度下拉（难度随关卡设计），并刷新任务简述
        scenarioSel.addEventListener('change', () => {
            syncDifficultyEnabled();
            updateSessionPanel();
        });
    }

    document.getElementById('session-start-btn')?.addEventListener('click', () => {
        const difficulty = document.getElementById('session-difficulty')?.value || 'standard';
        const scenarioId = document.getElementById('session-scenario')?.value || undefined;
        startGameSession(scenarioId ? { scenarioId } : { difficulty });
    });

    document.getElementById('session-end-btn')?.addEventListener('click', () => {
        endGameSession({ reason: '管制员手动结束' });
    });

    document.getElementById('session-result-clear')?.addEventListener('click', hideResult);
}

/** 关卡下拉 → 难度下拉可用性（关卡自带难度时灰显） */
function syncDifficultyEnabled() {
    const scenarioSel = document.getElementById('session-scenario');
    const diffSel = document.getElementById('session-difficulty');
    if (!diffSel) return;
    const active = hudModel().sessionActive;
    const levelPicked = !!scenarioSel?.value;
    diffSel.disabled = active || levelPicked;
    diffSel.title = levelPicked ? '内置关卡自带难度（见关卡说明）' : '';
}

function hideResult() {
    const box = document.getElementById('session-result');
    if (box) box.classList.add('hidden');
}

/** 完成条件文案：落地架数 / 时限 */
function finishText(finish, landed) {
    if (!finish) return '无限流量';
    const parts = [];
    if (finish.count) parts.push(`落地 ${landed}/${finish.count}`);
    if (finish.timeLimit) parts.push(`时限 ${finish.timeLimit}s`);
    return parts.join(' · ') || '无限流量';
}

/** 实时读数区（班次进行中或已有结算结果时显示） */
function renderHud(m) {
    const box = document.getElementById('session-hud');
    if (!box) return;
    box.innerHTML = `
        <div class="session-row"><span>班次</span><strong>${escapeHtml(m.scenarioName || '--')}</strong>
            <em>${escapeHtml(m.difficulty || '')}</em></div>
        <div class="session-row"><span>时钟</span><strong>${escapeHtml(m.timeText)}</strong>
            <em>${escapeHtml(finishText(m.finish, m.landed))}</em></div>
        <div class="session-row"><span>绩效</span>
            <strong class="grade-${escapeHtml(m.grade)}">${escapeHtml(m.gradeLabel)}</strong>
            <em>${m.score} 分</em></div>
        <div class="session-row"><span>落地</span><strong>${m.landed} 架</strong>
            <em>在管 ${m.activeAircraft}/${m.maxAircraft} · 连击 ${m.streak}</em></div>
        <div class="session-row"><span>解锁分</span><strong>${m.progress}</strong>
            <em>构型 ${escapeHtml(m.configName || '--')}</em></div>
        <div class="session-row"><span>跑道</span>
            <strong>落 ${escapeHtml((m.runwayLand || []).join('/') || '--')}</strong>
            <em>起 ${escapeHtml((m.runwayStart || []).join('/') || '--')}</em></div>
        <div class="session-row"><span>告警</span>
            <strong class="${m.alerts ? 'session-alert' : ''}">${m.alerts}</strong>
            <em>间隔 ${m.separation} · MVA ${m.mva} · 复飞 ${m.goAround} · 复诵 ${m.readback}</em></div>
    `;
}

/** 结算结果区 */
function renderResult(box, result) {
    const objRows = result.objectives.items.map(it => `
        <li class="${it.ok ? 'obj-pass' : 'obj-fail'}">
            ${it.ok ? '✅' : '❌'} ${escapeHtml(it.label)}
            <em>${it.actual !== null ? escapeHtml(String(it.actual)) : '--'}${
    it.target !== null && it.target !== undefined ? '/' + escapeHtml(String(it.target)) : ''}${escapeHtml(it.unit || '')}</em>
        </li>`).join('');
    const tlRows = result.timeline.length
        ? result.timeline.map(e => `<li><em>${e.t}s</em> ${escapeHtml(e.text)}${
            e.weight ? `<span class="${e.weight > 0 ? 'ev-good' : 'ev-bad'}">${e.weight > 0 ? '+' : ''}${e.weight}</span>` : ''}</li>`).join('')
        : '<li class="session-hint">本班次无评分事件</li>';

    box.classList.remove('hidden');
    box.innerHTML = `
        <div class="result-head">
            <span class="result-grade grade-${escapeHtml(result.grade)}">${escapeHtml(result.gradeLabel)}</span>
            <span class="result-score">${result.score} 分</span>
            <button id="session-result-clear" class="result-clear" title="关闭结果">×</button>
        </div>
        <div class="result-line">${escapeHtml(result.scenarioName || '--')} · 用时 ${result.simDuration}s · `
        + `落地 ${result.landed} 架 · 平均延误 ${result.avgDelaySec}s · 指令 ${result.inputs} 条</div>
        <div class="result-line">结算状态：${escapeHtml(result.outcomeLabel || '--')}`
        + `${result.performanceScore !== result.score ? ` · 原始绩效 ${result.performanceScore} 分` : ''}</div>
        <div class="result-line">得分构成：安全/效率扣分 ${result.penaltyTotal} · 奖励 +${result.bonusTotal} · `
        + `连击 ${result.streak} · 未复诵 ${result.counts.readback}</div>
        <div class="result-line">结束原因：${escapeHtml(result.reason)} · 跑道 落 `
        + `${escapeHtml((result.runway.land || []).join('/') || '--')} / 起 ${escapeHtml((result.runway.start || []).join('/') || '--')}</div>
        <h4>目标达成 ${result.objectives.passed}/${result.objectives.total}</h4>
        <ul class="result-objectives">${objRows}</ul>
        <h4>事件时间轴（最近 ${result.timeline.length} 条）</h4>
        <ul class="result-timeline">${tlRows}</ul>
    `;
    document.getElementById('session-result-clear')?.addEventListener('click', hideResult);
}

/** 刷新面板（按钮态 / 实时读数 / 结算结果） */
export function updateSessionPanel() {
    const m = hudModel();
    const result = sessionResult();

    const startBtn = document.getElementById('session-start-btn');
    const endBtn = document.getElementById('session-end-btn');
    const scenarioSel = document.getElementById('session-scenario');
    if (startBtn) startBtn.textContent = m.sessionActive ? '🔄 重开班次' : '🎬 开始班次';
    if (endBtn) endBtn.disabled = !m.sessionActive;
    if (scenarioSel) scenarioSel.disabled = m.sessionActive;
    syncDifficultyEnabled();

    if (m.sessionActive || result) {
        renderHud(m);
    }
    const box = document.getElementById('session-hud');
    const picked = scenarioSel?.value ? scenarioList().find(l => l.id === scenarioSel.value) : null;
    // 未开始班次且已选中内置关卡时，优先显示关卡简述（结算结果在下方结果面板中展示）
    if (!m.sessionActive && picked && box) {
        box.innerHTML = `<div class="session-hint"><strong>${escapeHtml(picked.name)}</strong>`
            + `（${escapeHtml(picked.difficulty)}）<br>${escapeHtml(picked.brief || '')}<br>`
            + `进场点 / 航司 / 事件（${picked.events} 条）/ 目标（${picked.objectives} 项）均由关卡包提供。</div>`;
    } else if (!m.sessionActive && !result && box) {
        box.innerHTML = '<div class="session-hint">点击「开始班次」装载关卡：导演按进场点 / 航司表注入无限流量，'
            + '并按目标清单结算评级。导入机场位置文件后，直接使用其 [scenario] 事件与跑道构型。</div>';
    }

    const resultBox = document.getElementById('session-result');
    if (!resultBox) return;
    if (result) renderResult(resultBox, result);
    else hideResult();
}
