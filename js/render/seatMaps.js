/** 按席位绘制三种业务地图。几何与飞机共用世界坐标，切换地图不改变仿真。
 * v1.9 宝可梦画风：跑道/滑行道/停机坪用「掌机地图地物」配色（暖沙跑道、草绿坪、
 * 橙色滑行线、米白对话框标记），几何与判定完全不变。
 * v2.0 美术升级：PAPI 坡度灯、进近灯光系统、风向袋、共享像素地物。 */
import { ctx, kmToPxFixed, viewScale } from '../core/viewport.js';
import { state } from '../core/store.js';
import { getAirport, runwayList, runwayEnd, runwayHeading } from '../data/airports.js';
import { groundPath, TAXIWAYS } from '../data/groundLayout.js';
import { drawPixelTree, drawPixelWindsock } from './pixel.js';

const PK_INK = '#2b2f4a';
const PK_PAPER = '#fffdf2';

function ring(airport, km, color, label) {
    const r = kmToPxFixed(km);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4 / viewScale;
    ctx.setLineDash([6 / viewScale, 5 / viewScale]);
    ctx.beginPath(); ctx.arc(airport.x, airport.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    /* 距离标签做成小对话框，压住环线也清晰 */
    ctx.font = `bold ${9.5 / viewScale}px Consolas, monospace`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(255,253,242,0.95)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 / viewScale;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(airport.x + r + 3 / viewScale, airport.y - 13 / viewScale,
            tw + 10 / viewScale, 15 / viewScale, 4 / viewScale);
    } else {
        ctx.rect(airport.x + r + 3 / viewScale, airport.y - 13 / viewScale,
            tw + 10 / viewScale, 15 / viewScale);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PK_INK;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, airport.x + r + 8 / viewScale, airport.y - 5 / viewScale);
    ctx.restore();
}

