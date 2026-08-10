/**
 * simulation/geometry.js — 几何工具（运动模型层·纯函数）
 * 点到线段距离、命中航线、沿航线投影。无副作用，被 motion/conflict 复用。
 */

export function pointToSegmentDist(px, py, p1, p2) {
    const A = px - p1.x, B = py - p1.y, C = p2.x - p1.x, D = p2.y - p1.y;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    if (lenSq === 0) return Math.sqrt(A * A + B * B);
    let param = Math.max(0, Math.min(1, dot / lenSq));
    return Math.sqrt((px - (p1.x + param * C)) ** 2 + (py - (p1.y + param * D)) ** 2);
}

export function pointOnRoute(mx, my, route) {
    let minDist = Infinity;
    for (let i = 1; i < route.points.length; i++) {
        const d = pointToSegmentDist(mx, my, route.points[i - 1], route.points[i]);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

/** 把点投影到航线，返回累计距离与最近点参数（用于贴线/方向判定） */
export function getPositionOnRoute(px, py, route) {
    let minDist = Infinity;
    let bestParam = 0, bestSegIdx = 0, minX = px, minY = py;

    for (let i = 1; i < route.points.length; i++) {
        const p1 = route.points[i - 1], p2 = route.points[i];
        const A = px - p1.x, B = py - p1.y;
        const C = p2.x - p1.x, D = p2.y - p1.y;
        const lenSq = C * C + D * D;
        if (lenSq === 0) continue;
        let param = Math.max(0, Math.min(1, (A * C + B * D) / lenSq));
        const ix = p1.x + param * C, iy = p1.y + param * D;
        const dist = Math.sqrt((px - ix) ** 2 + (py - iy) ** 2);
        if (dist < minDist) { minDist = dist; bestParam = param; bestSegIdx = i - 1; minX = ix; minY = iy; }
    }

    let totalDist = 0;
    for (let i = 1; i <= bestSegIdx; i++) {
        const dx = route.points[i].x - route.points[i - 1].x;
        const dy = route.points[i].y - route.points[i - 1].y;
        totalDist += Math.sqrt(dx * dx + dy * dy);
    }
    const segDx = route.points[bestSegIdx + 1].x - route.points[bestSegIdx].x;
    const segDy = route.points[bestSegIdx + 1].y - route.points[bestSegIdx].y;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
    totalDist += bestParam * segLen;

    return { dist: totalDist, x: minX, y: minY, segIdx: bestSegIdx, param: bestParam };
}

export function segmentLength(p1, p2) {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

export function headingBetween(p1, p2) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    let h = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (h < 0) h += 360;
    return h;
}
