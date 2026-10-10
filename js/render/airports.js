/**
 * render/airports.js — 机场、跑道与管制区（塔台/进近）图层（绘制层）
 *
 * 尺度约定：使用 kmToPxFixed（不含 viewScale 的固定换算），因此
 * 管制区半径在世界坐标中是固定地理要素，缩放地图只改变视觉大小，
 * 不会改变「飞机归属哪个席位」的判定（判定见 simulation/units.js，同样用 pxToKmFixed）。
 *
 * M2·T9：拆分扇区（APP-W/E、ACC-N/S）时，在焦点机场叠加扇区边界；
 * 几何（半径/起止角）取自领域层 domain/seats.js 的 SECTOR_GEO，本文件只负责画。
 */

import { ctx, kmToPxFixed, viewScale } from '../core/viewport.js';
import { state } from '../core/store.js';
import { AIRPORTS, runwayList, runwayEnd, runwayHeading } from '../data/airports.js';
import { ATC_UNITS, unitFrequency } from '../data/atcUnits.js';
import { sectorPlanOf, totalAnnualMovements } from '../domain/management.js';
import { drawPixelTower, drawPixelWindsock, drawPixelTree } from './pixel.js';

/** 世界坐标中 1 km 对应的绘制长度 */
const PX_PER_KM = () => kmToPxFixed(1);

/**  airports 图层的墨色描边（与像素精灵统一） */
const PK_INK_AIRPORTS = '#2b2f4a';

const DEG = Math.PI / 180;

/* ---------------- 扇区（M2·T9） ---------------- */

/** 经营状态解算出的扇区规划缓存（每帧绘制都要用，按状态引用 + 关键输入做浅缓存） */
let sectorCache = { m: null, sig: '', sectors: [] };

/**
 * 当前经营状态下应绘制的扇区（未进入经营模式 / 未达拆分门槛时为空数组）。
 * 与 ui/seatPanel.js 同源（domain/management.sectorPlanOf），保证面板与画布口径一致。
 */
function plannedSectors() {
    const m = state.management;
    if (!m) return [];
    const sig = [totalAnnualMovements(m), m.ilsCat || 1, m.parallelApproach || 'none', m.tech || 'procedural'].join('|');
    if (sectorCache.m === m && sectorCache.sig === sig) return sectorCache.sectors;
    sectorCache = { m, sig, sectors: sectorPlanOf(m).sectors || [] };
    return sectorCache.sectors;
}

/**
 * 领域扇区几何 → 画布弧线参数。
 * 领域约定：正东 0°、逆时针为正（y 轴向上）；画布 y 轴向下，故取负角。
 * 领域扇区按「逆时针从 startDeg 扫到 endDeg」定义（可跨 0°），
 * 因此画布弧恒定用 anticlockwise=true（数学逆时针 = 画布逆时针）。
 */
export function sectorArcOf(boundary) {
    const startDeg = Number(boundary?.startDeg) || 0;
    const endDeg = Number(boundary?.endDeg) || 0;
    const sweepDeg = ((((endDeg - startDeg) % 360) + 360) % 360) || 360;
    return {
        radiusKm: Number(boundary?.radiusKm) || 0,
        start: -startDeg * DEG,
        end: -(startDeg + sweepDeg) * DEG,
        sweep: sweepDeg * DEG
    };
}

/** 单个扇区：径向分界线 + 弧线 + 淡填充 + 扇区名标签（线宽/虚线随 viewScale 保持屏幕恒定） */
function drawSectorBoundary(ap, sector, seatFilter) {
    const geo = sectorArcOf(sector.boundary);
    if (geo.radiusKm <= 0) return;
    const r = kmToPxFixed(geo.radiusKm);
    const unitCode = sector.unit === 'approach' ? 'APP' : 'ACC';
    const color = ATC_UNITS[unitCode].color;
    const active = seatFilter === sector.id || seatFilter === unitCode;
    const full = geo.sweep >= Math.PI * 2 - 1e-6;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ap.x, ap.y);
    if (full) ctx.arc(ap.x, ap.y, r, 0, Math.PI * 2);
    else ctx.arc(ap.x, ap.y, r, geo.start, geo.end, true);
    ctx.closePath();

    ctx.setLineDash([6 / viewScale, 5 / viewScale]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = active ? 0.85 : 0.45;
    ctx.lineWidth = (active ? 1.6 : 1) / viewScale;
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.globalAlpha = active ? 0.09 : 0.04;
    ctx.fill();
    ctx.restore();

    // 扇区名标签：取扇区中线方向，半径 70% 处，避免压住中心机场图标
    const mid = geo.start - geo.sweep / 2;
    ctx.save();
    ctx.font = (9 / viewScale) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.globalAlpha = active ? 0.95 : 0.7;
    ctx.fillText(sector.id, ap.x + Math.cos(mid) * r * 0.7, ap.y + Math.sin(mid) * r * 0.7);
    ctx.restore();
}

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
                ctx.lineWidth = 3.4 / viewScale;
                ctx.beginPath(); ctx.moveTo(thX, thY); ctx.lineTo(endX, endY); ctx.stroke();
                ctx.strokeStyle = '#f8fafc';
                ctx.lineWidth = 2.2 / viewScale;
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

    drawAirportScenery(code, ap);
}

