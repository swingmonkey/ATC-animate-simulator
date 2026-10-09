/** 两个游戏视图共用同一状态；仅切换可见区域，不重建经营或班次。 */
import { resizeCanvas } from '../core/viewport.js';
import { state, setPlaying, setAutoClearance, setAutoHandoff, select } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import { activeIncidents, radarAvailable } from '../core/controlPolicy.js';
import { startGameSession, endGameSession, isSessionActive } from '../game/session.js';
import { managementSummary } from '../game/management.js';
import { focusRadarView } from '../render/views.js';
import { updateWorkplaceScene } from './workplaceScene.js';

const VIEWS = ['operations', 'scene', 'radar'];
let lastNonRadarView = 'scene';

export function updateAutoOperationsUI() {
    const automatic = state.autoOperationsMode;
    const incidents = automatic ? activeIncidents() : [];
    const incident = incidents[0];
    const banner = document.getElementById('incident-banner');
    banner?.classList.toggle('hidden', !incident);
    if (incident) {
        document.getElementById('incident-title').textContent = `${incident.name} · ${incident.aircraft || '全区'}`;
        document.getElementById('incident-text').textContent = incident.text;
    }
    const radarTab = document.querySelector('.platform-nav [data-platform-view="radar"]');
    if (radarTab) {
        radarTab.disabled = automatic && !incident;
        radarTab.title = automatic && !incident ? '自动值守中，出现特情后开放雷达处置' : '';
        radarTab.textContent = incident ? `雷达值班 · 特情 ${incidents.length}` : '雷达值班';
    }
    const active = isSessionActive();
    const run = document.getElementById('operations-duty-btn');
    if (run) run.textContent = !automatic ? '进入雷达值班 →'
        : !active ? '开始自动运营 →' : incident ? '接管雷达处置 →' : '巡视现场 →';
    document.getElementById('operations-end-btn')?.classList.toggle('hidden', !automatic || !active);
    const status = document.getElementById('operations-auto-status');
    if (status) status.textContent = !automatic ? '手动训练模式' : !active ? '自动运营待启动'
        : incident ? `特情待处置 ${incidents.length} 项 · 航班持续运行` : '自动运营中 · 航班与现场同步运行';
}

function enterIncidentRadar() {
    if (!radarAvailable()) return false;
    const incident = activeIncidents()[0];
    if (incident?.acId) {
        const ac = state.aircraft.find(item => item.id === incident.acId);
        if (ac) {
            focusRadarView((ac.unit || 'APP').split('-')[0]);
            select({ type: 'aircraft', id: ac.id });
        }
    }
    return showPlatformView('radar');
}

export function showPlatformView(view) {
    if (!VIEWS.includes(view)) return false;
    if (view === 'radar' && !radarAvailable()) return false;
    const operations = document.getElementById('operations-view');
    const scene = document.getElementById('scene-view');
    const radar = document.getElementById('main-content');
    const toolbar = document.getElementById('toolbar');
    if (!operations || !scene || !radar || !toolbar) return false;

    const isRadar = view === 'radar';
    if (!isRadar && state.isPlaying && !state.autoOperationsMode) {
        setPlaying(false);
        document.getElementById('operations-paused-note')?.classList.remove('hidden');
    }
    if (isRadar) document.getElementById('operations-paused-note')?.classList.add('hidden');
    if (!isRadar) lastNonRadarView = view;
    operations.classList.toggle('hidden', view !== 'operations');
    scene.classList.toggle('hidden', view !== 'scene');
    radar.classList.toggle('hidden', !isRadar);
    toolbar.classList.toggle('hidden', !isRadar);
    document.body.dataset.platformView = view;
    document.querySelectorAll('.platform-nav [data-platform-view]').forEach(button => {
        const current = button.dataset.platformView === view;
        button.setAttribute('aria-current', current ? 'page' : 'false');
    });
    if (isRadar) { resizeCanvas(); requestRedraw(); }
    if (view === 'scene') updateWorkplaceScene();
    updateAutoOperationsUI();
    return true;
}

export function initPlatformView() {
    document.querySelector('.platform-nav')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-platform-view]');
        if (button) showPlatformView(button.dataset.platformView);
    });
    document.getElementById('operations-duty-btn')?.addEventListener('click', () => {
        if (!state.autoOperationsMode) return showPlatformView('radar');
        if (!isSessionActive()) {
            startGameSession();
            setAutoClearance(true);
            setAutoHandoff(true);
            updateAutoOperationsUI();
            return showPlatformView('scene');
        }
        return activeIncidents().length ? enterIncidentRadar() : showPlatformView('scene');
    });
    document.getElementById('operations-end-btn')?.addEventListener('click', () => {
        if (isSessionActive()) endGameSession({ reason: '经营指挥台结束自动班次' });
        updateAutoOperationsUI();
    });
    document.getElementById('incident-open-radar')?.addEventListener('click', enterIncidentRadar);
    document.getElementById('operations-next-action')?.addEventListener('click', event => {
        const target = event.currentTarget.dataset.target;
        if (target === 'radar') enterIncidentRadar();
        else if (target === 'auto') document.getElementById('operations-duty-btn')?.click();
        else document.getElementById(target)?.closest('.operations-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    [EV.EMERGENCY_RAISED, EV.EMERGENCY_RESOLVED, EV.SESSION_STARTED, EV.SESSION_ENDED]
        .forEach(event => bus.on(event, () => {
            if (document.body.dataset.platformView === 'radar' && !radarAvailable()) showPlatformView(lastNonRadarView);
            updateAutoOperationsUI();
            updateOperationsSummary(managementSummary());
        }));
    showPlatformView(state.autoOperationsMode ? 'operations' : window.location.protocol === 'app:' ? 'radar' : 'operations');
}

/** 与经营面板使用同一个快照口径，避免首页提示与按钮状态不一致。 */
export function updateOperationsSummary(m) {
    const target = document.getElementById('operations-next-text');
    const action = document.getElementById('operations-next-action');
    if (!target || !action || !m) return;
    let message, destination;
    if (!m.contractCount) { message = '先签订“区域支线包”，为每天建立稳定收入。'; destination = 'management-contract-list'; }
    else if (!m.roomCounts.tower) { message = '建设塔台现场，开放基础管制席位。'; destination = 'management-room-list'; }
    else if (!m.staff.some(staff => staff.role === 'controller' || staff.role === 'supervisor')) {
        message = '招聘管制员，再安排到已开放席位。';
        destination = 'management-staff-list';
    } else if (!m.staff.some(staff => staff.seat)) {
        message = '为管制员安排席位，然后启动自动运营。';
        destination = 'management-staff-list';
    } else if (m.daily.net < 0) {
        message = '当前日收支为负，优先改善收入或控制扩建。';
        destination = 'management-contract-list';
    } else { message = isSessionActive() ? '航班自动运行中：巡视现场，特情出现后接管雷达。'
        : '配置已就绪：启动自动运营，巡视现场，特情出现后接管雷达。'; destination = 'auto'; }
    target.textContent = message;
    action.dataset.target = destination;
    action.textContent = destination === 'auto' ? (isSessionActive() ? '巡视现场 →' : '启动运营 →') : '查看操作 ↓';
}
