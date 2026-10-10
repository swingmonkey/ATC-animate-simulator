/** 经营快照驱动的 2D 管制室俯视图。画面动作只作状态反馈，不改变班次时钟。 */
import { bus, EV } from '../core/eventBus.js';
import { state } from '../core/store.js';
import { radarAvailable } from '../core/controlPolicy.js';
import { activeIncidents } from '../core/controlPolicy.js';
import { escapeHtml } from '../core/dom.js';
import { WORKSPACES, WORKSPACE_ORDER, seatApproachPoint } from '../data/workspaces.js';
import { managementSummary } from '../game/management.js';
import { setAvatarTarget, visitWorkspace, walkToSeat, fastTravelToSeat,
    sitAvatar, leaveAvatarSeat } from '../game/avatar.js';

let siteId = 'tower';
let selectedSeat = 'TWR';
let currentModel = null;
let lastPlayerPosition = null;
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
    return `<g class="scene-window">
        <rect x="59" y="45" width="882" height="111" rx="8" fill="#344b62"/>
        <rect x="68" y="53" width="864" height="94" rx="3" fill="#9edbf0"/>
        <path d="M68 110 Q210 91 360 109 T660 108 T932 110 V147 H68Z" fill="#a9d790"/>
        <path d="M88 79 h65 m-29-9 h55 M810 78 h72 m-31-10 h35" stroke="#f7ffff" stroke-width="9" stroke-linecap="round" opacity=".9"/>
        <rect x="218" y="93" width="564" height="40" rx="2" fill="#596b76" stroke="#384f60" stroke-width="4"/>
        <path d="M240 113 H760" stroke="#fff8da" stroke-width="3" stroke-dasharray="24 17"/>
        <path d="M106 132 H204 M796 132 H902" stroke="#e6e1ad" stroke-width="4" stroke-dasharray="15 10"/>
        <path d="M296 48 V150 M500 48 V150 M704 48 V150" stroke="#f8f0d9" stroke-width="9"/>
        <path d="M59 151 H941" stroke="#32475d" stroke-width="10"/>
        <text x="76" y="144" class="scene-svg-window-label">跑道观察窗</text>
    </g>`;
}

function statusBoard(site) {
    const marks = site.id === 'area' ? '跨区移交  ·  高度层  ·  航路流量'
        : '进场排序  ·  进离场协调  ·  天气监视';
    return `<g class="scene-wall-map">
        <rect x="66" y="47" width="868" height="108" rx="7" fill="#40536a"/>
        <rect x="76" y="55" width="848" height="87" rx="3" fill="#d0e8d5"/>
        <path d="M78 76 H922 M78 99 H922 M78 121 H922 M180 56 V142 M284 56 V142 M388 56 V142 M492 56 V142 M596 56 V142 M700 56 V142 M804 56 V142" stroke="#9ac9c9" stroke-width="2" opacity=".55"/>
        <path d="M110 119 L205 90 L275 108 L352 76 L441 90 L506 70 L590 106 L670 83 L760 111 L840 79" fill="none" stroke="#e57f71" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M110 119 L205 90 L275 108 L352 76 L441 90 L506 70 L590 106 L670 83 L760 111 L840 79" fill="none" stroke="#fff6dc" stroke-width="2" stroke-dasharray="12 12"/>
        <circle class="scene-pulse" cx="506" cy="70" r="8" fill="#ffc76b" stroke="#fff9df" stroke-width="3"/>
        <circle cx="205" cy="90" r="5" fill="#5db0bd"/><circle cx="670" cy="83" r="5" fill="#5db0bd"/>
        <rect x="77" y="126" width="405" height="20" fill="#40536a"/>
        <text x="90" y="140" class="scene-svg-window-label">${marks}</text>
    </g>`;
}