/** 焦点机场地物（进近/区域图）：像素控制塔 + 航站楼 + 机库 + 风向袋，比例随地图公里尺度 */
function drawAirportScenery(code, ap) {
    const s = PX_PER_KM();
    const pairs = runwayList(code);
    const heading = pairs.length ? runwayHeading(runwayEnd(pairs[0], 0)) : 90;
    if (heading === null) return;
    const rad = (heading - 90) * Math.PI / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    // 垂直于跑道的两个方向：一侧放航站区，一侧放风向袋与草地
    const sideX = -dy, sideY = dx;
    const terminalX = ap.x + sideX * s * 0.85 + dx * s * 0.4;
    const terminalY = ap.y + sideY * s * 0.85 + dy * s * 0.4;

    ctx.save();
    /* 航站楼：指廊式主体 + 登机桥 + 窗带 */
    ctx.fillStyle = '#e8e2d2';
    ctx.strokeStyle = PK_INK_AIRPORTS;
    ctx.lineWidth = 1 / viewScale;
    const tw = s * 0.55, th = s * 0.22;
    ctx.fillRect(terminalX - tw / 2, terminalY - th / 2, tw, th);
    ctx.strokeRect(terminalX - tw / 2, terminalY - th / 2, tw, th);
    ctx.fillStyle = '#8ed0e8';
    for (let i = 0; i < 5; i++) {
        ctx.fillRect(terminalX - tw / 2 + tw * (0.08 + i * 0.18), terminalY - th / 2 + th * 0.25, tw * 0.1, th * 0.42);
    }
    /* 机库 */
    const hx = terminalX - dx * s * 0.85, hy = terminalY - dy * s * 0.85;
    ctx.fillStyle = '#c8cdd4';
    ctx.fillRect(hx - s * 0.16, hy - s * 0.12, s * 0.32, s * 0.24);
    ctx.strokeRect(hx - s * 0.16, hy - s * 0.12, s * 0.32, s * 0.24);
    ctx.fillStyle = '#8ed0e8';
    ctx.fillRect(hx - s * 0.11, hy - s * 0.06, s * 0.22, s * 0.1);

    /* 控制塔与风向袋（跑道另一侧） */
    drawPixelTower(ap.x - sideX * s * 1.15, ap.y - sideY * s * 1.15, s * 0.62);
    drawPixelWindsock(ap.x - sideX * s * 0.35 + dx * s * 0.9, ap.y - sideY * s * 0.35 + dy * s * 0.9, s * 0.3);

    /* 草地小树点缀 */
    for (let i = 0; i < 4; i++) {
        const a = 0.6 + i * 1.25 + (code.length % 3) * 0.4;
        drawPixelTree(ap.x + Math.cos(a) * s * 1.9, ap.y + Math.sin(a) * s * 1.9, s * 0.34);
    }
    ctx.restore();
}

/**
 * 管制区图层：所有机场的塔台区（15km 圆）+ 焦点机场的进近区（60km 圆）+ 扇区边界。
 * 席位过滤选中时，该席位范围高亮；拆分扇区时按领域层几何切出扇区（M2·T9）。
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

    // 扇区边界：外圈（区域 220km）先画，内圈（进近 60km）压在进近圆之上
    const sectors = plannedSectors();
    const isOuter = sec => (sec.boundary?.radiusKm || 0) > ATC_UNITS.APP.scopeKm;
    sectors.filter(isOuter).forEach(sec => drawSectorBoundary(fap, sec, seatFilter));

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

    sectors.filter(sec => !isOuter(sec)).forEach(sec => drawSectorBoundary(fap, sec, seatFilter));
}

/** 机场图标（点 + 塔台区标注） */
export function drawAirports(profile) {
    const focus = state.focusAirport;
    Object.entries(AIRPORTS).forEach(([code, ap]) => {
        const isFocus = code === focus;
        if (!isFocus) {
            /* 非焦点机场：像素双跑道「十字」，一眼认出是机场而非村落 */
            ctx.save();
            const rw = 5.5 / viewScale;
            ctx.strokeStyle = '#5a6480';
            ctx.lineWidth = 1.8 / viewScale;
            ctx.lineCap = 'round';
            for (const a of [Math.PI / 4, -Math.PI / 4]) {
                ctx.beginPath();
                ctx.moveTo(ap.x - Math.cos(a) * rw, ap.y - Math.sin(a) * rw);
                ctx.lineTo(ap.x + Math.cos(a) * rw, ap.y + Math.sin(a) * rw);
                ctx.stroke();
            }
            ctx.fillStyle = '#475569';
            ctx.beginPath();
            ctx.arc(ap.x, ap.y, 2.2 / viewScale, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        if (isFocus) {
            /* 焦点机场中心点（塔台区圆心） */
            ctx.save();
            ctx.fillStyle = '#b45309';
            ctx.beginPath();
            ctx.arc(ap.x, ap.y, 4 / viewScale, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fffdf2';
            ctx.lineWidth = 1.4 / viewScale;
            ctx.stroke();
            ctx.restore();
        }
        if (isFocus && profile?.layers.runwayDetail && profile.code !== 'TWR') drawFocusAirportDetails(code, ap);
        if (isFocus && profile.code === 'TWR') {
            ctx.save();
            ctx.fillStyle = '#b45309';
            ctx.beginPath();
            ctx.arc(ap.x, ap.y, 4.5 / viewScale, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    });
}
