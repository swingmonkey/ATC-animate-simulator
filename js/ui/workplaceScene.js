/** 经营快照驱动的 2D 管制室俯视图。画面动作只作状态反馈，不改变班次时钟。 */
import { bus, EV } from '../core/eventBus.js';
import { state } from '../core/store.js';
import { escapeHtml } from '../core/dom.js';
import { WORKSPACES, WORKSPACE_ORDER } from '../data/workspaces.js';
import { managementSummary } from '../game/management.js';

let siteId = 'tower';
let selectedSeat = 'TWR';
let openRadar = null;
let currentModel = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const placeLabel = seat => seat.replace('APP-', '进近·').replace('ACC-', '区调·');
const statusText = { staffed: '人员值守', vacant: '席位空缺', locked: '未开放' };

/** 所有可见状态来自同一经营快照，避免动画捏造在岗人数。 */
export function sceneModel(summary, key) {
    const site = WORKSPACES[key] || WORKSPACES.tower;
    const built = !!summary?.roomCounts?.[site.id];
    const open = new Set(summary?.availableSeats || []);
    const staff = summary?.staff || [];
    const appInTower = !!summary?.sectorPlan?.tower?.includes('APP');
    const seats = site.seats.map(slot => {
        const relocated = slot.code === 'APP' && (site.id === 'tower' ? !appInTower : appInTower);
        const occupant = staff.find(person => person.seat === slot.code) || null;
        const active = built && !relocated && open.has(slot.code);
        return { ...slot, occupant: active ? occupant : null,
            status: active ? (occupant ? 'staffed' : 'vacant') : 'locked' };
    });
    const seatedIds = new Set(seats.filter(seat => seat.occupant).map(seat => seat.occupant.id));
    return { site, built, seats, staffed: seats.filter(seat => seat.status === 'staffed').length,
        open: seats.filter(seat => seat.status !== 'locked').length,
        standby: built && site.id === 'tower' ? staff.filter(person => !person.seat && person.role !== 'supervisor' && !seatedIds.has(person.id)) : [],
        supervisor: built && site.id === 'tower' ? staff.find(person => person.role === 'supervisor' && !person.seat) : null };
}

function runwayWindow() {
    return `<rect x="52" y="43" width="896" height="109" rx="8" fill="#91bbc2"/>
        <path d="M52 120 L948 120" stroke="#d2e5dc" stroke-width="16"/>
        <path d="M52 128 L948 128" stroke="#667f83" stroke-width="5" stroke-dasharray="48 22"/>
        <path d="M190 64 L810 64" stroke="#344b56" stroke-width="34" stroke-linecap="round"/>
        <path d="M202 64 L798 64" stroke="#eef2eb" stroke-width="2" stroke-dasharray="27 21"/>
        <path d="M92 99 L304 99 M696 99 L908 99" stroke="#d4d9c5" stroke-width="3" stroke-dasharray="14 12"/>
        <path d="M296 43 V152 M500 43 V152 M704 43 V152" stroke="#cde4e2" stroke-width="9" opacity=".8"/>
        <text x="73" y="150" class="scene-svg-small">跑道 / 滑行道目视窗口</text>`;
}

function statusBoard(site) {
    const marks = site.id === 'area' ? '跨区移交  ·  高度层  ·  航路流量'
        : '进场排序  ·  进离场协调  ·  天气监视';
    return `<rect x="72" y="54" width="856" height="89" rx="10" fill="#142d39" stroke="#648188" stroke-width="5"/>
        <path d="M104 111 L178 89 L230 100 L295 76 L365 92 L445 67 L520 92 L590 78 L674 103 L748 70 L835 98" fill="none" stroke="#55beb5" stroke-width="2" opacity=".75"/>
        <circle class="scene-pulse" cx="445" cy="67" r="4" fill="#a8f1d5"/>
        <text x="95" y="134" class="scene-svg-small">${marks}</text>`;
}

