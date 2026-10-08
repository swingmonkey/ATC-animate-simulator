/** 两个游戏视图共用同一状态；仅切换可见区域，不重建经营或班次。 */
import { resizeCanvas } from '../core/viewport.js';
import { state, setPlaying } from '../core/store.js';

const VIEWS = ['operations', 'radar'];

export function showPlatformView(view) {
    if (!VIEWS.includes(view)) return false;
    const operations = document.getElementById('operations-view');
    const radar = document.getElementById('main-content');
    const toolbar = document.getElementById('toolbar');
    if (!operations || !radar || !toolbar) return false;

    const isRadar = view === 'radar';
    if (!isRadar && state.isPlaying) {
        setPlaying(false);
        document.getElementById('operations-paused-note')?.classList.remove('hidden');
    }
    if (isRadar) document.getElementById('operations-paused-note')?.classList.add('hidden');
    operations.classList.toggle('hidden', isRadar);
    radar.classList.toggle('hidden', !isRadar);
    toolbar.classList.toggle('hidden', !isRadar);
    document.body.dataset.platformView = view;
    document.querySelectorAll('[data-platform-view]').forEach(button => {
        const current = button.dataset.platformView === view;
        button.setAttribute('aria-current', current ? 'page' : 'false');
    });
    if (isRadar) resizeCanvas();
    return true;
}

export function initPlatformView() {
    document.querySelector('.platform-nav')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-platform-view]');
        if (button) showPlatformView(button.dataset.platformView);
    });
    document.getElementById('operations-duty-btn')?.addEventListener('click', () => showPlatformView('radar'));
    document.getElementById('operations-next-action')?.addEventListener('click', event => {
        const target = event.currentTarget.dataset.target;
        if (target === 'radar') showPlatformView('radar');
        else document.getElementById(target)?.closest('.operations-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    showPlatformView(window.location.protocol === 'app:' ? 'radar' : 'operations');
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
        message = '为管制员安排席位，然后进入雷达值班完成班次。';
        destination = 'management-staff-list';
    } else if (m.daily.net < 0) {
        message = '当前日收支为负，优先改善收入或控制扩建。';
        destination = 'management-contract-list';
    } else { message = '配置已就绪：进入雷达值班完成班次，再结算今日。'; destination = 'radar'; }
    target.textContent = message;
    action.dataset.target = destination;
    action.textContent = destination === 'radar' ? '进入值班 →' : '查看操作 ↓';
}
