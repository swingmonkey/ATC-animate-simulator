/** 三类管制席位的专属操作。状态写入航空器，供地图、进程单与回放共用。 */
import { state, addComm } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import { kmToPxFixed } from '../core/viewport.js';
import { getAirport } from '../data/airports.js';
import { flowOf, syncPhase } from './phases.js';
import { recordClearance } from './clearances.js';
import { setAltitudeConstraint, setSpeedConstraint } from '../simulation/constraints.js';
import { altOf, posX, posY } from '../core/accessors.js';

const GROUND_CHAIN = ['parked', 'pushed', 'started', 'taxi', 'lineup'];
const GROUND_ACTIONS = { pushback: ['parked', 'pushed', '推出'], startup: ['pushed', 'started', '开车'],
    taxi: ['started', 'taxi', '滑行'], lineup: ['taxi', 'lineup', '进跑道'] };

export function groundStageOf(ac) { return ac.groundStage || 'lineup'; }

export function canGroundAction(ac, action) {
    const spec = GROUND_ACTIONS[action];
    return !!spec && flowOf(ac) === 'departure' && !ac.landed && !ac.clearance
        && ac.unit === 'TWR'
        && groundStageOf(ac) === spec[0];
}

function moveGroundAircraft(ac) {
    const ap = getAirport(ac.departure || state.focusAirport);
    if (!ap) return;
    const offsetKm = { parked: 2.1, pushed: 1.65, started: 1.65, taxi: 0.85, lineup: 0 }[groundStageOf(ac)] ?? 0;
    ac.groundFromX = posX(ac);
    ac.groundFromY = posY(ac);
    ac.groundMoveDuration = { pushed: 6, started: 0, taxi: 8, lineup: 6 }[groundStageOf(ac)] ?? 0;
    ac.x = ap.x;
    ac.y = ap.y + kmToPxFixed(offsetKm);
    // displayX/Y 由运动模型按模拟时钟插值，避免地面阶段切换时瞬移。
}

export function issueGroundAction(ac, action, options = {}) {
    if (!canGroundAction(ac, action)) return false;
    const [, next, label] = GROUND_ACTIONS[action];
    ac.groundStage = next;
    ac.groundStageTime = state.time;
    moveGroundAircraft(ac);
    recordClearance(ac, action.toUpperCase(), { runway: ac.runway || null, auto: !!options.auto });
    addComm('twr', `${ac.flightNo}，${label}${ac.runway && action === 'taxi' ? `前往跑道 ${ac.runway}` : ''}许可。`);
    syncPhase(ac);
    bus.emit(EV.UNIT_CHANGED, { ac, groundStage: next });
    requestRedraw();
    return true;
}

/** 进近排序会重排当前终端区进港队列，避免多架飞机占据同一顺位。 */
export function setArrivalOrder(ac, order) {
    if (flowOf(ac) !== 'arrival' || !String(ac.unit || '').startsWith('APP') || ac.landed) return false;
    const queue = state.aircraft.filter(item => item !== ac && !item.landed && flowOf(item) === 'arrival'
        && String(item.unit || '').startsWith('APP'));
    queue.sort((a, b) => (a.arrivalOrder || 99) - (b.arrivalOrder || 99));
    queue.splice(Math.max(0, Math.min(queue.length, Math.round(order) - 1)), 0, ac);
    queue.forEach((item, index) => { item.arrivalOrder = index + 1; });
    recordClearance(ac, 'ARRIVAL_ORDER', { order: ac.arrivalOrder });
    addComm('app', `${ac.flightNo}，调整为进近第 ${ac.arrivalOrder} 顺位。`);
    bus.emit(EV.UNIT_CHANGED, { ac, arrivalOrder: ac.arrivalOrder });
    requestRedraw();
    return true;
}

export function setCrossingAltitude(ac, fix, altitude) {
    if (flowOf(ac) !== 'arrival' || !String(ac.unit || '').startsWith('APP') || ac.landed) return false;
    ac.crossingFix = fix;
    ac.crossingAltM = Math.round(altitude);
    ac.crossingChecked = false;
    setAltitudeConstraint(ac, ac.crossingAltM);
    recordClearance(ac, 'CROSSING_ALT', { fix, altitudeM: ac.crossingAltM });
    addComm('app', `${ac.flightNo}，过 ${fix} 高度 ${ac.crossingAltM} 米。`);
    bus.emit(EV.UNIT_CHANGED, { ac, crossingFix: fix });
    requestRedraw();
    return true;
}

export function checkCrossingAltitude(ac) {
    if (!state.isPlaying || !ac.crossingFix || ac.crossingChecked || ac.landed) return;
    const route = state.routes.find(item => item.id === ac.routeId);
    const point = state.routePoints.find(item => item.name?.toUpperCase() === ac.crossingFix.toUpperCase())
        || route?.points.find(item => item.name?.toUpperCase() === ac.crossingFix.toUpperCase());
    if (!point) return;
    if (Math.hypot((ac.displayX ?? ac.x) - point.x, (ac.displayY ?? ac.y) - point.y) > kmToPxFixed(2)) return;
    ac.crossingChecked = true;
    ac.crossingMet = Math.abs(altOf(ac) - ac.crossingAltM) <= 300;
    addComm('app', `${ac.flightNo} 过 ${ac.crossingFix}：${ac.crossingMet ? '高度符合' : '高度偏差'}（${Math.round(altOf(ac))} / ${ac.crossingAltM} 米）。`);
    bus.emit(EV.UNIT_CHANGED, { ac, crossingChecked: true });
}

export function setAreaAltitudeLimit(ac, altitude) {
    if (!String(ac.unit || '').startsWith('ACC') || ac.landed) return false;
    ac.areaAltitudeLimitM = altitude == null ? null : Math.round(altitude);
    if (ac.areaAltitudeLimitM != null && (ac.altCon ?? altOf(ac)) > ac.areaAltitudeLimitM) {
        setAltitudeConstraint(ac, ac.areaAltitudeLimitM);
    }
    recordClearance(ac, 'AREA_ALT_LIMIT', { altitudeM: ac.areaAltitudeLimitM });
    addComm('acc', `${ac.flightNo}，${ac.areaAltitudeLimitM == null ? '取消高度限制' : `高度不得超过 ${ac.areaAltitudeLimitM} 米`}。`);
    bus.emit(EV.UNIT_CHANGED, { ac, altitudeLimit: ac.areaAltitudeLimitM });
    requestRedraw();
    return true;
}

export function setFlowSpeed(ac, speed) {
    if (!String(ac.unit || '').startsWith('ACC') || ac.landed) return false;
    ac.flowSpeedKt = speed == null ? null : Math.round(speed);
    setSpeedConstraint(ac, ac.flowSpeedKt ?? ac.plannedSpeed ?? ac.speed);
    recordClearance(ac, 'FLOW_SPEED', { speedKt: ac.flowSpeedKt });
    addComm('acc', `${ac.flightNo}，${ac.flowSpeedKt == null ? '解除流控，恢复计划速度' : `流控速度 ${ac.flowSpeedKt} 节`}。`);
    bus.emit(EV.UNIT_CHANGED, { ac, flowSpeed: ac.flowSpeedKt });
    requestRedraw();
    return true;
}

export { GROUND_CHAIN };