function staffFigure(x, y, label, className = '') {
    return `<g class="scene-person ${className}" transform="translate(${x} ${y})">
        <ellipse cy="8" rx="15" ry="7" fill="#071e28" opacity=".28"/>
        <path d="M-12 3 Q-15 -14 -7 -21 L7 -21 Q15 -14 12 3Z" fill="#557a82" stroke="#b9d5d2" stroke-width="2"/>
        <circle cy="-17" r="8" fill="#d7b89b"/>
        <path d="M-8 -20 Q0 -31 8 -20" fill="none" stroke="#243946" stroke-width="5" stroke-linecap="round"/>
        ${label ? `<text y="31" text-anchor="middle" class="scene-svg-person-label">${escapeHtml(label)}</text>` : ''}
    </g>`;
}

function seatSvg(seat) {
    const { x, y } = seat;
    const name = seat.occupant?.name || '';
    const code = escapeHtml(seat.code);
    const status = seat.status;
    return `<g class="scene-desk ${status}" data-seat="${code}" role="button" tabindex="0" aria-label="${code}，${statusText[status]}${name ? `，${escapeHtml(name)}` : ''}">
        <rect x="${x - 74}" y="${y - 51}" width="148" height="81" rx="10" class="scene-desk-top"/>
        <rect x="${x - 60}" y="${y - 43}" width="120" height="52" rx="5" class="scene-monitor-frame"/>
        <rect x="${x - 53}" y="${y - 37}" width="106" height="40" rx="2" class="scene-monitor-glass"/>
        <rect x="${x - 52}" y="${y - 36}" width="13" height="38" rx="2" class="scene-monitor-scan"/>
        <circle cx="${x}" cy="${y - 17}" r="14" fill="none" stroke="#56b9b5" opacity=".5" stroke-width="1"/>
        <path d="M${x - 38} ${y - 20} L${x + 34} ${y - 20} M${x} ${y - 36} V${y + 1}" stroke="#81c5bf" opacity=".34" stroke-width="1"/>
        <circle class="scene-screen-dot" cx="${x + 25}" cy="${y - 18}" r="3" fill="#a6f7d6"/>
        <rect x="${x - 29}" y="${y + 10}" width="58" height="8" rx="3" fill="#304d53"/>
        <rect x="${x - 30}" y="${y + 34}" width="60" height="36" rx="14" class="scene-chair"/>
        ${seat.occupant ? staffFigure(x, y + 55, '', 'scene-seated') : ''}
        <rect x="${x - 46}" y="${y + 73}" width="92" height="24" rx="12" class="scene-seat-tag"/>
        <text x="${x}" y="${y + 89}" text-anchor="middle" class="scene-svg-tag">${code}</text>
        <circle cx="${x + 57}" cy="${y - 39}" r="6" class="scene-status-light"/>
    </g>`;
}

