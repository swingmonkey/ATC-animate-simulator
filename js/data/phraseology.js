/**
 * data/phraseology.js — 管制用语模板（数据层·叶子模块）
 *
 * 指令台 2.0（ui/console.js）按「选中飞机 + 当前席位/阶段」从本表挑选模板：
 *   · `issue` 决定合法性判定（domain/phases.js 的 canIssue / issueHint）→ 非法项灰显并给出原因
 *   · `scope` 限定推荐席位（塔台/进近/区调），不在该席位时仍可下发但不推荐
 *   · `text` 为用语模板，占位符由 fillPhrase() 填充：{cs} 呼号、{rwy} 跑道、{fix} 航路点
 *
 * 用语风格：中文为主（`可以落地`），英文同义可识别（见 commands/parser.js），
 * 与 docs/PLAN-v2.md §7.4 一致。
 */

/** 占位符默认值（取不到上下文时的兜底，保证模板永远可下发） */
export const PHRASE_FALLBACK = { cs: '', rwy: '18', fix: '本场' };

/**
 * 用语模板表。
 * group 用于界面分组显示；order 决定组内顺序。
 */
export const PHRASEOLOGY = [
    /* 高度 */
    { id: 'alt-up600', group: '高度', order: 1, label: '↑ +600', issue: 'ALT', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 上升 600' },
    { id: 'alt-down600', group: '高度', order: 2, label: '↓ -600', issue: 'ALT', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 下降 600' },
    { id: 'alt-hold', group: '高度', order: 3, label: '保持高度', issue: 'ALT', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 保持高度' },
    /* 航向 / 引导 */
    { id: 'hdg-left20', group: '引导', order: 1, label: '左转 20', issue: 'HDG', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 左转 20' },
    { id: 'hdg-right20', group: '引导', order: 2, label: '右转 20', issue: 'HDG', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 右转 20' },
    { id: 'hdg-direct', group: '引导', order: 3, label: '直飞', issue: 'DIRECT', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 直飞 {fix}' },
    { id: 'hdg-hold', group: '引导', order: 4, label: '盘旋', issue: 'HOLD', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 盘旋' },
    /* 速度 */
    { id: 'spd-slow', group: '速度', order: 1, label: '减速', issue: 'SPD', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 减速' },
    { id: 'spd-fast', group: '速度', order: 2, label: '加速', issue: 'SPD', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 加速' },
    { id: 'spd-250', group: '速度', order: 3, label: '250kt', issue: 'SPD', scope: ['ACC', 'APP', 'TWR'], text: '{cs} 速度 250' },
    /* 进近与许可 */
    { id: 'app-ils', group: '许可', order: 1, label: 'ILS 进近', issue: 'APPROACH', scope: ['APP', 'TWR'], text: '{cs} ILS 进近 跑道 {rwy}' },
    { id: 'app-visual', group: '许可', order: 2, label: '目视进近', issue: 'APPROACH', scope: ['APP', 'TWR'], text: '{cs} 目视进近 跑道 {rwy}' },
    { id: 'app-rwy', group: '许可', order: 3, label: '指派跑道', issue: 'EXPECT_RWY', scope: ['APP', 'TWR'], text: '{cs} 跑道 {rwy}' },
    { id: 'app-land', group: '许可', order: 4, label: '可以落地', issue: 'LAND', scope: ['TWR'], text: '{cs} 可以落地 跑道 {rwy}' },
    { id: 'app-takeoff', group: '许可', order: 5, label: '可以起飞', issue: 'TAKEOFF', scope: ['TWR'], text: '{cs} 可以起飞' },
    { id: 'app-goaround', group: '许可', order: 6, label: '复飞', issue: 'GOAROUND', scope: ['TWR', 'APP'], text: '{cs} 复飞' },
    /* 移交 */
    { id: 'ho-twr', group: '移交', order: 1, label: '移交塔台', issue: 'HANDOFF', scope: ['APP', 'ACC'], text: '{cs} 移交塔台' },
    { id: 'ho-app', group: '移交', order: 2, label: '联系进近', issue: 'HANDOFF', scope: ['ACC', 'TWR'], text: '{cs} 联系进近' },
    { id: 'ho-acc', group: '移交', order: 3, label: '联系区调', issue: 'HANDOFF', scope: ['APP', 'TWR'], text: '{cs} 联系区调' }
];

/** 组顺序（界面按此顺序渲染分组） */
export const PHRASE_GROUPS = ['许可', '高度', '引导', '速度', '移交'];

/** 填充模板占位符（缺失值用 PHRASE_FALLBACK 兜底） */
export function fillPhrase(template, ctx = {}) {
    return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
        const v = ctx[key];
        return (v === undefined || v === null || v === '') ? String(PHRASE_FALLBACK[key] ?? '') : String(v);
    }).replace(/\s+/g, ' ').trim();
}

/**
 * 取某席位可用的模板（未登记 scope 的一律可用），按组顺序排序。
 * @param {string} unitCode 'TWR' | 'APP' | 'ACC'
 */
export function phrasesForUnit(unitCode) {
    const code = unitCode || 'ACC';
    return PHRASEOLOGY
        .filter(p => !p.scope || p.scope.includes(code))
        .slice()
        .sort((a, b) => {
            const ga = PHRASE_GROUPS.indexOf(a.group), gb = PHRASE_GROUPS.indexOf(b.group);
            return (ga - gb) || (a.order - b.order);
        });
}
