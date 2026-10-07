/**
 * render/airports.js — 机场、跑道与管制区（塔台/进近）图层（绘制层）
 *
 * 尺度约定：使用 kmToPxFixed（不含 viewScale 的固定换算），因此
 * 管制区半径在世界坐标中是固定地理要素，缩放地图只改变视觉大小，
 * 不会改变「飞机归属哪个席位」的判定（判定见 simulation/units.js，同样用 pxToKmFixed）。
 */

import { ctx, kmToPxFixed, viewScale } from '../core/viewport.js';
import { state } from '../core/store.js';
import { AIRPORTS, runwayList, runwayEnd, runwayHeading } from '../data/airports.js';
import { ATC_UNITS, unitFrequency } from '../data/atcUnits.js';

/** 世界坐标中 1 km 对应的绘制长度 */
const PX_PER_KM = () => kmToPxFixed(1);

/** 焦点机场的跑道与进近（ILS）延长线：直观展示「进近」管制内容 */
function drawFocusAirportDetails(code, ap) {
    const runwayLength = PX_PER_KM() * 3.4;
    const extLength = PX_PER_KM() * 18;

    runwayList(code).forEach(pair => {
        [runwayEnd(pair, 0), runwayEnd(pair, 1)].forEach((label, idx) => {
            const hdg = runwayHeading(label);
            if (hdg === null) return;
            const rad = (hdg - 90) * Math.PI / 180;      // 与飞机朝向同一套坐标约定
            const dirX = Math.cos(rad), dirY = Math.sin(rad);
            // 入口端（着陆方向的反向端）与跑道末端
            const thX = ap.x - dirX * runwayLength / 2, thY = ap.y - dirY * runwayLength / 2;
            const endX = ap.x + dirX * runwayLength / 2, endY = ap.y + dirY * runwayLength / 2;

            // 跑道条只画一次（对向跑道是同一条）
            if (idx === 0) {
                ctx.strokeStyle = '#334155';
                ctx.lineWidth = 3.4;
                ctx.beginPath(); ctx.moveTo(thX, thY); ctx.lineTo(endX, endY); ctx.stroke();
                ctx.strokeStyle = '#f8fafc';
                ctx.lineWidth = 2.2;
                ctx.beginPath(); ctx.moveTo(thX, thY); ctx.lineTo(endX, endY); ctx.stroke();
            }

            // 进近航道延长线：自入口端沿反方向外延（飞机由此方向进近）
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'rgba(3,105,161,0.55)';
            ctx.lineWidth = 1 / viewScale;
            ctx.beginPath();
            ctx.moveTo(thX, thY);
            ctx.lineTo(thX - dirX * extLength, thY - dirY * extLength);
            ctx.stroke();
            ctx.restore();

            // 跑道号（放大到一定程度才显示，避免小比例尺糊成一团）
            if (viewScale >= 1.2) {
                ctx.save();
                ctx.font = `${8 / viewScale}px Consolas`;
                ctx.fillStyle = '#0f172a';
                ctx.fillText(label, thX + dirX * 7 - 4 / viewScale, thY + dirY * 7 + 3 / viewScale);
                ctx.restore();
            }
        });
    });

    // 焦点机场名称与塔台/进近频率
    ctx.save();
    ctx.font = `bold ${11 / viewScale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(`${ap.name} ${code}`, ap.x, ap.y - 16 / viewScale);
    ctx.font = `${9 / viewScale}px Consolas`;
    ctx.fillStyle = ATC_UNITS.TWR.color;
    ctx.fillText(`塔台 ${unitFrequency('TWR', code)}`, ap.x, ap.y + 22 / viewScale);
    ctx.fillStyle = ATC_UNITS.APP.color;
    ctx.fillText(`进近 ${unitFrequency('APP', code)}`, ap.x, ap.y + 34 / viewScale);
    ctx.textAlign = 'left';
    ctx.restore();
}

/**
 * 管制区图层：所有机场的塔台区（15km 圆）+ 焦点机场的进近区（60km 圆）。
 * 席位过滤选中时，该席位范围高亮。
 */
export function drawControlAreas() {
    const focus = state.focusAirport;
    const seatFilter = state.seatFilter;
    const twrR = kmToPxFixed(ATC_UNITS.TWR.scopeKm);
    const appR = kmToPxFixed(ATC_UNITS.APP.scopeKm);

    Object.entries(AIRPORTS).forEach(([code, ap]) => {
        const isFocus = code === focus;
        ctx.save();
        ctx.setLineDash([4 / viewScale, 4 / viewScale]);
        ctx.strokeStyle = isFocus
            ? ATC_UNITS.TWR.color
            : (seatFilter === 'TWR' ? 'rgba(180,83,9,0.55)' : 'rgba(180,83,9,0.28)');
        ctx.lineWidth = (isFocus ? 1.3 : 0.8) / viewScale;
        ctx.beginPath(); ctx.arc(ap.x, ap.y, twrR, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    });

    if (!focus || !AIRPORTS[focus]) return;
    const fap = AIRPORTS[focus];
    ctx.save();
    ctx.setLineDash([7 / viewScale, 6 / viewScale]);
    ctx.strokeStyle = seatFilter === 'APP' ? ATC_UNITS.APP.color : 'rgba(3,105,161,0.6)';
    ctx.lineWidth = (seatFilter === 'APP' ? 1.6 : 1.1) / viewScale;
    ctx.beginPath(); ctx.arc(fap.x, fap.y, appR, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // 进近区淡填充：强调「终端区」范围
    ctx.fillStyle = seatFilter === 'APP' ? 'rgba(3,105,161,0.10)' : 'rgba(3,105,161,0.05)';
    ctx.beginPath(); ctx.arc(fap.x, fap.y, appR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

/** 机场图标（点 + 塔台区标注） */
export function drawAirports() {
    const focus = state.focusAirport;
    Object.entries(AIRPORTS).forEach(([code, ap]) => {
        const isFocus = code === focus;
        const r = isFocus ? 4.5 / viewScale : 3 / viewScale;
        ctx.save();
        ctx.fillStyle = isFocus ? '#b45309' : '#475569';
        ctx.beginPath(); ctx.arc(ap.x, ap.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2 / viewScale;
        ctx.stroke();
        ctx.restore();
        if (isFocus) drawFocusAirportDetails(code, ap);
    });
}
