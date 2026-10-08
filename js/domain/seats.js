/**
 * domain/seats.js — 席位设置门槛规则（领域层·纯函数）
 *
 * 对齐 CCAR-93TM-R6 §44–§54（文档 docs/CCAR-93TM-ALIGNMENT.md §3）：
 * 按航班量 / 运行条件解算「应设哪些席位」，回答「为什么小机场只有两席、大机场有六席」。
 *
 * 关键约定：planSeats() 只回答「应设哪些席」，**不直接改世界**；
 * 现场层读取结果后决定渲染哪些席位牌、哪些席位由 AI 同事占位。
 *
 * 依赖方向：仅 data(1) 与同层；无副作用、可复现，同一 ops 输入两次结果相同（可单测 / 复盘重算）。
 */

/** 地面管制席 GND 门槛：年架次 >40000 或 ILS Ⅱ 类运行（§47） */
export const THRESHOLD_GND = 40000;
/** 放行许可发布席 CD 门槛：年架次 >100000（§48） */
export const THRESHOLD_CD = 100000;
/** 进近管制单位门槛：年架次 >36000 或空域复杂（§49） */
export const THRESHOLD_APP = 36000;
/** 进场/离场分席门槛：年架次 >60000 → APP-ARR + APP-DEP（§50） */
export const THRESHOLD_APP_SPLIT = 60000;
/** 进近扇区化门槛：年架次 >80000 或空域复杂 → 进近按东西扇拆成 APP-W / APP-E（§50 延伸·多扇区拆中心） */
export const THRESHOLD_APP_SECTOR = 80000;
/** 区域扇区化门槛：年架次 >120000 → 区域按南北扇拆成 ACC-N / ACC-S（§51 延伸·多扇区拆中心） */
export const THRESHOLD_ACC_SECTOR = 120000;

/** 席位常量（供 UI / 断言引用，避免散落字面量） */
export const SEAT = Object.freeze({
    TWR: 'TWR',
    GND: 'GND',
    CD: 'CD',
    SUP: 'SUP',
    APP: 'APP',
    APP_ARR: 'APP-ARR',
    APP_DEP: 'APP-DEP',
    APP_W: 'APP-W',
    APP_E: 'APP-E',
    NTZ: 'NTZ',
    ACC: 'ACC',
    ACC_RDR: 'ACC-RDR',
    ACC_N: 'ACC-N',
    ACC_S: 'ACC-S'
});

/**
 * 扇区边界几何（领域层只给定义，渲染由 render/ 负责）。
 * 角度约定：正东为 0°，逆时针为正（数学约定，y 轴向上）；画布 y 轴向下由渲染层自行翻转。
 * radiusKm / 角度均为示意值【需试玩校验】，可在此集中调整。
 *   APP-W 西扇 90°→270°（跨 180°）｜APP-E 东扇 270°→90°（跨 0°）
 *   ACC-N 北扇 0°→180°（跨 90°）｜ACC-S 南扇 180°→360°（跨 270°）
 */
export const SECTOR_GEO = Object.freeze({
    'APP-W': Object.freeze({ radiusKm: 60, startDeg: 90, endDeg: 270 }),
    'APP-E': Object.freeze({ radiusKm: 60, startDeg: 270, endDeg: 90 }),
    'ACC-N': Object.freeze({ radiusKm: 220, startDeg: 0, endDeg: 180 }),
    'ACC-S': Object.freeze({ radiusKm: 220, startDeg: 180, endDeg: 360 })
});

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 单个扇区描述（纯数据，可 JSON.stringify）：seats 为该扇区内的席位，boundary 为边界定义 */
const sectorOf = (id, unit, name) => ({
    id,
    unit,
    name,
    seats: [id],
    boundary: { kind: 'sector', ...(SECTOR_GEO[id] || { radiusKm: 60, startDeg: 0, endDeg: 360 }) }
});

/**
 * 按运行条件解算应设席位。
 * @param {object} ops { annualMovements, ilsCat, airspaceComplex, parallelApproach, radarControl }
 * @returns {{ tower:string[], approach:string[], area:string[], reasons:object, sectors:object[] }}
 *   tower    —— 塔台设施内岗位（TWR 常开；GND/CD 达标才开；进近并入时含 APP；主任席 SUP 常驻）
 *   approach —— 独立进近管制单位（APP，或 APP-ARR/APP-DEP，或大流量下按东西扇拆为 APP-W/APP-E；独立平行进近追加 NTZ）
 *   area     —— 区域管制（ACC；大流量下按南北扇拆为 ACC-N/ACC-S；实施雷达管制追加 ACC-RDR）
 *   reasons  —— 每个决策的中文依据（含「由 XX 席兼任」合并文案）
 *   sectors  —— 已拆分扇区的边界定义（未拆分时为 []），供 render/ 绘制扇区边界
 */