/** PAPI 坡度灯（进近坡度指示）：跑道头外侧 2×2，两白两红 */
function drawPapi(tx, ty, rad, s) {
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const px = -dy, py = dx;
    const lights = [
        { x: tx - dx * s * 0.16 + px * s * 0.1, y: ty - dy * s * 0.16 + py * s * 0.1, c: '#fffdf2' },
        { x: tx - dx * s * 0.24 + px * s * 0.14, y: ty - dy * s * 0.24 + py * s * 0.14, c: '#fffdf2' },
        { x: tx - dx * s * 0.16 - px * s * 0.1, y: ty - dy * s * 0.16 - py * s * 0.1, c: '#e8503a' },
        { x: tx - dx * s * 0.24 - px * s * 0.14, y: ty - dy * s * 0.24 - py * s * 0.14, c: '#e8503a' }
    ];
    ctx.save();
    lights.forEach(l => {
        ctx.fillStyle = l.c;
        ctx.strokeStyle = PK_INK;
        ctx.lineWidth = 0.8 / viewScale;
        const r = Math.max(1.6, s * 0.045);
        ctx.beginPath();
        ctx.arc(l.x, l.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });
    ctx.restore();
}

/** 进近灯光系统：入口端外 10 盏依次减暗的「小白灯」 */
function drawApproachLights(tx, ty, rad, s) {
    const dx = Math.cos(rad), dy = Math.sin(rad);
    ctx.save();
    for (let i = 1; i <= 10; i++) {
        const d = s * (0.15 + i * 0.12);
        const alpha = 0.9 - i * 0.06;
        ctx.fillStyle = `rgba(255,253,242,${alpha.toFixed(2)})`;
        const w = Math.max(1, s * 0.035);
        ctx.fillRect(tx - dx * d - w / 2 + dy * s * 0.02, ty - dy * d - w / 2 - dx * s * 0.02, w, w);
    }
    ctx.restore();
}

function towerChart(airport) {
    const s = kmToPxFixed(1);
    const pairs = runwayList(state.focusAirport);
    ctx.save();
    ctx.font = `bold ${12 / viewScale}px 'Microsoft YaHei', sans-serif`;
    ctx.fillStyle = '#385e59';
    ctx.fillText(`${airport.name} ${state.focusAirport} · 场面滑行图`, airport.x - 2.2 * s, airport.y - 2.65 * s);
    ctx.restore();

    /* 机场草地（塔台地面视角：跑道之外是绿坪） */
    ctx.save();
    ctx.fillStyle = 'rgba(112,168,110,0.16)';
    ctx.beginPath(); ctx.arc(airport.x, airport.y, kmToPxFixed(11), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    /* 草地上的像素小树（共享像素地物库） */
    ctx.save();
    for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2 + 0.31;
        const rr = kmToPxFixed(9.2);
        drawPixelTree(airport.x + Math.cos(ang) * rr, airport.y + Math.sin(ang) * rr, 26 / viewScale);
    }
    ctx.restore();

    pairs.forEach((pair, index) => {
        const heading = runwayHeading(runwayEnd(pair, 0));
        if (heading === null) return;
        ctx.save();
        ctx.translate(airport.x, airport.y);
        ctx.rotate((heading - 90) * Math.PI / 180);
        ctx.translate(0, (index - (pairs.length - 1) / 2) * s * 0.55);
        // 跑道、两端入口和与之平行的滑行道，均是可缩放的独立图层。
        ctx.fillStyle = '#c9c9c4';
        ctx.strokeStyle = PK_INK;
        ctx.lineWidth = 1.4 / viewScale;
        ctx.fillRect(-2.1 * s, -0.14 * s, 4.2 * s, 0.28 * s);
        ctx.strokeRect(-2.1 * s, -0.14 * s, 4.2 * s, 0.28 * s);
        ctx.strokeStyle = '#fffdf2';
        ctx.lineWidth = 1.5 / viewScale;
        ctx.setLineDash([0.25 * s, 0.18 * s]);
        ctx.beginPath(); ctx.moveTo(-1.85 * s, 0); ctx.lineTo(1.85 * s, 0); ctx.stroke();
        ctx.setLineDash([]);
        /* 跑道入口的国标-ish 标识条 */
        ctx.strokeStyle = '#e8b04a';
        ctx.lineWidth = 1.4 / viewScale;
        [-1.7, 1.7].forEach(v => {
            ctx.beginPath(); ctx.moveTo(v * s, -0.1 * s); ctx.lineTo(v * s, 0.1 * s); ctx.stroke();
        });
        ctx.strokeStyle = '#c98a4a';
        ctx.lineWidth = 1.4 / viewScale;
        ctx.beginPath(); ctx.moveTo(-1.8 * s, 0.55 * s); ctx.lineTo(1.8 * s, 0.55 * s); ctx.stroke();
        [-1.35, 0, 1.35].forEach(v => {
            ctx.beginPath(); ctx.moveTo(v * s, 0.14 * s); ctx.lineTo(v * s, 0.55 * s); ctx.stroke();
        });
        ctx.font = `bold ${9 / viewScale}px Consolas, monospace`;
        ctx.fillStyle = PK_INK;
        ctx.fillText(runwayEnd(pair, 0), -2.2 * s, -0.25 * s);
        ctx.fillText(runwayEnd(pair, 1), 1.7 * s, -0.25 * s);
        ctx.restore();

        /* v2.0：两端各一套 PAPI + 进近灯光（世界坐标，随跑道朝向） */
        const rad = (heading - 90) * Math.PI / 180;
        const endX = airport.x + Math.cos(rad) * 2.1 * s, endY = airport.y + Math.sin(rad) * 2.1 * s;
        drawPapi(endX, endY, rad + Math.PI, s * 0.1);
        drawApproachLights(endX, endY, rad + Math.PI, s * 0.1);
        const thX = airport.x - Math.cos(rad) * 2.1 * s, thY = airport.y - Math.sin(rad) * 2.1 * s;
        drawPapi(thX, thY, rad, s * 0.1);
        drawApproachLights(thX, thY, rad, s * 0.1);
    });

    // 候机坪和机位与跑道分层，体现塔台的地面运行视角。
    ctx.save();
    ctx.translate(airport.x, airport.y + s * 1.5);
    ctx.fillStyle = '#e3d3ae';
    ctx.strokeStyle = '#8a7a5c';
    ctx.lineWidth = 1.4 / viewScale;
    ctx.fillRect(-2.25 * s, 0, 4.5 * s, 1.35 * s);
    ctx.strokeRect(-2.25 * s, 0, 4.5 * s, 1.35 * s);
    ctx.fillStyle = '#9dbd87';
    ctx.fillRect(-1.65 * s, 0.95 * s, 3.3 * s, 0.42 * s);
    for (let i = -2; i <= 2; i++) {
        ctx.strokeStyle = '#a89678';
        ctx.beginPath(); ctx.moveTo(i * 0.7 * s, 0.16 * s); ctx.lineTo(i * 0.7 * s, 0.83 * s); ctx.stroke();
        ctx.fillStyle = '#fffdf2';
        ctx.beginPath(); ctx.arc(i * 0.7 * s, 0.16 * s, 2.8 / viewScale, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = `bold ${10 / viewScale}px 'Microsoft YaHei', sans-serif`;
    ctx.fillStyle = '#6b5c48';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('停机坪 / APRON', -1.5 * s, 1.13 * s);
    ctx.restore();

    const selected = state.aircraft.find(ac => ac.id === state.selectedItem?.id && ac.flow === 'departure');
    const runway = selected?.runway || runwayEnd(pairs[0], 0);
    TAXIWAYS.forEach(taxiway => {
        const path = groundPath(airport, state.focusAirport, runway, taxiway);
        if (!path) return;
        const active = (selected?.taxiway || selected?.taxiwayPreview || 'A') === taxiway;
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = active ? '#1f8a80' : '#e08a3a';
        ctx.lineWidth = (active ? 4.4 : 2.6) / viewScale;
        ctx.beginPath();
        path.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        ctx.stroke();
        /* 滑行道中线（黄色虚线，提升掌机地图感） */
        if (active) {
            ctx.strokeStyle = '#ffe9a8';
            ctx.lineWidth = 1.2 / viewScale;
            ctx.setLineDash([6 / viewScale, 5 / viewScale]);
            ctx.beginPath();
            path.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
            ctx.stroke();
            ctx.setLineDash([]);
        }
        /* 等待点/连接点标记：米白对话框 + 粗描边 */
        ctx.fillStyle = active ? '#d9f5ec' : '#fff1d3';
        ctx.strokeStyle = active ? '#1f8a80' : '#c97a30';
        ctx.lineWidth = 1.6 / viewScale;
        ctx.beginPath();
        ctx.arc(path.marker.x, path.marker.y, 9 / viewScale, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.font = `bold ${10 / viewScale}px Consolas, monospace`;
        ctx.fillStyle = PK_INK;
        ctx.textAlign = 'center';
        ctx.fillText(taxiway, path.marker.x, path.marker.y + 3.4 / viewScale);
        ctx.textAlign = 'left';
        ctx.restore();
    });
    const hold = groundPath(airport, state.focusAirport, runway, 'B')?.hold;
    if (hold) {
        ctx.save();
        ctx.strokeStyle = '#e8503a'; ctx.lineWidth = 3 / viewScale;
        ctx.beginPath(); ctx.arc(hold.x, hold.y, 5.5 / viewScale, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#b3271a';
        ctx.font = `bold ${9 / viewScale}px 'Microsoft YaHei', sans-serif`;
        ctx.fillText(`${runway} 等待点`, hold.x + 8 / viewScale, hold.y - 8 / viewScale);
        ctx.restore();
    }
    ring(airport, 5, 'rgba(201,122,48,0.55)', '5 KM');
    ring(airport, 15, 'rgba(201,122,48,0.4)', 'TWR 15 KM');

    /* v2.0：跑道中部的风向袋（指示当前起降方向） */
    const wHdg = runwayHeading(runwayEnd(pairs[0], 0));
    if (wHdg !== null) {
        const wRad = (wHdg - 90) * Math.PI / 180;
        drawPixelWindsock(airport.x - Math.cos(wRad) * s * 1.2, airport.y - Math.sin(wRad) * s * 1.2, s * 0.35);
    }
}

function approachChart(airport) {
    const runwayRadius = kmToPxFixed(18);
    for (const pair of runwayList(state.focusAirport)) {
        for (const end of [0, 1]) {
            const heading = runwayHeading(runwayEnd(pair, end));
            if (heading === null) continue;
            const rad = (heading - 90) * Math.PI / 180;
            const dx = Math.cos(rad), dy = Math.sin(rad);
            const tx = airport.x - dx * runwayRadius, ty = airport.y - dy * runwayRadius;
            const side = runwayRadius * 0.18;
            ctx.save();
            ctx.fillStyle = 'rgba(43,168,160,0.10)';
            ctx.strokeStyle = 'rgba(31,138,128,0.42)';
            ctx.lineWidth = 1.2 / viewScale;
            ctx.beginPath();
            ctx.moveTo(airport.x, airport.y);
            ctx.lineTo(tx - dy * side, ty + dx * side);
            ctx.lineTo(tx + dy * side, ty - dx * side);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.setLineDash([6 / viewScale, 5 / viewScale]);
            ctx.beginPath(); ctx.moveTo(airport.x, airport.y); ctx.lineTo(tx, ty); ctx.stroke();
            ctx.restore();
        }
    }
    ring(airport, 10, 'rgba(31,138,128,0.36)', '10 KM');
    ring(airport, 30, 'rgba(31,138,128,0.42)', '30 KM');
    ring(airport, 60, 'rgba(31,138,128,0.55)', 'APP 60 KM');
}

function areaChart(airport) {
    ctx.save();
    const radius = kmToPxFixed(200);
    ctx.strokeStyle = 'rgba(122,102,200,0.26)';
    ctx.lineWidth = 1.4 / viewScale;
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        ctx.beginPath();
        ctx.moveTo(airport.x, airport.y);
        ctx.lineTo(airport.x + Math.cos(angle) * radius, airport.y + Math.sin(angle) * radius);
        ctx.stroke();
    }
    ctx.font = `bold ${12 / viewScale}px Consolas, monospace`;
    ctx.fillStyle = 'rgba(74,58,154,0.65)';
    ctx.fillText('ACC-N', airport.x + 10 / viewScale, airport.y - radius * 0.72);
    ctx.fillText('ACC-S', airport.x + 10 / viewScale, airport.y + radius * 0.72);
    ctx.restore();
    ring(airport, 50, 'rgba(122,102,200,0.3)', '50 KM');
    ring(airport, 100, 'rgba(122,102,200,0.4)', '100 KM');
    ring(airport, 200, 'rgba(122,102,200,0.52)', 'ACC 200 KM');
}

export function drawSeatMap(profile) {
    const airport = getAirport(state.focusAirport);
    if (!airport) return;
    if (profile.code === 'TWR') towerChart(airport);
    else if (profile.code === 'APP') approachChart(airport);
    else areaChart(airport);
}
