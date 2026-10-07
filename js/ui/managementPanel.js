/**
 * ui/managementPanel.js — 空管单位经营面板（界面层）
 *
 * 经营层「人 / 钱 / 设施 / 合同 / 局方」的可视化与操作入口：
 *   · 概览：日次 / 资金 / 声望 / 技术等级 / ILS 类别 / 日收支 / 年架次
 *   · 员工：招聘（见习 / 管制员）、培训、任命主管、席位安排
 *   · 设施：塔台 / 进近 / 区域 / 培训室 / 休息室 / 设备机房
 *   · 技术：程序管制 → 监视管制、ILS Ⅱ 类、独立平行进近
 *   · 合同：区域支线 / 干线 / 枢纽（年架次计入席位门槛）
 *   · 局方：实验运行申请与批复状态；「结束今日并结算」推进日次
 *
 * 与现场层解耦：本模块只读 managementSummary() 快照、只调 game/management.js 的动作，
 * 刷新统一由 ui/subscriptions.js 订阅 management:* 事件驱动（禁止手调 updateXxx）。
 */

import { escapeHtml } from '../core/dom.js';
import { STAFF_ROLES } from '../data/management.js';
import {
    managementSummary, hireStaff, appointSupervisor, trainStaff,
    buildRoom, upgradeTech, assignSeat, signContract, requestTrialRun, endDay
} from '../game/management.js';

/** 最近一次操作反馈（成功 / 拒绝原因），渲染在概览下方 */
let _status = '';

const money = v => `${Math.round(Number(v) || 0).toLocaleString('zh-CN')} 元`;
const signedMoney = v => `${Number(v) >= 0 ? '+' : ''}${money(v)}`;
const count = v => (Number(v) || 0).toLocaleString('zh-CN');

function setStatus(result) {
    if (!result || !result.reason) { _status = ''; return; }
    _status = `${result.ok ? '✅' : '⚠️'} ${result.reason}`;
}

/** data-act → 经营动作（返回 {ok, reason, ...}，失败时带原因） */
function runAction(act, data) {
    switch (act) {
        case 'hire': return hireStaff(data.role);
        case 'appoint': return appointSupervisor(data.staff);
        case 'train': return trainStaff(data.staff);
        case 'build': return buildRoom(data.room);
        case 'upgrade': return upgradeTech(data.upgrade);
        case 'sign': return signContract(data.template);
        case 'trial': return requestTrialRun();
        case 'endday': return endDay();
        default: return null;
    }
}

/** 绑定经营面板交互（main.js 启动时调用一次） */
export function initManagementPanel() {
    const section = document.getElementById('management-section');
    if (!section) return;

    /* 按钮在每次渲染后重建，故统一用事件委托；select 的 change 走单独分支 */
    section.addEventListener('click', ev => {
        const el = ev.target.closest('[data-act]');
        if (!el || el.tagName === 'SELECT' || el.disabled) return;
        setStatus(runAction(el.dataset.act, el.dataset));
        updateManagementPanel();
    });

    section.addEventListener('change', ev => {
        const el = ev.target.closest('select[data-act="seat"]');
        if (!el) return;
        setStatus(assignSeat(el.dataset.staff, el.value || null));
        updateManagementPanel();
    });
}

/* ---------------- 渲染 ---------------- */

function statusLine() {
    return _status ? `<div class="mgmt-status">${escapeHtml(_status)}</div>` : '';
}

/** 概览：日次 / 资金 / 声望 / 技术与日收支 / 年架次 / 人员 */
function renderOverview(m) {
    const box = document.getElementById('management-body');
    if (!box) return;
    const p = m.daily;
    box.innerHTML = `
        <div class="session-row"><span>日次</span><strong>第 ${m.day} 日</strong>
            <em>${escapeHtml(m.techName)} · ILS ${m.ilsCat} 类 · 平行进近 ${escapeHtml(m.parallelApproach === 'independent' ? '独立' : '未开放')}</em></div>
        <div class="session-row"><span>资金</span><strong>${money(m.cash)}</strong>
            <em>⭐ 声望 ${m.reputation}</em></div>
        <div class="session-row"><span>日收支</span>
            <strong class="${p.net >= 0 ? 'mgmt-pos' : 'mgmt-neg'}">${signedMoney(p.net)}</strong>
            <em>收入 ${money(p.revenue)}</em></div>
        <div class="session-row"><span>日支出</span><strong>${money(p.salary)}</strong>
            <em>维护 ${money(p.maintenance)}</em></div>
        <div class="session-row"><span>流量</span><strong>${count(m.totalAnnualMovements)}</strong>
            <em>年架次 · 合同 ${m.contractCount} 份</em></div>
        <div class="session-row"><span>人员</span><strong>${m.staffCount}</strong>
            <em>见习 ${m.staffCounts.trainee} · 管制员 ${m.staffCounts.controller} · 主管 ${m.staffCounts.supervisor}${
    m.trainingCount ? ` · 培训中 ${m.trainingCount}` : ''}</em></div>
        ${statusLine()}
    `;
}