/** 原创 Q 版俯视人物；玩家、同事和主管共用轮廓，靠制服色识别。 */
function chibiFigure(x, y, label, variant, className = '', id = '') {
    return `<g ${id ? `id="${id}"` : ''} class="scene-person scene-chibi scene-chibi-${variant} ${className}" transform="translate(${x} ${y})">
        <ellipse cy="14" rx="16" ry="6" fill="#34465b" opacity=".2"/>
        <path class="scene-player-step scene-player-step-left" d="M-7 3 V13" stroke="#39475b" stroke-width="7" stroke-linecap="round"/>
        <path class="scene-player-step scene-player-step-right" d="M7 3 V13" stroke="#39475b" stroke-width="7" stroke-linecap="round"/>
        <rect x="-16" y="-12" width="32" height="24" rx="8" class="scene-chibi-coat"/>
        <path d="M-8 -8 L0 -2 L8 -8" fill="none" stroke="#fff7d9" stroke-width="3" stroke-linecap="round"/>
        <circle cy="-20" r="12" class="scene-chibi-face"/>
        <path d="M-12 -24 Q-9 -37 1 -35 Q12 -34 13 -22 Q6 -26 1 -25 Q-5 -24 -12 -20Z" class="scene-chibi-hair"/>
        <circle cx="-5" cy="-18" r="1.6" fill="#38465a"/><circle cx="5" cy="-18" r="1.6" fill="#38465a"/>
        <path d="M-13 -22 V-11 M13 -22 V-11" stroke="#eef3df" stroke-width="3" stroke-linecap="round"/>
        ${label ? `<text y="34" text-anchor="middle" class="scene-svg-person-label">${escapeHtml(label)}</text>` : ''}
    </g>`;
}

function staffFigure(x, y, label, className = '') {
    return chibiFigure(x, y, label, className === 'scene-supervisor' ? 'supervisor' : 'staff', className);
}

function playerFigure() {
    return chibiFigure(state.avatar.x, state.avatar.y, '你', 'player', 'scene-player', 'scene-player');
}

function seatSvg(seat) {
    const { x, y } = seat;
    const name = seat.occupant?.name || '';
    const code = escapeHtml(seat.code);
    const status = seat.status;
    return `<g class="scene-desk ${status}" data-seat="${code}" role="button" tabindex="0" aria-label="${code}，${statusText[status]}${name ? `，${escapeHtml(name)}` : ''}">
        <rect x="${x - 72}" y="${y - 48}" width="148" height="85" rx="6" fill="#48556a" opacity=".24"/>
        <rect x="${x - 76}" y="${y - 56}" width="152" height="88" rx="7" class="scene-desk-top"/>
        <rect x="${x - 68}" y="${y - 49}" width="136" height="68" rx="3" class="scene-desk-surface"/>
        <rect x="${x - 59}" y="${y - 45}" width="118" height="50" rx="5" class="scene-monitor-frame"/>
        <rect x="${x - 52}" y="${y - 39}" width="104" height="37" rx="2" class="scene-monitor-glass"/>
        <path d="M${x - 43} ${y - 15} Q${x - 21} ${y - 31} ${x - 4} ${y - 23} T${x + 34} ${y - 27}" fill="none" stroke="#72cfca" stroke-width="2"/>
        <path d="M${x - 37} ${y - 35} V${y - 6} M${x - 10} ${y - 35} V${y - 6} M${x + 18} ${y - 35} V${y - 6}" stroke="#79bcb8" stroke-width="1" opacity=".45"/>
        <rect x="${x - 51}" y="${y - 38}" width="12" height="34" class="scene-monitor-scan"/>
        <circle class="scene-screen-dot" cx="${x + 37}" cy="${y - 29}" r="4" fill="#fff2a6"/>
        <rect x="${x - 32}" y="${y + 10}" width="64" height="8" rx="2" class="scene-keyboard"/>
        <path d="M${x - 25} ${y + 14} H${x + 25}" stroke="#fff3da" stroke-width="1" stroke-dasharray="3 3"/>
        <rect x="${x + 39}" y="${y + 8}" width="18" height="14" rx="2" fill="#fff5df" stroke="#46556a" stroke-width="2"/>
        <path d="M${x + 43} ${y + 12} H${x + 53} M${x + 43} ${y + 16} H${x + 50}" stroke="#82a8b3" stroke-width="1"/>
        <rect x="${x - 30}" y="${y + 34}" width="60" height="36" rx="10" class="scene-chair"/>
        ${seat.occupant && !(state.avatar?.mode === 'SEATED' && state.avatar.site === siteId && state.avatar.seat === seat.code)
            ? staffFigure(x, y + 55, '', 'scene-seated') : ''}
        <rect x="${x - 46}" y="${y + 73}" width="92" height="24" rx="4" class="scene-seat-tag"/>
        <text x="${x}" y="${y + 89}" text-anchor="middle" class="scene-svg-tag">${code}</text>
        <circle cx="${x + 63}" cy="${y - 43}" r="8" class="scene-status-light" stroke="#fff8e5" stroke-width="3"/>
        <g class="scene-interact-marker" aria-hidden="true">
            <rect x="${x - 12}" y="${y - 90}" width="24" height="24" rx="4" fill="#fff6db" stroke="#445a70" stroke-width="3"/>
            <text x="${x}" y="${y - 72}" text-anchor="middle" fill="#e47a6d" font-size="20" font-weight="900">!</text>
        </g>
    </g>`;
}

