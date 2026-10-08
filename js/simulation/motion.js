/**
 * simulation/motion.js — 运动模型（约束驱动 + 时间确定性）
 * 移植参考项目 objects.py 的「约束目标(altCon/hdgCon/spdCon) + 速率收敛」思想，
 * 但全部由 (targetTime - constraintTime) 确定性推导，从而保证时间轴拖拽可精确回放。
 *
 * 位置：路线/航向/直飞三种模式，沿用确定性的位置函数（核心：可 scrub）。
 * 运动学：高度/速度/航向向约束目标线性收敛，速率取自机型类别。
 */

import { state } from '../core/store.js';
import { kmToPxFixed } from '../core/viewport.js';
import { bus, EV } from '../core/eventBus.js';
import { KT_TO_KMPS, TRAIL_MAX_PTS } from '../core/constants.js';
import { posX, posY } from '../core/accessors.js';
import { getCategory } from '../data/aircraft.js';
import { pointToSegmentDist, headingBetween } from './geometry.js';

/* ---------- 业务时钟钩子（依赖倒置） ----------
 * 仿真层不得反向依赖领域层：席位/阶段/许可推进由 js/main.js 通过 onAircraftStep 注册进来。 */
const aircraftStepHooks = [];

/** 注册“每架航空器每模拟秒推进”钩子（由游戏层装配领域层实现） */
export function onAircraftStep(fn) {
    aircraftStepHooks.push(fn);
}

function runAircraftStepHooks(ac) {
    for (const fn of aircraftStepHooks) fn(ac);
}

/* ---------- 收敛原语 ---------- */

export function converge(current, target, rate, t) {
    if (t <= 0) return current;
    const diff = target - current;
    const step = rate * t;
    if (Math.abs(step) >= Math.abs(diff)) return target;
    return current + Math.sign(diff) * step;
}

/** 航向按最短方向收敛（°） */
export function convergeAngle(current, target, rate, t) {
    if (t <= 0) return current;
    let diff = ((target - current + 540) % 360) - 180; // [-180,180]
    const step = rate * t;
    if (Math.abs(step) >= Math.abs(diff)) {
        let h = current + diff;
        return (h % 360 + 360) % 360;
    }
    let h = current + Math.sign(diff) * step;
    return (h % 360 + 360) % 360;
}

/* ---------- 约束设定（原语已迁至 simulation/constraints.js，此处转出保持既有导入路径） ---------- */

export { setAltitudeConstraint, setSpeedConstraint, setHeadingConstraint } from './constraints.js';

/* ---------- 运动学（确定性，scrub 安全） ---------- */

export function updateAircraftKinematics(ac, targetTime) {
    const cat = getCategory(ac.acType);
    const ct = ac.constraintTime ?? 0;
    const t = Math.max(0, targetTime - ct);

    // 高度
    if (ac.altCon !== undefined && ac.altCon !== null) {
        const rate = ac.altCon > (ac.altBase ?? ac.altitude) ? cat.climbRate : cat.descentRate;
        ac.displayAltitude = Math.round(converge(ac.altBase ?? ac.altitude, ac.altCon, rate, t));
    } else {
        ac.displayAltitude = ac.altitude;
    }

    // 速度
    if (ac.spdCon !== undefined && ac.spdCon !== null) {
        ac.displaySpeed = Math.round(converge(ac.spdBase ?? ac.speed, ac.spdCon, 12, t)); // 12 kt/s 调速
    } else {
        ac.displaySpeed = ac.speed;
    }

    // 航向（仅自由/航向模式用约束收敛；航线模式由几何决定）
    if ((ac.navMode === 'free' || ac.navMode === 'heading') && ac.hdgCon !== undefined) {
        ac.displayHeading = convergeAngle(ac.hdgBase ?? (ac.heading || 90), ac.hdgCon, 4, t); // 4°/s 转弯
    }
}

/* ---------- 位置（三种导航模式，确定性） ---------- */