/** 席位下拉：已开放席位 + 当前席位（保证当前值不丢） */
function seatOptions(m, staff) {
    const seats = [...m.availableSeats];
    if (staff.seat && !seats.includes(staff.seat)) seats.push(staff.seat);
    const opts = [`<option value="">— 不值守席位 —</option>`];
    for (const seat of seats) {
        const taken = m.seats[seat] && m.seats[seat] !== staff.id;
        opts.push(`<option value="${escapeHtml(seat)}"${staff.seat === seat ? ' selected' : ''}${
            taken ? ' disabled' : ''}>${escapeHtml(seat)}${taken ? '（已占用）' : ''}</option>`);
    }
    return opts.join('');
}

/** 员工列表：招聘 / 培训 / 任命 / 排席 */
function renderStaff(m) {
    const list = document.getElementById('management-staff-list');
    if (!list) return;

    const hires = m.hireOptions.map(o => `
        <button class="mgmt-btn" data-act="hire" data-role="${escapeHtml(o.id)}"${o.ok ? '' : ' disabled'}
            title="${escapeHtml(o.reason)}">+ ${escapeHtml(o.name)} · 月薪 ${count(o.salary)}</button>`).join('');

    const rows = m.staff.map(s => {
        const role = STAFF_ROLES[s.role] || { name: s.role, canControl: false };
        const tags = [];
        if (s.trainingLeft > 0) tags.push(`培训中 剩 ${s.trainingLeft} 天`);
        if (s.seat) tags.push(`值守 ${escapeHtml(s.seat)}`);
        if (s.fatigue > 0) tags.push(`疲劳 ${s.fatigue}`);
        const actions = [];
        if (s.role === 'trainee') {
            actions.push(`<button class="console-btn" data-act="train" data-staff="${escapeHtml(s.id)}"
                title="培训 3 天（每人每日 20000 元，结业转正为管制员）"${s.trainingLeft > 0 ? ' disabled' : ''}>🎓 培训</button>`);
        }
        if (s.role === 'controller') {
            actions.push(`<button class="console-btn" data-act="appoint" data-staff="${escapeHtml(s.id)}"
                title="任命为管制主管（任命费 60000 元，声望 +2）">🏅 任命主管</button>`);
        }
        if (role.canControl) {
            actions.push(`<select class="mgmt-seat-select" data-act="seat" data-staff="${escapeHtml(s.id)}"
                title="安排管制席位">${seatOptions(m, s)}</select>`);
        }
        return `
        <div class="mgmt-staff">
            <div class="mgmt-staff-head">
                <span class="seat-code">${escapeHtml(role.name)}</span>
                <span class="seat-name">${escapeHtml(s.name)}</span>
                <span class="seat-freq">月薪 ${count(s.salary)}</span>
            </div>
            ${tags.length ? `<div class="mgmt-tags">${tags.join(' · ')}</div>` : ''}
            ${actions.length ? `<div class="mgmt-actions">${actions.join('')}</div>` : ''}
        </div>`;
    }).join('');

    list.innerHTML = `<div class="seat-hint">员工 ${m.staffCount} 人（施工 / 招聘会即时扣费；培训费按日结算）</div>`
        + `<div class="mgmt-actions mgmt-hire-row">${hires}</div>`
        + (rows || '<div class="seat-hint">暂无员工 —— 先招聘见习管制员或管制员</div>');
}

/** 设施建设 */
function renderRooms(m) {
    const list = document.getElementById('management-room-list');
    if (!list) return;
    const rows = m.buildOptions.map(o => {
        const disabled = o.ok ? '' : ' disabled';
        const mark = o.built ? '✅' : '➕';
        return `<button class="mgmt-btn" data-act="build" data-room="${escapeHtml(o.id)}"${disabled}
            title="${escapeHtml(o.reason)}">${mark} ${escapeHtml(o.name)} · ${count(o.cost)} 元</button>`;
    }).join('');
    list.innerHTML = `<div class="seat-hint">设施 ${m.roomCount} 间（每间每日维护 2000 元；管制现场决定可开席位）</div>`
        + `<div class="mgmt-actions mgmt-room-row">${rows}</div>`;
}