function roomSvg(model) {
    const { site, built, seats, standby, supervisor } = model;
    const windowContent = site.id === 'tower' ? runwayWindow() : statusBoard(site);
    const standbyFigures = standby.slice(0, 3).map((person, i) => staffFigure(740 + i * 48, 472, person.name)).join('');
    return `<svg class="scene-map" viewBox="0 0 1000 560" role="img" aria-label="${site.name}二维俯视图">
        <defs>
            <pattern id="floor-grid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#9db3b5" stroke-width=".7" opacity=".13"/></pattern>
            <pattern id="noise-lines" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M0 9L9 0" stroke="#cde6df" stroke-width=".45" opacity=".1"/></pattern>
            <linearGradient id="scene-floor-gradient" x2="1" y2="1"><stop stop-color="#28424b"/><stop offset="1" stop-color="#183038"/></linearGradient>
        </defs>
        <rect width="1000" height="560" fill="#0c242b"/>
        <rect x="35" y="30" width="930" height="500" rx="12" fill="url(#scene-floor-gradient)" stroke="#748f91" stroke-width="11"/>
        <rect x="44" y="38" width="912" height="484" rx="8" fill="url(#floor-grid)"/>
        <rect x="44" y="38" width="912" height="484" rx="8" fill="url(#noise-lines)"/>
        ${windowContent}
        <path d="M64 171 H936" stroke="#9db8b6" stroke-width="6" opacity=".5"/>
        <path d="M75 374 H925" stroke="#799599" stroke-width="2" stroke-dasharray="8 8" opacity=".43"/>
        <rect x="65" y="402" width="158" height="90" rx="10" fill="#314c51" stroke="#6a8c88" stroke-width="2"/>
        <rect x="84" y="420" width="120" height="30" rx="3" fill="#132f39"/>
        <path d="M101 438 H185" stroke="#7bd5c9" stroke-width="2" opacity=".7"/>
        <text x="144" y="478" text-anchor="middle" class="scene-svg-small">值班记录 / 通报台</text>
        <rect x="685" y="400" width="250" height="103" rx="12" fill="#2c464d" stroke="#648783" stroke-width="2"/>
        <text x="706" y="424" class="scene-svg-small">待命与交接区</text>
        ${standbyFigures}
        ${supervisor ? `<g id="scene-patrol">${staffFigure(0, 0, supervisor.name, 'scene-supervisor')}</g>` : ''}
        ${seats.map(seatSvg).join('')}
        <rect x="452" y="510" width="96" height="28" rx="4" fill="#172f36" stroke="#829b97" stroke-width="2"/>
        <path d="M468 524 H532 M519 516 L532 524 L519 532" stroke="#b1d3ca" stroke-width="2" fill="none"/>
        ${built ? '' : `<rect x="39" y="34" width="922" height="493" rx="10" fill="#091921" opacity=".73" pointer-events="none"/>
            <text x="500" y="276" text-anchor="middle" class="scene-svg-unbuilt">现场尚未建设</text>
            <text x="500" y="313" text-anchor="middle" class="scene-svg-unbuilt-sub">在经营指挥台建设${site.name}后，席位和人员会显示在此</text>`}
    </svg>`;
}

function writeText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function selectedFrom(model) {
    return model.seats.find(seat => seat.code === selectedSeat) || model.seats[0];
}

export function updateWorkplaceScene() {
    const summary = managementSummary();
    const viewport = document.getElementById('scene-viewport');
    if (!viewport || !summary) return;
    currentModel = sceneModel(summary, siteId);
    const model = currentModel;
    selectedSeat = selectedFrom(model).code;
    const tabBox = document.getElementById('scene-site-tabs');
    tabBox.innerHTML = WORKSPACE_ORDER.map(key => {
        const item = WORKSPACES[key];
        const active = key === siteId;
        const built = !!summary.roomCounts[key];
        return `<button type="button" data-site="${key}" aria-pressed="${active}"><span>${item.short}</span>${item.name}<small>${built ? '已建设' : '待建设'}</small></button>`;
    }).join('');
    viewport.innerHTML = roomSvg(model);
    writeText('scene-stage-title', `${model.site.name} · ${summary.multiAirport?.airportName || '当前机场'}`);
    writeText('scene-room-name', model.site.name);
    writeText('scene-room-brief', model.site.brief);
    writeText('scene-room-state', model.built ? '已投入使用' : '待建设');
    writeText('scene-live-label', `第 ${summary.day} 日 · ${state.isPlaying ? '班次运行中' : '班次已暂停'}`);
    document.getElementById('scene-metrics').innerHTML = `
        <div><strong>${model.open}</strong><span>开放席位</span></div>
        <div><strong>${model.staffed}</strong><span>人员值守</span></div>
        <div><strong>${Math.max(0, model.open - model.staffed)}</strong><span>待安排</span></div>`;
    document.getElementById('scene-seat-list').innerHTML = model.seats.map(seat =>
        `<button type="button" data-seat="${escapeHtml(seat.code)}" class="scene-seat-chip ${seat.status}" aria-pressed="${seat.code === selectedSeat}">`
        + `<span class="scene-chip-light" aria-hidden="true"></span>${escapeHtml(seat.code)}</button>`
    ).join('');
    updateSeatDetail();
}

