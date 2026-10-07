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

/** 席位常量（供 UI / 断言引用，避免散落字面量） */
export const SEAT = Object.freeze({
    TWR: 'TWR',
    GND: 'GND',
    CD: 'CD',
    SUP: 'SUP',
    APP: 'APP',
    APP_ARR: 'APP-ARR',
    APP_DEP: 'APP-DEP',
    NTZ: 'NTZ',
    ACC: 'ACC',
    ACC_RDR: 'ACC-RDR'
});

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * 按运行条件解算应设席位。
 * @param {object} ops { annualMovements, ilsCat, airspaceComplex, parallelApproach, radarControl }
 * @returns {{ tower:string[], approach:string[], area:string[], reasons:object }}
 *   tower    —— 塔台设施内岗位（TWR 常开；GND/CD 达标才开；进近并入时含 APP；主任席 SUP 常驻）
 *   approach —— 独立进近管制单位（APP 或 APP-ARR/APP-DEP；独立平行进近追加 NTZ）
 *   area     —— 区域管制（ACC；实施雷达管制追加 ACC-RDR）
 *   reasons  —— 每个决策的中文依据（含「由 XX 席兼任」合并文案）
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

    /* 区域管制（§51）：基础 ACC；实施雷达管制才追加雷达管制席，否则降级为程序管制 */
    area.push(SEAT.ACC);
    reasons.ACC = '区域管制单位（程序管制基线）';
    if (radarControl) {
        area.push(SEAT.ACC_RDR);
        reasons.RDR = '实施雷达管制必须设雷达管制席 → 开放 ACC-RDR（§51）';
    } else {
        reasons.RDR = 'radarControl 关闭 → 降级为程序管制玩法，不出现雷达管制席';
    }

    /* 主任席 SUP（§47/§49/§50）：现场层领班常驻 */
    tower.push(SEAT.SUP);
    reasons.SUP = '主任席（领班）常驻，负责现场监督与席位开合决策';

    return { tower, approach, area, reasons };
}