function roomDecor(site) {
    const compactRest = site.id === 'approach';
    const restX = compactRest ? 758 : 691;
    const restWidth = compactRest ? 169 : 236;
    const doorX = site.entry.x;
    return `<g class="scene-room-decor" pointer-events="none">
        <path d="M248 374 H676" stroke="#e9d4ad" stroke-width="5" stroke-dasharray="8 12" opacity=".8"/>
        <rect x="68" y="403" width="156" height="88" rx="5" class="scene-side-table"/>
        <rect x="83" y="415" width="126" height="43" rx="3" fill="#fff7e7" stroke="#46556a" stroke-width="3"/>
        <path d="M96 427 H190 M96 435 H172 M96 443 H182" stroke="#8ab7b7" stroke-width="2"/>
        <text x="146" y="479" text-anchor="middle" class="scene-svg-furniture">值班记录</text>
        <g class="scene-coffee-machine" transform="translate(196 386)">
            <rect x="-13" y="0" width="26" height="34" rx="4" fill="#5b6b7a" stroke="#3c4a58" stroke-width="3"/>
            <rect x="-8" y="5" width="16" height="9" rx="2" fill="#8ed0e8"/>
            <rect x="-6" y="17" width="12" height="6" rx="2" fill="#d8dce2"/>
            <circle cx="0" cy="28" r="2.6" fill="#f9c46d"/>
            <path class="scene-coffee-steam" d="M0 -3 q4 -6 0 -11 q-4 -5 0 -10" fill="none" stroke="#fff8e8" stroke-width="2.5" stroke-linecap="round" opacity=".9"/>
        </g>
        <rect x="${restX}" y="407" width="${restWidth}" height="88" rx="6" class="scene-rest-area"/>
        <rect x="${restX + 17}" y="430" width="${restWidth - 34}" height="47" rx="5" fill="#c8dfd1" stroke="#526178" stroke-width="3"/>
        <path d="M${restX + 19} 449 H${restX + restWidth - 20}" stroke="#86b7a7" stroke-width="3"/>
        <text x="${restX + restWidth / 2}" y="425" text-anchor="middle" class="scene-svg-furniture">交接休息区</text>
        <g transform="translate(91 331)"><rect x="-14" y="0" width="28" height="24" rx="3" fill="#d08464" stroke="#43546b" stroke-width="3"/><path d="M0 2 Q-30 -13 -16 -31 M0 1 Q30 -18 15 -34 M0 -2 V-42" fill="none" stroke="#4d997b" stroke-width="10" stroke-linecap="round"/></g>
        <g transform="translate(909 331)"><rect x="-14" y="0" width="28" height="24" rx="3" fill="#d08464" stroke="#43546b" stroke-width="3"/><path d="M0 2 Q-28 -12 -16 -30 M0 1 Q28 -18 15 -34 M0 -2 V-42" fill="none" stroke="#4d997b" stroke-width="10" stroke-linecap="round"/></g>
        <g transform="translate(310 480)">
            <rect x="-9" y="-16" width="18" height="30" rx="3" fill="#7c8b98" stroke="#41525f" stroke-width="3"/>
            <rect x="-6" y="-12" width="12" height="14" rx="2" fill="#8ed0e8"/>
            <rect x="-6" y="5" width="12" height="8" rx="2" fill="#46576d"/>
        </g>
        <g transform="translate(600 480)">
            <rect x="-16" y="-14" width="32" height="26" rx="4" fill="#d9a579" stroke="#475a6e" stroke-width="3"/>
            <path d="M-16 -14 H16 M-8 -14 V12 M0 -14 V12 M8 -14 V12" stroke="#475a6e" stroke-width="2" opacity=".55"/>
        </g>
        <rect x="452" y="150" width="96" height="14" rx="3" fill="#f6e7c8" stroke="#43566b" stroke-width="3"/>
        <text x="500" y="161" text-anchor="middle" font-size="10" font-weight="800" fill="#3c5369">${escapeHtml(site.short || '现场')} · 安全天数 0</text>
        <circle cx="916" cy="190" r="20" fill="#fff9e8" stroke="#43566b" stroke-width="5"/><path d="M916 178 V190 L925 196" fill="none" stroke="#43556b" stroke-width="3" stroke-linecap="round"/>
        <rect x="${doorX - 44}" y="510" width="88" height="25" rx="2" fill="#d49c7c" stroke="#45566c" stroke-width="4"/>
        <path d="M${doorX - 29} 523 H${doorX + 25} M${doorX + 15} 517 L${doorX + 25} 523 L${doorX + 15} 529" stroke="#fff9e8" stroke-width="3" fill="none"/>
        <g class="scene-ceiling-lights" pointer-events="none">
            <rect x="300" y="26" width="180" height="8" rx="4" fill="#fff3cf" opacity=".9"/>
            <rect x="540" y="26" width="180" height="8" rx="4" fill="#fff3cf" opacity=".9"/>
        </g>
    </g>`;
}

