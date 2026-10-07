/**
 * data/viewProfiles.js — 席位视图档案（数据层·叶子模块）
 *
 * 设计要点（对应「区域/进近/塔台是三张不同的地图」）：
 *   三个席位的**指挥模式不同**，因此各自是一张独立的地图档案：
 *     · 视口：`rangeKm` 决定可见半径 → 初始比例尺 k = 250 / rangeKm（见 core/viewport.js 的可见半径公式），
 *       `zoom` 给出该地图允许的比例尺区间（塔台需要很大的比例尺，区域需要很小的）
 *     · 图层：`layers` 逐项开关（MVA / 空域边界 / 管制区圈 / 跑道与 ILS / 航路点与航线 / 网格 / 距离环）
 *     · 信息语言：`altitudeUnit`（区域用**高度层 FL**，进近/塔台用米）、`airportLabels`（代码/全称）
 *     · 在管范围：`displayScopeKm` 决定本地图把哪些航班视为"自己的"（其余淡化显示，不画标签）
 *
 * 尺度约定：所有几何仍使用 `kmToPxFixed`（不含 viewScale 的固定换算）绘制，
 * 因此**席位归属判定与缩放无关**（判定见 domain/airspace.js），视图只改变"看得多远"。
 */

/** 图层默认值（各档案只覆盖需要改的项） */
const BASE_LAYERS = {
    grid: true,
    rangeRings: true,
    controlAreas: true,
    mva: false,
    airspace: true,
    backgroundLines: true,
    routes: true,
    routePoints: 'all',
    runwayDetail: true,
    ils: true,
    weather: true,
    trail: true,
    conflictLines: true
};

/**
 * 三张地图档案。ACC 管"航路 + 高度层 + 移交"，APP 管"程序 + 引导 + 排序"，TWR 管"跑道 + 五边 + 地面"。
 */
export const VIEW_PROFILES = {
    ACC: {
        code: 'ACC',
        label: '区域管制视图',
        short: '区调',
        purpose: '航路、高度层配备与跨区移交：范围大、看航路点/航线与空域边界，不关心跑道细节',
        rangeKm: 220,
        zoom: { min: 0.15, max: 3 },
        centerOnFocus: true,
        gridSpacingKm: 50,
        rangeRingsKm: [50, 100, 200],
        bearingTicks: 12,
        altitudeUnit: 'fl',
        airportLabels: 'code',
        displayScopeKm: Infinity,
        layers: {
            ...BASE_LAYERS,
            controlAreas: false,
            mva: false,
            airspace: true,
            runwayDetail: false,
            ils: false,
            routePoints: 'all'
        }
    },
    APP: {
        code: 'APP',
        label: '进近管制视图',
        short: '进近',
        purpose: '终端区程序与雷达引导：中等范围、看进近程序/最低高度区/管制区边界与排序',
        rangeKm: 65,
        zoom: { min: 0.8, max: 14 },
        centerOnFocus: true,
        gridSpacingKm: 10,
        rangeRingsKm: [10, 30, 60],
        bearingTicks: 12,
        altitudeUnit: 'm',
        airportLabels: 'full',
        displayScopeKm: 60,
        layers: {
            ...BASE_LAYERS,
            controlAreas: true,
            mva: true,
            airspace: true,
            runwayDetail: true,
            ils: true,
            routePoints: 'near'
        }
    },
    TWR: {
        code: 'TWR',
        label: '塔台管制视图',
        short: '塔台',
        purpose: '跑道与五边：小范围、看跑道/航道延长线/塔台区与地面航班',
        rangeKm: 15,
        zoom: { min: 2, max: 60 },
        centerOnFocus: true,
        gridSpacingKm: 2,
        rangeRingsKm: [5, 10, 15],
        bearingTicks: 12,
        altitudeUnit: 'm',
        airportLabels: 'full',
        displayScopeKm: 15,
        layers: {
            ...BASE_LAYERS,
            controlAreas: true,
            mva: false,
            airspace: false,
            backgroundLines: false,
            runwayDetail: true,
            ils: true,
            routes: false,
            routePoints: 'none'
        }
    }
};

/** 席位顺序（与 data/atcUnits.js 的 UNIT_ORDER 一致：由内到外为 塔台 → 进近 → 区调） */
export const VIEW_ORDER = ['TWR', 'APP', 'ACC'];

/** 默认视图（进近：既有班次玩法的主视角） */
export const DEFAULT_VIEW = 'APP';

/** 取视图档案（未知代码回退默认视图，避免调用方到处判空） */
export function profileFor(code) {
    return VIEW_PROFILES[code] || VIEW_PROFILES[DEFAULT_VIEW];
}

/** 视图清单摘要（切换按钮 / 面板 / 冒烟断言用） */
export function viewList() {
    return VIEW_ORDER.map(code => {
        const p = VIEW_PROFILES[code];
        return {
            code,
            label: p.label,
            short: p.short,
            rangeKm: p.rangeKm,
            zoom: { ...p.zoom },
            altitudeUnit: p.altitudeUnit,
            displayScopeKm: p.displayScopeKm,
            gridSpacingKm: p.gridSpacingKm,
            layers: { ...p.layers }
        };
    });
}

/**
 * 由可见半径反解初始比例尺（core/viewport.js：可见半径 = 250 / viewScale km）。
 * @param {number} rangeKm 期望可见半径（km）
 */
export function fitScaleForRange(rangeKm) {
    const r = Number.isFinite(rangeKm) && rangeKm > 0 ? rangeKm : 65;
    return 250 / r;
}
