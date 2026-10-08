/** 塔台地面示意图与滑行运动共用的路线几何。 */
import { kmToPxFixed } from '../core/viewport.js';
import { runwayList, runwayEnd, runwayHeading } from './airports.js';

export const TAXIWAYS = ['A', 'B', 'C'];

export function groundPath(airport, airportCode, runway, taxiway = 'A') {
    if (!airport || !TAXIWAYS.includes(taxiway)) return null;
    const pairs = runwayList(airportCode);
    const pairIndex = Math.max(0, pairs.findIndex(pair => pair.split('/').includes(runway)));
    const pair = pairs[pairIndex];
    const end = pair.split('/').indexOf(runway) === 1 ? 1 : 0;
    const angle = ((runwayHeading(runwayEnd(pair, 0)) ?? 90) - 90) * Math.PI / 180;
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const nx = -uy, ny = ux;
    const s = kmToPxFixed(1);
    const runwayY = (pairIndex - (pairs.length - 1) / 2) * 0.55 * s;
    const entry = {
        x: airport.x + ux * (end ? 1.8 : -1.8) * s + nx * runwayY,
        y: airport.y + uy * (end ? 1.8 : -1.8) * s + ny * runwayY
    };
    const apron = { x: airport.x, y: airport.y + 1.65 * s };
    const towardApron = ((apron.x - entry.x) * nx + (apron.y - entry.y) * ny) >= 0 ? 1 : -1;
    const hold = { x: entry.x + nx * towardApron * 0.47 * s,
        y: entry.y + ny * towardApron * 0.47 * s };
    const lane = (TAXIWAYS.indexOf(taxiway) - 1) * 1.12 * s;
    const points = [apron,
        { x: airport.x + lane, y: airport.y + 1.65 * s },
        { x: airport.x + lane, y: airport.y + 1.12 * s },
        { x: airport.x + lane, y: airport.y + 0.72 * s },
        hold];
    return { points, hold, entry, marker: points[2] };
}