export function calculateAircraftPositionAtTime(ac, targetTime) {
    const acStartTime = ac.startTime || 0;
    if (targetTime < acStartTime) {
        return { visible: false, x: ac.x, y: ac.y, heading: ac.heading || 90 };
    }

    const speedKmPerSec = ((ac.displaySpeed ?? ac.speed ?? state.defaults.speed) * KT_TO_KMPS);
    // 世界坐标中的距离固定；用户切换塔台/进近/区域地图不应改变飞行速度。
    const pixelsPerKm = kmToPxFixed(1);

    // 自由导航：朝目标点直线飞行
    if (ac.navMode === 'free' && ac.targetX !== undefined && ac.targetY !== undefined) {
        const startX = ac.x, startY = ac.y;
        const timeFromStart = Math.max(0, targetTime - (ac.takeoffTime ?? acStartTime));
        const distPx = speedKmPerSec * timeFromStart * pixelsPerKm;
        const dx = ac.targetX - startX, dy = ac.targetY - startY;
        const totalDist = Math.sqrt(dx * dx + dy * dy);
        const heading = headingBetween({ x: startX, y: startY }, { x: ac.targetX, y: ac.targetY });
        if (distPx >= totalDist && totalDist > 0) {
            return { visible: true, x: ac.targetX, y: ac.targetY, heading };
        }
        const ratio = totalDist > 0 ? distPx / totalDist : 0;
        return { visible: true, x: startX + dx * ratio, y: startY + dy * ratio, heading };
    }

    // 航向模式：按当前/约束航向直线飞行
    if (!ac.routeId) {
        const heading = ac.displayHeading ?? (ac.heading || 90);
        const startX = ac.x, startY = ac.y;
        const timeFromStart = Math.max(0, targetTime - (ac.takeoffTime ?? acStartTime));
        const headRad = (heading - 90) * Math.PI / 180;
        const distPx = speedKmPerSec * timeFromStart * pixelsPerKm;
        return { visible: true, x: startX + Math.cos(headRad) * distPx, y: startY - Math.sin(headRad) * distPx, heading };
    }

    // 航线模式：沿航线折线运动（逐段追赶航向）
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route || route.points.length < 2) {
        return { visible: true, x: ac.x, y: ac.y, heading: ac.heading || 90 };
    }

    let totalLen = 0, segLengths = [];
    for (let i = 1; i < route.points.length; i++) {
        const dx = route.points[i].x - route.points[i - 1].x;
        const dy = route.points[i].y - route.points[i - 1].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segLengths.push(len);
        totalLen += len;
    }
    if (totalLen === 0) {
        return { visible: true, x: route.points[0].x, y: route.points[0].y, heading: ac.heading || 90 };
    }

    const timeFromStart = Math.max(0, targetTime - (ac.takeoffTime ?? acStartTime));
    const distanceMoved = speedKmPerSec * timeFromStart * pixelsPerKm;

    let startX = ac.x, startY = ac.y;
    let targetIdx = ac.nextWaypointIdx !== undefined ? ac.nextWaypointIdx : -1;
    if (targetIdx < 0 || targetIdx >= route.points.length) {
        let minDist = Infinity;
        for (let i = 0; i < route.points.length; i++) {
            const dx = route.points[i].x - startX, dy = route.points[i].y - startY;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) { minDist = d; targetIdx = i; }
        }
    }

    let remainingDist = distanceMoved;
    let currentX = startX, currentY = startY;
    let currentIdx = -1, nextIdx = targetIdx, cameFromIdx = -1;

    while (remainingDist > 0.001 && nextIdx >= 0 && nextIdx < route.points.length) {
        const targetPt = route.points[nextIdx];
        const dx = targetPt.x - currentX, dy = targetPt.y - currentY;
        const distToTarget = Math.sqrt(dx * dx + dy * dy);

        if (remainingDist <= distToTarget) {
            const ratio = distToTarget > 0 ? remainingDist / distToTarget : 0;
            const heading = headingBetween({ x: currentX, y: currentY }, targetPt);
            return { visible: true, x: currentX + dx * ratio, y: currentY + dy * ratio, heading: heading < 0 ? heading + 360 : heading };
        }

        remainingDist -= distToTarget;
        currentX = targetPt.x; currentY = targetPt.y;

        if (currentIdx === -1) {
            let currentSegmentIdx = -1, minDistToSegment = Infinity;
            for (let i = 0; i < route.points.length - 1; i++) {
                const dist = pointToSegmentDist(startX, startY, route.points[i], route.points[i + 1]);
                if (dist < minDistToSegment) { minDistToSegment = dist; currentSegmentIdx = i; }
            }
            if (currentSegmentIdx >= 0 && currentSegmentIdx < route.points.length - 1) {
                const segStartIdx = currentSegmentIdx, segEndIdx = currentSegmentIdx + 1;
                if (targetIdx > segEndIdx) cameFromIdx = segStartIdx;
                else if (targetIdx < segStartIdx) cameFromIdx = segEndIdx;
                else {
                    if (targetIdx === segEndIdx) cameFromIdx = segStartIdx;
                    else if (targetIdx === segStartIdx) cameFromIdx = segEndIdx;
                    else {
                        const prevPt = route.points[targetIdx - 1], postPt = route.points[targetIdx + 1];
                        const distToPrev = Math.sqrt((startX - prevPt.x) ** 2 + (startY - prevPt.y) ** 2);
                        const distToPost = Math.sqrt((startX - postPt.x) ** 2 + (startY - postPt.y) ** 2);
                        cameFromIdx = distToPost < distToPrev ? targetIdx + 1 : targetIdx - 1;
                    }
                }
            } else if (route.points.length > 1) {
                const prevPt = route.points[Math.max(0, targetIdx - 1)], postPt = route.points[Math.min(route.points.length - 1, targetIdx + 1)];
                const distToPrev = Math.sqrt((startX - prevPt.x) ** 2 + (startY - prevPt.y) ** 2);
                const distToPost = Math.sqrt((startX - postPt.x) ** 2 + (startY - postPt.y) ** 2);
                cameFromIdx = distToPost < distToPrev ? targetIdx + 1 : targetIdx - 1;
            }
        } else {
            cameFromIdx = currentIdx;
        }
        currentIdx = nextIdx;

        const prevIdx = currentIdx - 1, postIdx = currentIdx + 1;
        const isFirstNode = currentIdx === 0, isLastNode = currentIdx === route.points.length - 1;

        if (isLastNode && cameFromIdx < currentIdx) nextIdx = -1;
        else if (isFirstNode && cameFromIdx > currentIdx) nextIdx = -1;
        else if (cameFromIdx > currentIdx) nextIdx = prevIdx >= 0 ? prevIdx : -1;
        else if (cameFromIdx < currentIdx) nextIdx = postIdx < route.points.length ? postIdx : -1;
        else nextIdx = postIdx < route.points.length ? postIdx : (prevIdx >= 0 ? prevIdx : -1);

        if (nextIdx < 0 || nextIdx >= route.points.length || nextIdx === currentIdx) {
            const heading = headingBetween({ x: currentX, y: currentY }, cameFromIdx >= 0 ? route.points[cameFromIdx] : route.points[0]);
            return { visible: true, x: currentX, y: currentY, heading };
        }
    }

    if (remainingDist > 0.001) {
        const heading = cameFromIdx >= 0 ? headingBetween({ x: currentX, y: currentY }, route.points[cameFromIdx]) : (ac.heading || 90);
        return { visible: true, x: currentX, y: currentY, heading };
    }

    const targetPt = route.points[nextIdx] || route.points[0];
    const dx = targetPt.x - currentX, dy = targetPt.y - currentY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ratio = dist > 0 ? Math.min(1, distanceMoved / dist) : 0;
    const heading = headingBetween({ x: currentX, y: currentY }, targetPt);
    return { visible: true, x: currentX + dx * ratio, y: currentY + dy * ratio, heading: heading < 0 ? heading + 360 : heading };
}