function updateSeatDetail() {
    if (!currentModel) return;
    const seat = selectedFrom(currentModel);
    document.querySelectorAll('.scene-desk').forEach(node => {
        node.classList.toggle('selected', node.dataset.seat === seat.code);
    });
    document.querySelectorAll('.scene-seat-chip').forEach(node => {
        node.setAttribute('aria-pressed', node.dataset.seat === seat.code ? 'true' : 'false');
    });
    const detail = document.getElementById('scene-seat-detail');
    const button = document.getElementById('scene-enter-radar');
    const message = seat.status === 'staffed' ? `${seat.occupant.name} · 已安排值守`
        : seat.status === 'vacant' ? '席位已开放，尚未安排管制员。'
            : currentModel.built ? '当前合同流量或技术条件尚未开放该席位。' : '先建设此现场，再安排管制员。';
    detail.innerHTML = `<strong>${escapeHtml(placeLabel(seat.code))}</strong><span class="scene-detail-status ${seat.status}">${statusText[seat.status]}</span><p>${escapeHtml(message)}</p>`;
    button.disabled = seat.status !== 'staffed';
    button.textContent = seat.status === 'staffed' ? `进入 ${currentModel.site.short} 雷达视角 →` : '安排值守后可进入席位';
}

function selectSeat(code) {
    if (!currentModel?.seats.some(seat => seat.code === code)) return;
    selectedSeat = code;
    updateSeatDetail();
}

function animatePatrol(time) {
    const actor = document.getElementById('scene-patrol');
    if (actor && document.body.dataset.platformView === 'scene' && !reducedMotion.matches) {
        const path = [[295, 379], [620, 379], [620, 184], [295, 184]];
        const phase = (time / 9000) % path.length;
        const index = Math.floor(phase);
        const next = (index + 1) % path.length;
        const t = phase - index;
        const x = path[index][0] + (path[next][0] - path[index][0]) * t;
        const y = path[index][1] + (path[next][1] - path[index][1]) * t;
        actor.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    }
    requestAnimationFrame(animatePatrol);
}

export function initWorkplaceScene({ openRadar: onOpenRadar } = {}) {
    openRadar = onOpenRadar;
    document.getElementById('scene-site-tabs')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-site]');
        if (!button) return;
        siteId = button.dataset.site;
        selectedSeat = WORKSPACES[siteId].seats[0].code;
        updateWorkplaceScene();
    });
    document.getElementById('scene-viewport')?.addEventListener('click', event => {
        const desk = event.target.closest('[data-seat]');
        if (desk) selectSeat(desk.dataset.seat);
    });
    document.getElementById('scene-viewport')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const desk = event.target.closest('[data-seat]');
        if (!desk) return;
        event.preventDefault();
        selectSeat(desk.dataset.seat);
    });
    document.getElementById('scene-seat-list')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-seat]');
        if (button) selectSeat(button.dataset.seat);
    });
    document.getElementById('scene-enter-radar')?.addEventListener('click', () => {
        if (selectedFrom(currentModel)?.status === 'staffed') openRadar?.(currentModel.site.view);
    });
    document.getElementById('scene-open-operations')?.addEventListener('click', () => {
        document.querySelector('[data-platform-view="operations"]')?.click();
    });
    [EV.MANAGEMENT_CHANGED, EV.SESSION_STARTED, EV.SESSION_ENDED, EV.PLAYBACK_CHANGED]
        .forEach(event => bus.on(event, updateWorkplaceScene));
    requestAnimationFrame(animatePatrol);
}
