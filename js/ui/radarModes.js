/** 三个席位共用班次状态，但各自拥有任务队列和关注重点。 */
import { state, select } from '../core/store.js';
import { canvasWidth, canvasHeight, centerOnWorldPoint, toScreenX, toScreenY } from '../core/viewport.js';
import { posX, posY } from '../core/accessors.js';
import { flowOf } from '../domain/phases.js';
import { distanceToAirportKm, unitOfAircraft } from '../domain/airspace.js';
import { profileFor } from '../data/viewProfiles.js';
import { focusRadarView } from '../render/views.js';

const $ = id => document.getElementById(id);
let lastRefresh = 0;

export function modeTaskModel(code = state.activeView) {
    const aircraft = state.aircraft.filter(ac => state.time >= (ac.startTime || 0) && !ac.landed
        && (unitOfAircraft(ac) === code || unitOfAircraft(ac).startsWith(`${code}-`)));
    const arrivals = aircraft.filter(ac => flowOf(ac) === 'arrival');
    const departures = aircraft.filter(ac => flowOf(ac) === 'departure');
    if (code === 'TWR') {
        const landing = arrivals.filter(ac => ac.clearance !== 'land');
        const ground = departures.filter(ac => ac.clearance !== 'takeoff');
        const target = landing[0] || ground[0] || aircraft[0];
        return {
            count: aircraft.length, targetId: target?.id ?? null,
            title: '塔台 · 地面与起降',
            mission: landing.length ? `${landing.length} 架待落地许可 · 先确认跑道与进近状态` :
                ground.length ? `${ground.length} 架待地面放行 · 推出、开车、滑行、进跑道后起飞` :
                    '跑道运行平稳，继续监视滑行与五边。'
        };
    }
    if (code === 'APP') {
        const queue = arrivals.slice().sort((a, b) =>
            (a.arrivalOrder || 99) - (b.arrivalOrder || 99)
            || distanceToAirportKm(a, state.focusAirport) - distanceToAirportKm(b, state.focusAirport));
        const needsPlan = queue.filter(ac => !ac.arrivalOrder || !ac.crossingFix);
        const needsDepartureCrossing = departures.filter(ac => !ac.crossingFix);
        const target = needsPlan[0] || needsDepartureCrossing[0] || queue[0] || departures[0];
        return {
            count: aircraft.length, targetId: target?.id ?? null,
            title: '进近 · 排序与过点高度',
            mission: needsPlan.length ? `${needsPlan.length} 架待排序或过点高度 · 安排起降顺序` :
                needsDepartureCrossing.length ? `${needsDepartureCrossing.length} 架离港待爬升过点高度` :
                arrivals.length ? `${arrivals.length} 架进港 · 监视穿越高度与终端间隔` :
                    '等待航班进入终端区，准备排序与过点高度。'
        };
    }
    const inbound = arrivals.slice().sort((a, b) =>
        distanceToAirportKm(a, state.focusAirport) - distanceToAirportKm(b, state.focusAirport));
    const target = aircraft.find(ac => !ac.areaAltitudeLimitM || !ac.flowSpeedKt) || inbound[0] || departures[0];
    const near = inbound.filter(ac => distanceToAirportKm(ac, state.focusAirport) <= 75);
    return {
        count: aircraft.length, targetId: target?.id ?? null,
        title: '区调 · 高度与流量',
        mission: near.length ? `${near.length} 架接近终端区 · 检查高度限制并准备移交` :
            aircraft.length ? `${aircraft.length} 架在管 · 分配高度层、限高与流控速度` :
                '等待航班进入区域空域，关注航路与高度层。'
    };
}

export function updateRadarModes(force = false) {
    const now = performance.now();
    if (!force && now - lastRefresh < 350) return;
    lastRefresh = now;
    const code = profileFor(state.activeView).code;
    document.body.dataset.radarView = code;
    document.querySelectorAll('.radar-view-tab').forEach(button => {
        const current = button.dataset.radarView === code;
        button.classList.toggle('active', current);
        button.setAttribute('aria-current', current ? 'true' : 'false');
    });
    const caption = $('radar-view-caption');
    if (caption) caption.textContent = code === 'TWR' ? '推出 · 开车 · 滑行 · 起飞与落地' :
        code === 'APP' ? '终端区排序 · 过点高度 · 进近' : '航路网 · 高度层 · 流控与移交';
    const model = modeTaskModel(code);
    if ($('mode-title')) $('mode-title').textContent = model.title;
    if ($('mode-count')) $('mode-count').textContent = `${model.count} 架在管`;
    if ($('mode-mission')) $('mode-mission').textContent = model.mission;
    const focus = $('mode-focus-btn');
    if (focus) {
        focus.disabled = model.targetId === null;
        focus.textContent = model.targetId === null ? '暂无待处理航班' : '定位下一架待处理航班 →';
    }
}

export function initRadarModes() {
    $('radar-view-switch')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-radar-view]');
        if (!button) return;
        focusRadarView(button.dataset.radarView);
        updateRadarModes(true);
    });
    $('mode-focus-btn')?.addEventListener('click', () => {
        const model = modeTaskModel();
        const ac = state.aircraft.find(item => item.id === model.targetId);
        if (!ac) return;
        select({ type: 'aircraft', id: ac.id });
        const x = toScreenX(posX(ac)), y = toScreenY(posY(ac));
        if (x < 30 || x > canvasWidth - 30 || y < 70 || y > canvasHeight - 30) {
            centerOnWorldPoint(posX(ac), posY(ac));
        }
    });
    updateRadarModes(true);
}