/* ---------- 到达航路点检测（恢复 askNextWaypoint 特性） ---------- */

/** 判定为"已到达目标点"的世界坐标阈值 (px) */
const WAYPOINT_ARRIVE_PX = 4;

/**
 * 勾选了"到达目标点后询问下一航路点"的航线飞机抵达目标点时发出事件，
 * UI 层订阅后暂停播放并弹出选择框。_askedWpIdx 防止同一点重复询问。
 */
function checkWaypointArrival(ac) {
    if (!state.isPlaying || !ac.askNextWaypoint) return;
    if (ac.navMode !== 'route' || !ac.routeId) return;
    if (state.time < (ac.startTime || 0)) return;
    const idx = ac.nextWaypointIdx;
    if (idx === undefined || idx === null || idx < 0) return;
    if (ac._askedWpIdx === idx) return;
    const route = state.routes.find(r => r.id === ac.routeId);
    const wp = route?.points[idx];
    if (!wp) return;
    const dx = posX(ac) - wp.x, dy = posY(ac) - wp.y;
    if (Math.sqrt(dx * dx + dy * dy) > WAYPOINT_ARRIVE_PX) return;
    ac._askedWpIdx = idx;
    bus.emit(EV.WAYPOINT_ARRIVED, { ac, idx });
}

export function updateAircraftPositionsForTime(targetTime, syncDomain = true) {
    state.aircraft.forEach(ac => {
        updateAircraftKinematics(ac, targetTime);
        const pos = calculateAircraftPositionAtTime(ac, targetTime);
        ac.displayX = pos.x;
        ac.displayY = pos.y;
        ac.displayHeading = pos.heading;
        ac._visible = pos.visible;
        if (syncDomain) {
            runAircraftStepHooks(ac);   // 领域层钩子：席位归属 / 自动移交 / 许可链 / 接地 / 阶段
            checkWaypointArrival(ac);
        }
    });
}

/* ---------- 轨迹 ---------- */

export function updateTrails(dt) {
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;
        if (!ac.trail) ac.trail = [];
        const x = posX(ac), y = posY(ac);
        if (ac.trail.length === 0 ||
            Math.sqrt((x - ac.trail[ac.trail.length - 1].x) ** 2 + (y - ac.trail[ac.trail.length - 1].y) ** 2) > 2) {
            ac.trail.push({ x, y });
        }
        if (ac.trail.length > TRAIL_MAX_PTS) ac.trail.shift();
    });
}
