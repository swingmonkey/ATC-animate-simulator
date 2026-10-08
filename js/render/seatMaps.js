/** 按席位绘制三种业务地图。几何与飞机共用世界坐标，切换地图不改变仿真。 */
import { ctx, kmToPxFixed, viewScale } from '../core/viewport.js';
import { state } from '../core/store.js';
import { getAirport, runwayList, runwayEnd, runwayHeading } from '../data/airports.js';
import { groundPath, TAXIWAYS } from '../data/groundLayout.js';

function ring(airport, km, color, label) {
    const r = kmToPxFixed(km);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / viewScale;
    ctx.setLineDash([5 / viewScale, 5 / viewScale]);
    ctx.beginPath(); ctx.arc(airport.x, airport.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = `bold ${10 / viewScale}px Consolas, monospace`;
    ctx.fillText(label, airport.x + r + 5 / viewScale, airport.y - 4 / viewScale);
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
    ctx.save();
    ctx.fillStyle = 'rgba(100,152,112,0.10)';
    ctx.beginPath(); ctx.arc(airport.x, airport.y, kmToPxFixed(11), 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    pairs.forEach((pair, index) => {
        const heading = runwayHeading(runwayEnd(pair, 0));
        if (heading === null) return;
        ctx.save();
        ctx.translate(airport.x, airport.y);
        ctx.rotate((heading - 90) * Math.PI / 180);
        ctx.translate(0, (index - (pairs.length - 1) / 2) * s * 0.55);
        // 跑道、两端入口和与之平行的滑行道，均是可缩放的独立图层。
        ctx.fillStyle = '#d1dbd2';
        ctx.strokeStyle = '#637a70';
        ctx.lineWidth = 1.3 / viewScale;
        ctx.fillRect(-2.1 * s, -0.14 * s, 4.2 * s, 0.28 * s);
        ctx.strokeRect(-2.1 * s, -0.14 * s, 4.2 * s, 0.28 * s);
        ctx.strokeStyle = '#fff9e8';
        ctx.lineWidth = 1.5 / viewScale;
        ctx.setLineDash([0.25 * s, 0.18 * s]);
        ctx.beginPath(); ctx.moveTo(-1.85 * s, 0); ctx.lineTo(1.85 * s, 0); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#c79566';
        ctx.lineWidth = 1.4 / viewScale;
        ctx.beginPath(); ctx.moveTo(-1.8 * s, 0.55 * s); ctx.lineTo(1.8 * s, 0.55 * s); ctx.stroke();
        [-1.35, 0, 1.35].forEach(v => {
            ctx.beginPath(); ctx.moveTo(v * s, 0.14 * s); ctx.lineTo(v * s, 0.55 * s); ctx.stroke();
        });
        ctx.font = `bold ${9 / viewScale}px Consolas, monospace`;
        ctx.fillStyle = '#28445a';
        ctx.fillText(runwayEnd(pair, 0), -2.2 * s, -0.25 * s);
        ctx.fillText(runwayEnd(pair, 1), 1.7 * s, -0.25 * s);
        ctx.restore();
    });

    // 候机坪和机位与跑道分层，体现塔台的地面运行视角。
    ctx.save();
    ctx.translate(airport.x, airport.y + s * 1.5);
    ctx.fillStyle = '#f0e5ca';
    ctx.strokeStyle = '#af9780';
    ctx.lineWidth = 1.3 / viewScale;
    ctx.fillRect(-2.25 * s, 0, 4.5 * s, 1.35 * s);
    ctx.strokeRect(-2.25 * s, 0, 4.5 * s, 1.35 * s);
    ctx.fillStyle = '#a6c0b5';
    ctx.fillRect(-1.65 * s, 0.95 * s, 3.3 * s, 0.42 * s);
    for (let i = -2; i <= 2; i++) {
        ctx.strokeStyle = '#ab9d81';
        ctx.beginPath(); ctx.moveTo(i * 0.7 * s, 0.16 * s); ctx.lineTo(i * 0.7 * s, 0.83 * s); ctx.stroke();
        ctx.fillStyle = '#fff9e8';
        ctx.beginPath(); ctx.arc(i * 0.7 * s, 0.16 * s, 2.8 / viewScale, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = `bold ${10 / viewScale}px 'Microsoft YaHei', sans-serif`;
    ctx.fillStyle = '#735e56';
    ctx.fillText('停机坪 / APRON', -1.5 * s, 1.15 * s);
    ctx.restore();

    const selected = state.aircraft.find(ac => ac.id === state.selectedItem?.id && ac.flow === 'departure');
    const runway = selected?.runway || runwayEnd(pairs[0], 0);
    TAXIWAYS.forEach(taxiway => {
        const path = groundPath(airport, state.focusAirport, runway, taxiway);
        if (!path) return;
        const active = (selected?.taxiway || selected?.taxiwayPreview || 'A') === taxiway;
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = active ? '#1b8f88' : '#c59466';
        ctx.lineWidth = (active ? 4 : 2.2) / viewScale;
        ctx.beginPath();
        path.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        ctx.stroke();
        ctx.fillStyle = active ? '#d7f3e5' : '#fff1d3';
        ctx.strokeStyle = active ? '#1b8f88' : '#a2704d';
        ctx.lineWidth = 1 / viewScale;
        ctx.beginPath(); ctx.arc(path.marker.x, path.marker.y, 9 / viewScale, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.font = `bold ${10 / viewScale}px Consolas, monospace`;
        ctx.fillStyle = '#28445a';
        ctx.textAlign = 'center';
        ctx.fillText(taxiway, path.marker.x, path.marker.y + 3.2 / viewScale);
        ctx.restore();
    });
    const hold = groundPath(airport, state.focusAirport, runway, 'B')?.hold;
    if (hold) {
        ctx.save();
        ctx.strokeStyle = '#d75f4e'; ctx.lineWidth = 3 / viewScale;
        ctx.beginPath(); ctx.arc(hold.x, hold.y, 5 / viewScale, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#9a4337';
        ctx.font = `bold ${9 / viewScale}px 'Microsoft YaHei', sans-serif`;
        ctx.fillText(`${runway} 等待点`, hold.x + 8 / viewScale, hold.y - 8 / viewScale);
        ctx.restore();
    }
    ring(airport, 5, 'rgba(166,111,68,0.55)', '5 KM');
    ring(airport, 15, 'rgba(166,111,68,0.42)', 'TWR 15 KM');
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
            ctx.fillStyle = 'rgba(30,145,139,0.09)';
            ctx.strokeStyle = 'rgba(30,145,139,0.38)';
            ctx.lineWidth = 1 / viewScale;
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
    ring(airport, 10, 'rgba(22,140,135,0.36)', '10 KM');
    ring(airport, 30, 'rgba(22,140,135,0.42)', '30 KM');
    ring(airport, 60, 'rgba(22,140,135,0.55)', 'APP 60 KM');
}

function areaChart(airport) {
    ctx.save();
    const radius = kmToPxFixed(200);
    ctx.strokeStyle = 'rgba(91,101,160,0.28)';
    ctx.lineWidth = 1.2 / viewScale;
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        ctx.beginPath();
        ctx.moveTo(airport.x, airport.y);
        ctx.lineTo(airport.x + Math.cos(angle) * radius, airport.y + Math.sin(angle) * radius);
        ctx.stroke();
    }
    ctx.font = `bold ${12 / viewScale}px Consolas, monospace`;
    ctx.fillStyle = 'rgba(70,79,144,0.6)';
    ctx.fillText('ACC-N', airport.x + 10 / viewScale, airport.y - radius * 0.72);
    ctx.fillText('ACC-S', airport.x + 10 / viewScale, airport.y + radius * 0.72);
    ctx.restore();
    ring(airport, 50, 'rgba(80,90,158,0.33)', '50 KM');
    ring(airport, 100, 'rgba(80,90,158,0.42)', '100 KM');
    ring(airport, 200, 'rgba(80,90,158,0.56)', 'ACC 200 KM');
}

export function drawSeatMap(profile) {
    const airport = getAirport(state.focusAirport);
    if (!airport) return;
    if (profile.code === 'TWR') towerChart(airport);
    else if (profile.code === 'APP') approachChart(airport);
    else areaChart(airport);
}