function roomSvg(model) {
    const { site, built, seats, standby, supervisor } = model;
    const windowContent = site.id === 'tower' ? runwayWindow() : statusBoard(site);
    const standbyFigures = standby.slice(0, 3).map((person, i) => staffFigure(750 + i * 52, 470, person.name)).join('');
    return `<svg class="scene-map scene-map-${site.id}" viewBox="0 0 1000 560" role="img" aria-label="${site.name}二维俯视图">
        <defs>
            <pattern id="scene-floor-tiles" width="48" height="48" patternUnits="userSpaceOnUse">
                <rect width="48" height="48" fill="var(--scene-floor)"/>
                <rect x="2" y="2" width="44" height="44" fill="var(--scene-tile)"/>
                <path d="M7 9 H19 M31 37 H41" stroke="var(--scene-tile-mark)" stroke-width="2" opacity=".5"/>
            </pattern>
        </defs>
        <rect width="1000" height="560" fill="#d4b894"/>
        <rect x="29" y="20" width="942" height="516" rx="8" class="scene-room-wall"/>
        <rect x="43" y="34" width="914" height="489" fill="url(#scene-floor-tiles)"/>
        <path d="M46 169 H954" stroke="#46566b" stroke-width="8"/>
        ${windowContent}
        ${roomDecor(site)}
        ${standbyFigures}
        ${supervisor ? `<g id="scene-patrol">${staffFigure(0, 0, supervisor.name, 'scene-supervisor')}</g>` : ''}
        ${seats.map(seatSvg).join('')}
        ${built && state.avatar?.site === site.id ? playerFigure() : ''}
        ${built && state.avatar?.site === site.id && state.avatar.destination
            ? `<circle cx="${state.avatar.destination.x}" cy="${state.avatar.destination.y}" r="20" class="scene-destination"/>` : ''}
        ${built ? '' : `<rect x="41" y="35" width="918" height="486" fill="#304559" opacity=".72" pointer-events="none"/>
            <rect x="264" y="229" width="472" height="105" rx="7" fill="#fff6df" stroke="#46566b" stroke-width="7" pointer-events="none"/>
            <text x="500" y="273" text-anchor="middle" class="scene-svg-unbuilt">现场尚未建设</text>
            <text x="500" y="309" text-anchor="middle" class="scene-svg-unbuilt-sub">在经营指挥台建设${site.name}后开放</text>`}
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
    const avatar = state.avatar;
    const playerSite = avatar && WORKSPACES[avatar.site];
    const playerStatus = !avatar ? '角色载入中'
        : avatar.mode === 'SEATED' ? `你正在 ${playerSite.name} · ${avatar.seat} 值守`
            : avatar.mode === 'WALKING' ? `你正走向 ${playerSite.name} · ${avatar.targetSeat}`
                : `你在 ${playerSite.name}，可选择席位前往`;
    writeText('scene-player-status', playerStatus);
    document.getElementById('scene-metrics').innerHTML = `
        <div><strong>${model.open}</strong><span>开放席位</span></div>
        <div><strong>${model.staffed}</strong><span>人员值守</span></div>
        <div><strong>${Math.max(0, model.open - model.staffed)}</strong><span>待安排</span></div>`;
    updateSceneTraffic();
    document.getElementById('scene-seat-list').innerHTML = model.seats.map(seat =>
        `<button type="button" data-seat="${escapeHtml(seat.code)}" class="scene-seat-chip ${seat.status}" aria-pressed="${seat.code === selectedSeat}">`
        + `<span class="scene-chip-light" aria-hidden="true"></span>${escapeHtml(seat.code)}</button>`
    ).join('');
    updateSeatDetail();
}

function updateSceneTraffic() {
    const box = document.getElementById('scene-traffic');
    if (!box || document.body.dataset.platformView !== 'scene') return;
    const traffic = state.aircraft.filter(ac => !ac.landed && !ac.exited && state.time >= (ac.startTime || 0));
    const arriving = traffic.filter(ac => (ac.flow || 'arrival') === 'arrival').length;
    const departing = traffic.filter(ac => ac.flow === 'departure').length;
    const crossing = traffic.filter(ac => ac.flow === 'overflight').length;
    const incidentCount = activeIncidents().length;
    box.innerHTML = `<div class="scene-traffic-head"><strong>现场运行板</strong><span>${state.isPlaying ? '● 自动运行' : '○ 待启动'}</span></div>
        <div class="scene-traffic-counts"><span>进港 ${arriving}</span><span>离港 ${departing}</span><span>飞越 ${crossing}</span><span class="${incidentCount ? 'alert' : ''}">特情 ${incidentCount}</span></div>
        <div class="scene-traffic-flights">${traffic.slice(0, 3).map(ac =>
            `<div><strong>${escapeHtml(ac.flightNo)}</strong><span>${escapeHtml(ac.departure || '本场')} → ${escapeHtml(ac.destination || '本场')}</span></div>`
        ).join('') || '<p>航班即将进入空域，巡视席位并安排值守。</p>'}</div>`;
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
    const fastButton = document.getElementById('scene-fast-travel');
    const leaveButton = document.getElementById('scene-leave-seat');
    const avatar = state.avatar;
    const playerHere = avatar?.site === siteId;
    const sameSeat = playerHere && avatar.mode === 'SEATED' && avatar.seat === seat.code;
    const point = seatApproachPoint(seat);
    const near = playerHere && Math.hypot(avatar.x - point.x, avatar.y - point.y) <= 46;
    const message = seat.status === 'staffed' ? `${seat.occupant.name} · 已安排值守`
        : seat.status === 'vacant' ? '席位已开放，尚未安排管制员。'
            : currentModel.built ? '当前合同流量或技术条件尚未开放该席位。' : '先建设此现场，再安排管制员。';
    detail.innerHTML = `<strong>${escapeHtml(placeLabel(seat.code))}</strong><span class="scene-detail-status ${seat.status}">${statusText[seat.status]}</span><p>${escapeHtml(message)}</p>`;
    button.disabled = seat.status !== 'staffed' || !playerHere;
    button.textContent = seat.status !== 'staffed' ? '安排值守后可进入席位'
        : !playerHere ? '先进入该现场'
            : sameSeat ? radarAvailable() ? `进入 ${currentModel.site.short} 雷达视角 →` : '已就座 · 自动值守中'
                : near ? radarAvailable() ? '就座并进入雷达 →' : '就座观察现场 →' : '步行前往席位 →';
    if (sameSeat && !radarAvailable()) button.disabled = true;
    fastButton.disabled = seat.status !== 'staffed' || !playerHere || sameSeat;
    leaveButton.classList.toggle('hidden', avatar?.mode !== 'SEATED');
}

function selectSeat(code) {
    if (!currentModel?.seats.some(seat => seat.code === code)) return;
    selectedSeat = code;
    if (state.avatar?.site === siteId) setAvatarTarget(code);
    else updateSeatDetail();
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
    const player = document.getElementById('scene-player');
    if (player && state.avatar?.site === siteId && document.body.dataset.platformView === 'scene') {
        player.setAttribute('transform', `translate(${state.avatar.x.toFixed(1)} ${state.avatar.y.toFixed(1)})`);
        const moving = lastPlayerPosition && Math.hypot(
            state.avatar.x - lastPlayerPosition.x, state.avatar.y - lastPlayerPosition.y
        ) > 0.1;
        player.classList.toggle('moving', !!moving);
        lastPlayerPosition = { x: state.avatar.x, y: state.avatar.y };
    } else {
        lastPlayerPosition = null;
    }
    requestAnimationFrame(animatePatrol);
}

export function initWorkplaceScene() {
    document.getElementById('scene-site-tabs')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-site]');
        if (!button) return;
        siteId = button.dataset.site;
        selectedSeat = WORKSPACES[siteId].seats[0].code;
        visitWorkspace(siteId);
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
        if (selectedFrom(currentModel)?.status !== 'staffed') return;
        const avatar = state.avatar;
        const seat = selectedFrom(currentModel);
        const point = seatApproachPoint(seat);
        if (avatar?.mode === 'SEATED' && avatar.seat === seat.code
            || avatar?.site === siteId && Math.hypot(avatar.x - point.x, avatar.y - point.y) <= 46) {
            sitAvatar(seat.code);
        } else walkToSeat(seat.code);
    });
    document.getElementById('scene-fast-travel')?.addEventListener('click', () => fastTravelToSeat(selectedSeat));
    document.getElementById('scene-leave-seat')?.addEventListener('click', leaveAvatarSeat);
    document.getElementById('scene-open-operations')?.addEventListener('click', () => {
        document.querySelector('[data-platform-view="operations"]')?.click();
    });
    [EV.MANAGEMENT_CHANGED, EV.SESSION_STARTED, EV.SESSION_ENDED, EV.PLAYBACK_CHANGED,
        EV.EMERGENCY_RAISED, EV.EMERGENCY_RESOLVED]
        .forEach(event => bus.on(event, updateWorkplaceScene));
    bus.on(EV.CLOCK_TICK, () => {
        if (Math.floor(state.time) % 5 === 0) updateSceneTraffic();
    });
    bus.on(EV.AVATAR_CHANGED, ({ action } = {}) => {
        if (['visit', 'init', 'left', 'reconcile'].includes(action)) {
            siteId = state.avatar.site;
            selectedSeat = state.avatar.targetSeat || WORKSPACES[siteId].seats[0].code;
        }
        updateWorkplaceScene();
    });
    requestAnimationFrame(animatePatrol);
}
