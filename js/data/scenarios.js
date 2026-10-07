/**
 * data/scenarios.js — 内置关卡包（数据层·叶子模块）
 *
 * 说明：PLAN §9 规划过 `data/scenarios/*.json`，但本项目是**零构建 ES 模块**，
 * 浏览器对 JSON 模块导入（import assertions）支持不一，故与 `data/locationSamples.js` 一致，
 * 用 `.js` 导出纯数据对象（内容等价，且可写注释）。
 *
 * 关卡自足性：不依赖位置文件，只含本模块的数据即可开局 —— 进场点**只给方位与信标名**
 * （世界坐标由 game/director.js 按方位 + 空域半径推算），跑道由 runwayIdents + configurations
 * 描述，因而本模块无需任何坐标换算。
 *
 * 时间轴语义：内置关卡的 `timeline` 直接给**绝对时刻** `{ t, type, args }`
 * （位置文件的 `[scenario]` 给的是「距上一事件的经过秒数」，由 game/scenario.js 的 buildTimeline 换算）。
 */

/** 跑道用法字符串 → configurations 条目（与 domain/locations.js 读出的结构一致，便于共用 runwayPlan） */
function rwyEntry(score, ident, usage = 'landstart', extra = {}) {
    const u = String(usage).toLowerCase();
    return {
        score,
        ident,
        usage: {
            start: u.includes('start'),
            land: u.includes('land'),
            rev: u.includes('rev'),
            int: u.includes('int'),
            track: u.includes('track')
        },
        offsetHeading: extra.offsetHeading ?? null,
        nosid: !!extra.nosid
    };
}

/** 单构型封装（反向运行由条目里的 `rev` 表达，见 L3） */
function oneConfig(entries) {
    return [{ name: 'config1', entries }];
}

/**
 * L1 · 进近入门（单跑道 02L，街机难度）
 * 教学目标：把进港航班按序引导落地，练习进近许可与落地许可的下发顺序。
 */
export const SCENARIO_L1 = {
    v: 3,
    id: 'l1-approach-basic',
    name: 'L1 进近入门 · ZUUU 02L',
    brief: '单跑道 02L：把 4 架进港航班按序落地，注意最低高度区与复诵。',
    airport: 'ZUUU',
    difficulty: 'arcade',
    seed: 20261007,
    config: { wind: { dir: 20, spd: 8 } },
    finish: { count: 4, timeLimit: 1500 },
    runwayPairs: ['02L/20R'],
    runwayIdents: { rwy1: '02L' },
    configurations: oneConfig([rwyEntry(0, 'rwy1', 'landstart')]),
    entrypoints: [
        { heading: 90, beacon: 'ZUUU-E', altM: null },
        { heading: 45, beacon: 'ZUUU-NE', altM: null },
        { heading: 180, beacon: 'ZUUU-S', altM: null },
        { heading: 315, beacon: 'ZUUU-NW', altM: null }
    ],
    airlineTable: [
        { code: 'cca', amount: 3, types: ['b738', 'a320'], direction: '' },
        { code: 'csc', amount: 3, types: ['a320', 'a330'], direction: '' },
        { code: 'ces', amount: 2, types: ['b738', 'a321'], direction: '' },
        { code: 'csn', amount: 1, types: ['a320'], direction: '' }
    ],
    timeline: [
        { t: 0, type: 'text', args: ['L1 进近入门：单跑道 02L，按序落地'] },
        { t: 0, type: 'wind', args: ['20', '8'] },
        { t: 0, type: 'score', args: ['0'] },
        { t: 15, type: 'arr', args: ['090', 'ZUUU-E', 'b738', '10000', '5000', '250'] },
        { t: 45, type: 'dep', args: ['rwy1', 'east', 'b738'] },
        { t: 90, type: 'arr', args: ['045', 'ZUUU-NE', 'a320', '11000', '6000', '260'] },
        { t: 150, type: 'dep', args: ['rwy1', 'east', 'a320'] },
        { t: 210, type: 'text', args: ['进港高峰：注意进近排序与复诵'] },
        { t: 240, type: 'arr', args: ['180', 'ZUUU-S', 'a330', '12000', '6000', '270'] },
        { t: 330, type: 'arr', args: ['315', 'ZUUU-NW', 'b738', '11000', '5000', '250'] }
    ],
    objectives: [
        { kind: 'NO_SEPARATION_BREACH', weight: 30 },
        { kind: 'MIN_LANDINGS', value: 4, weight: 25 },
        { kind: 'NO_MVA_BREACH', weight: 20 },
        { kind: 'AVG_DELAY_MAX', value: 180, weight: 15 },
        { kind: 'NO_READBACK_MISSED', weight: 10 }
    ]
};


