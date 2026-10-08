/** 从机场表挑选穿越焦点区域、但避开终端区的航路段。 */
import { AIRPORTS, getAirport } from './airports.js';
import { kmToPxFixed, pxToKmFixed } from '../core/viewport.js';

export function pickOverflightRoute(focusCode, rng = Math.random) {
    const focus = getAirport(focusCode);
    if (!focus) return null;
    const airports = Object.entries(AIRPORTS).filter(([code, ap]) => code !== focusCode
        && Number.isFinite(ap.x) && Number.isFinite(ap.y));
    if (airports.length < 2) return null;
    const radius = kmToPxFixed(180);
    const candidates = [];
    for (const [departure, from] of airports) {
        for (const [destination, to] of airports) {
            if (departure === destination) continue;
            const dx = to.x - from.x, dy = to.y - from.y;
            const length = Math.hypot(dx, dy);
            if (length < radius * 2) continue;
            const ux = dx / length, uy = dy / length;
            const along = (focus.x - from.x) * ux + (focus.y - from.y) * uy;
            const cross = Math.abs((focus.x - from.x) * uy - (focus.y - from.y) * ux);
            const crossKm = pxToKmFixed(cross);
            if (crossKm < 75 || crossKm > 135) continue;
            const half = Math.sqrt(radius * radius - cross * cross);
            const entryAt = along - half, exitAt = along + half;
            if (entryAt < 0 || exitAt > length) continue;
            candidates.push({ departure, destination,
                entry: { x: from.x + ux * entryAt, y: from.y + uy * entryAt },
                exit: { x: from.x + ux * exitAt, y: from.y + uy * exitAt } });
        }
    }
    if (candidates.length) return candidates[Math.floor(rng() * candidates.length)];

    // 导入的小型机场表可能没有横穿扇区的机场对；仍用两座外站标注模拟流量。
    const startIndex = Math.floor(rng() * airports.length);
    const endIndex = (startIndex + 1 + Math.floor(rng() * (airports.length - 1))) % airports.length;
    const [departure, from] = airports[startIndex], [destination, to] = airports[endIndex];
    const bearing = Math.atan2(to.y - from.y, to.x - from.x);
    const ux = Math.cos(bearing), uy = Math.sin(bearing);
    const offset = kmToPxFixed(95), reach = kmToPxFixed(150);
    return { departure, destination,
        entry: { x: focus.x - ux * reach - uy * offset, y: focus.y - uy * reach + ux * offset },
        exit: { x: focus.x + ux * reach - uy * offset, y: focus.y + uy * reach + ux * offset } };
}