export function planSeats(ops = {}) {
    const annualMovements = num(ops.annualMovements);
    const ilsCat = num(ops.ilsCat);
    const airspaceComplex = ops.airspaceComplex === true;
    const parallelApproach = ops.parallelApproach || 'none';
    const radarControl = ops.radarControl === true;

    const tower = [SEAT.TWR];
    const approach = [];
    const area = [];
    const sectors = [];
    const reasons = {};

    /* 地面管制席 GND（§47）：年架次 >40000 或 ILS Ⅱ 类运行，否则并入 TWR */
    const gndOpen = annualMovements > THRESHOLD_GND || ilsCat === 2;
    if (gndOpen) {
        tower.push(SEAT.GND);
        reasons.GND = `年架次 ${annualMovements} > ${THRESHOLD_GND} 或 ILS ${ilsCat} 类运行 → 开放 GND`;
    } else {
        reasons.GND = `年架次 ${annualMovements} ≤ ${THRESHOLD_GND} 且非 ILS Ⅱ 类 → GND 由 TWR 席兼任`;
    }

    /* 放行许可发布席 CD（§48）：年架次 >100000，否则并入地面席（地面已并入塔台时并入 TWR） */
    const cdHost = gndOpen ? SEAT.GND : SEAT.TWR;
    const cdOpen = annualMovements > THRESHOLD_CD;
    if (cdOpen) {
        tower.push(SEAT.CD);
        reasons.CD = `年架次 ${annualMovements} > ${THRESHOLD_CD} → 开放 CD`;
    } else {
        reasons.CD = `年架次 ${annualMovements} ≤ ${THRESHOLD_CD} → CD 由 ${cdHost} 席兼任`;
    }

    /* 进近管制单位（§49）：年架次 >36000 或空域复杂；否则在塔台设进近席 */
    const appOpen = annualMovements > THRESHOLD_APP || airspaceComplex;
    if (!appOpen) {
        tower.push(SEAT.APP);
        reasons.APP = `年架次 ${annualMovements} ≤ ${THRESHOLD_APP} 且空域不复杂 → 进近席由 TWR 席兼任（在塔台设进近席）`;
    } else if (annualMovements > THRESHOLD_APP_SECTOR || airspaceComplex) {
        approach.push(SEAT.APP_W, SEAT.APP_E);
        reasons.APP = `年架次 ${annualMovements} > ${THRESHOLD_APP_SECTOR} 或空域复杂 → 进近按东西扇拆为 APP-W / APP-E（§50·多扇区）`;
        sectors.push(sectorOf(SEAT.APP_W, 'approach', '进近西扇'), sectorOf(SEAT.APP_E, 'approach', '进近东扇'));
    } else if (annualMovements > THRESHOLD_APP_SPLIT) {
        approach.push(SEAT.APP_ARR, SEAT.APP_DEP);
        reasons.APP = `年架次 ${annualMovements} > ${THRESHOLD_APP_SPLIT} → APP 拆分为 APP-ARR / APP-DEP（§50）`;
    } else {
        approach.push(SEAT.APP);
        reasons.APP = `年架次 ${annualMovements} > ${THRESHOLD_APP} 或空域复杂 → 开放独立进近管制单位 APP`;
    }

    /* 非侵入区监控席 NTZ（§49）：独立平行仪表进近 */
    if (parallelApproach === 'independent') {
        approach.push(SEAT.NTZ);
        reasons.NTZ = '独立平行仪表进近 → 开放 NTZ 席位监控非侵入区（§49）';
    } else {
        reasons.NTZ = `平行进近模式 ${parallelApproach} ≠ independent → 不设 NTZ`;
    }

    /* 区域管制（§51）：基础 ACC；大流量按南北扇拆分；实施雷达管制才追加雷达管制席，否则降级为程序管制 */
    if (annualMovements > THRESHOLD_ACC_SECTOR) {
        area.push(SEAT.ACC_N, SEAT.ACC_S);
        reasons.ACC = `年架次 ${annualMovements} > ${THRESHOLD_ACC_SECTOR} → 区域按南北扇拆为 ACC-N / ACC-S（§51·多扇区）`;
        sectors.push(sectorOf(SEAT.ACC_N, 'area', '区域北扇'), sectorOf(SEAT.ACC_S, 'area', '区域南扇'));
    } else {
        area.push(SEAT.ACC);
        reasons.ACC = '区域管制单位（程序管制基线）';
    }
    if (radarControl) {
        area.push(SEAT.ACC_RDR);
        reasons.RDR = '实施雷达管制必须设雷达管制席 → 开放 ACC-RDR（§51）';
    } else {
        reasons.RDR = 'radarControl 关闭 → 降级为程序管制玩法，不出现雷达管制席';
    }

    /* 主任席 SUP（§47/§49/§50）：现场层领班常驻 */
    tower.push(SEAT.SUP);
    reasons.SUP = '主任席（领班）常驻，负责现场监督与席位开合决策';

    return { tower, approach, area, reasons, sectors };
}