/**
 * L2 · 离场洪峰（双跑道 + 分数门槛解锁 02R，标准难度）
 * 教学目标：进离港混合流量下的排序与跑道切换；解锁分累积到 5 分后 02R 自动开放。
 */
export const SCENARIO_L2 = {
    v: 3,
    id: 'l2-departure-rush',
    name: 'L2 离场洪峰 · ZUUU 双跑道',
    brief: '双跑道：离港放行洪峰 + 进港排序；解锁分达到 5 后 02R 开放。',
    airport: 'ZUUU',
    difficulty: 'standard',
    seed: 20261008,
    config: { wind: { dir: 20, spd: 6 } },
    finish: { count: 6, timeLimit: 1800 },
    runwayPairs: ['02L/20R', '02R/20L'],
    runwayIdents: { rwy1: '02L', rwy2: '02R' },
    configurations: oneConfig([
        rwyEntry(0, 'rwy1', 'landstart'),
        rwyEntry(5, 'rwy2', 'landstart')          // 解锁分 ≥ 5 后开放第二条跑道
    ]),
    entrypoints: [
        { heading: 90, beacon: 'ZUUU-E', altM: null },
        { heading: 135, beacon: 'ZUUU-SE', altM: null },
        { heading: 225, beacon: 'ZUUU-SW', altM: null },
        { heading: 270, beacon: 'ZUUU-W', altM: null }
    ],
    airlineTable: [
        { code: 'cca', amount: 3, types: ['b738', 'b739'], direction: '' },
        { code: 'csc', amount: 3, types: ['a320', 'a321'], direction: '' },
        { code: 'cwu', amount: 2, types: ['a320', 'arj21'], direction: '' },
        { code: 'ces', amount: 2, types: ['a320', 'b738'], direction: '' },
        { code: 'chh', amount: 1, types: ['b738'], direction: '' }
    ],
    timeline: [
        { t: 0, type: 'text', args: ['L2 离场洪峰：双跑道，注意放行与排序'] },
        { t: 0, type: 'wind', args: ['20', '6'] },
        { t: 0, type: 'score', args: ['0'] },
        { t: 10, type: 'dep', args: ['rwy1', 'east', 'b738'] },
        { t: 40, type: 'dep', args: ['rwy1', 'east', 'a320'] },
        { t: 70, type: 'arr', args: ['090', 'ZUUU-E', 'b738', '10000', '5000', '250'] },
        { t: 110, type: 'dep', args: ['rwy1', 'seat', 'a321'] },
        { t: 160, type: 'arr', args: ['135', 'ZUUU-SE', 'a320', '11000', '6000', '260'] },
        { t: 220, type: 'dep', args: ['rwy1', 'seat', 'b739'] },
        { t: 300, type: 'arr', args: ['225', 'ZUUU-SW', 'a320', '11000', '6000', '260'] },
        { t: 360, type: 'text', args: ['解锁分达到 5：02R 开放，可分流落地'] },
        { t: 380, type: 'arr', args: ['270', 'ZUUU-W', 'b738', '12000', '6000', '270'] },
        { t: 460, type: 'dep', args: ['rwy1', 'east', 'a320'] },
        { t: 540, type: 'arr', args: ['090', 'ZUUU-E', 'b738', '11000', '5000', '250'] },
        { t: 600, type: 'score', args: ['5'] },
        { t: 660, type: 'dep', args: ['rwy2', 'east', 'a320'] }
    ],
    objectives: [
        { kind: 'NO_SEPARATION_BREACH', weight: 30 },
        { kind: 'MIN_LANDINGS', value: 6, weight: 25 },
        { kind: 'NO_MVA_BREACH', weight: 15 },
        { kind: 'AVG_DELAY_MAX', value: 180, weight: 15 },
        { kind: 'GO_AROUND_MAX', value: 1, weight: 5 },
        { kind: 'NO_READBACK_MISSED', weight: 10 }
    ]
};