/** 技术 / 设备升级 */
function renderTech(m) {
    const list = document.getElementById('management-tech-list');
    if (!list) return;
    const rows = m.upgradeOptions.map(o => {
        const disabled = o.ok ? '' : ' disabled';
        return `<button class="mgmt-btn" data-act="upgrade" data-upgrade="${escapeHtml(o.id)}"${disabled}
            title="${escapeHtml(o.brief)}｜${escapeHtml(o.reason)}">🔧 ${escapeHtml(o.name)} · ${count(o.cost)} 元</button>`;
    }).join('');
    list.innerHTML = `<div class="seat-hint">技术等级：${escapeHtml(m.techName)}（需先建设设备机房）</div>`
        + `<div class="mgmt-actions mgmt-tech-row">${rows}</div>`;
}

/** 航班合同 */
function renderContracts(m) {
    const list = document.getElementById('management-contract-list');
    if (!list) return;
    const rows = m.contractOptions.map(o => {
        const disabled = o.ok ? '' : ' disabled';
        const mark = o.signed ? '✅' : '📄';
        return `<button class="mgmt-btn" data-act="sign" data-template="${escapeHtml(o.id)}"${disabled}
            title="${escapeHtml(o.brief)}｜${escapeHtml(o.reason)}">${mark} ${escapeHtml(o.name)} · 年 ${count(o.annualMovements)} 架次 · ${count(o.revenuePerMovement)} 元/架次${o.minReputation ? ` · 需声望 ${o.minReputation}` : ''}</button>`;
    }).join('');
    list.innerHTML = `<div class="seat-hint">合同年架次之和决定应设扇区/席位（§47-§51 同一门槛口径）</div>`
        + `<div class="mgmt-actions mgmt-contract-row">${rows}</div>`;
}

/** 席位规划 / 已开放 / 缺设施 */
function renderSeats(m) {
    const list = document.getElementById('management-seat-list');
    if (!list) return;
    const line = (label, arr) => {
        const text = arr.length ? arr.map(escapeHtml).join(' · ') : '--';
        return `<div class="seat-row"><span class="seat-name">${label}</span><span class="seat-freq">${text}</span></div>`;
    };
    list.innerHTML = `<div class="seat-hint">按当前流量推导的席位设置（规划 → 需建设施才能开放 → 安排管制员值守）</div>`
        + line('塔台现场', m.sectorPlan.tower)
        + line('进近现场', m.sectorPlan.approach)
        + line('区域现场', m.sectorPlan.area)
        + line('已开放', m.availableSeats)
        + (m.missingSeats.length ? line('缺设施', m.missingSeats) : '');
}

/** 局方实验运行 */
function renderTrial(m) {
    const list = document.getElementById('management-trial-list');
    if (!list) return;
    const t = m.trial;
    const applied = t.appliedDay ? `递交第 ${t.appliedDay} 日` : '未递交';
    const decided = t.decidedDay ? ` · 批复第 ${t.decidedDay} 日` : '';
    const expires = t.expiresDay ? ` · 有效期至第 ${t.expiresDay} 日` : '';
    list.innerHTML = `<div class="seat-hint">局方实验运行审批（声望门槛 55，需监视管制 + 设备机房）</div>`
        + `<div class="seat-row"><span class="seat-name">状态</span>
            <span class="seat-freq">${escapeHtml(m.trialStatusName)}</span></div>`
        + `<div class="seat-info">${escapeHtml(applied)}${escapeHtml(decided)}${escapeHtml(expires)}${
            t.note ? `<br>${escapeHtml(t.note)}` : ''}</div>`;

    const btn = document.getElementById('management-trial-btn');
    if (btn) {
        btn.disabled = !m.canRequestTrial;
        btn.title = m.canRequestTrialReason || '';
    }
}

/** 刷新经营面板（事件订阅与启动首次刷新共用） */
export function updateManagementPanel() {
    const box = document.getElementById('management-body');
    if (!box) return;
    const m = managementSummary();
    if (!m) {
        box.innerHTML = '<div class="seat-hint">经营状态未初始化（main.js 启动时应调用 startManagement）</div>';
        return;
    }

    renderOverview(m);
    renderStaff(m);
    renderRooms(m);
    renderTech(m);
    renderContracts(m);
    renderSeats(m);
    renderTrial(m);

    const dayBtn = document.getElementById('management-day-btn');
    if (dayBtn) dayBtn.textContent = `⏭ 结束第 ${m.day} 日并结算`;
}