/**
 * L3 · 逆风换向（反向跑道 20R/20L + 拟真难度，复诵严格）
 * 教学目标：在逆风构型（rev）下运行，习惯反向跑道号与更严格的复诵要求。
 */
export const SCENARIO_L3 = {
    v: 3,
    id: 'l3-reverse-wind',
    name: 'L3 逆风换向 · ZUUU 20R/20L',
    brief: '逆风 200°/12kt：反向跑道 20R/20L（rev 构型），拟真难度下复诵不完整会被扣分。',
    airport: 'ZUUU',
    difficulty: 'realistic',
    seed: 20261009,
    config: { wind: { dir: 200, spd: 12 } },
    finish: { count: 5, timeLimit: 1800 },
    runwayPairs: ['02L/20R', '02R/20L'],
    runwayIdents: { rwy1: '02L', rwy2: '02R' },
    configurations: oneConfig([
        rwyEntry(0, 'rwy1', 'landstartrev'),      // rev → 使用反向端 20R
        rwyEntry(0, 'rwy2', 'landstartrev')       // rev → 使用反向端 20L
    ]),
    entrypoints: [
        { heading: 200, beacon: 'ZUUU-200', altM: null },
        { heading: 245, beacon: 'ZUUU-245', altM: null },
        { heading: 155, beacon: 'ZUUU-155', altM: null }
    ],
    airlineTable: [
        { code: 'cca', amount: 2, types: ['b738'], direction: '' },
        { code: 'csc', amount: 2, types: ['a320', 'a321'], direction: '' },
        { code: 'csn', amount: 2, types: ['b738', 'a320'], direction: '' },
        { code: 'chh', amount: 1, types: ['b738'], direction: '' }
    ],
    timeline: [
        { t: 0, type: 'text', args: ['L3 逆风换向：跑道 20R/20L（反向运行）'] },
        { t: 0, type: 'wind', args: ['200', '12'] },
        { t: 0, type: 'score', args: ['0'] },
        { t: 20, type: 'arr', args: ['200', 'ZUUU-200', 'b738', '10000', '5000', '250'] },
        { t: 60, type: 'dep', args: ['rwy1', 'west', 'a320'] },
        { t: 120, type: 'arr', args: ['245', 'ZUUU-245', 'a320', '11000', '6000', '260'] },
        { t: 200, type: 'text', args: ['复诵严格：漏项未纠正将被扣分'] },
        { t: 240, type: 'arr', args: ['155', 'ZUUU-155', 'a321', '11000', '6000', '260'] },
        { t: 300, type: 'dep', args: ['rwy2', 'west', 'b738'] },
        { t: 380, type: 'arr', args: ['200', 'ZUUU-200', 'b738', '12000', '6000', '270'] },
        { t: 480, type: 'dep', args: ['rwy1', 'west', 'b738'] }
    ],
    objectives: [
        { kind: 'NO_SEPARATION_BREACH', weight: 30 },
        { kind: 'MIN_LANDINGS', value: 5, weight: 25 },
        { kind: 'NO_MVA_BREACH', weight: 15 },
        { kind: 'NO_READBACK_MISSED', weight: 20 },
        { kind: 'GO_AROUND_MAX', value: 1, weight: 10 }
    ]
};

/** 内置关卡清单（顺序即难度顺序） */
export const BUILTIN_SCENARIOS = [SCENARIO_L1, SCENARIO_L2, SCENARIO_L3];

/** 按 id 取内置关卡（未命中返回 null） */
export function getBuiltinScenario(id) {
    if (!id) return null;
    return BUILTIN_SCENARIOS.find(s => s.id === id) || null;
}

/** 关卡清单摘要（关卡下拉与冒烟断言用） */
export function scenarioList() {
    return BUILTIN_SCENARIOS.map(s => ({
        id: s.id,
        name: s.name,
        brief: s.brief,
        airport: s.airport,
        difficulty: s.difficulty,
        events: s.timeline.length,
        objectives: (s.objectives || []).length
    }));
}
