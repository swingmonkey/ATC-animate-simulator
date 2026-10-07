/**
 * data/logFields.js — 管制工作日志字段表（数据层·只读常量）
 *
 * 对齐 CCAR-93TM-R6 §62–§63（文档 docs/CCAR-93TM-ALIGNMENT.md §10.1）：
 * 规章要求管制工作日志至少包含 9 项，本模块把「九项日志」数据化为字段表。
 *
 * 设计原则（§10.1）：
 *   · 日志字段「只增不改」——字段一旦定义即长期稳定，供复盘聚合与断言比对；
 *   · 「每一项都能指回一个事件名」——日志缺项 == 事件没发，属可在冒烟测试里断言的问题。
 *
 * 合规边界（§69 / §10.3）：本表只描述「本机存档」的结构，不涉及任何采集 / 上传 / 对外提供；
 * 模块本身不做任何 I/O、不引入任何网络调用。
 *
 * 依赖方向：数据层（1）叶子模块，无 import、无副作用。
 */

/**
 * §63 九项工作日志字段表。
 * @type {ReadonlyArray<{id:string,index:number,title:string,events:string[],source:string}>}
 */
export const LOG_FIELDS = Object.freeze([
    {
        id: 'seatOpenLog',
        index: 1,
        title: '席位开放与关闭',
        events: ['seat:opened', 'seat:closed'],
        source: '席位开合决策事件（§3.3 席位门槛）'
    },
    {
        id: 'staffLog',
        index: 2,
        title: '岗位人员工作及准备',
        events: ['duty:started', 'position:entered', 'duty:prep_done'],
        source: '上岗 / 就座 / 岗前准备完成（§4）'
    },
    {
        id: 'dutyLog',
        index: 3,
        title: '值班时间与交接班',
        events: [
            'duty:started', 'duty:ended', 'duty:overflow',
            'position:entered', 'position:left',
            'rest:entered', 'rest:left',
            'handover:familiarize', 'handover:checklist'
        ],
        source: '值班三段计时 + 岗位交接班检查单（§4.3 / §8）'
    },
    {
        id: 'equipmentLog',
        index: 4,
        title: '管制设备',
        events: ['equipment:degraded', 'equipment:failed', 'equipment:restored'],
        source: '设备三态变化（含 §9 设备失效事件）'
    },
    {
        id: 'navLog',
        index: 5,
        title: '机场与导航设备',
        events: ['runway:opened', 'runway:closed', 'runway:condition', 'navaid:status'],
        source: '跑道 / 导航台状态事件（§7.5）'
    },
    {
        id: 'weatherLog',
        index: 6,
        title: '天气影响',
        events: ['weather:changed', 'runway:condition'],
        source: '天气事件 + 跑道状况变化（§7.5）'
    },
    {
        id: 'serviceLog',
        index: 7,
        title: '提供服务基本情况',
        events: ['movement:landed', 'movement:departed', 'separation:breach', 'goaround', 'delay'],
        source: '架次 / 间隔 / 复飞 / 延误统计（活动统计口径）'
    },
    {
        id: 'safetyLog',
        index: 8,
        title: '不安全与搜寻援救事件',
        events: ['conflict:alert', 'runway:incursion', 'emergency:declared', 'emergency:resolved'],
        source: '冲突告警 / 跑道侵入 / 应急事件（§9）'
    },
    {
        id: 'violationLog',
        index: 9,
        title: '违反规章与运行手册的情况',
        events: ['score:deduction', 'REST_IGNORED', 'PRIORITY_VIOLATION', 'HANDOVER_MISSED', 'NOT_FIT_FOR_DUTY'],
        source: '评分系统已有扣分项 + REST_IGNORED 等违规记录'
    }
]);

/** §63 九项必需字段的 id 清单（顺序即规章条目顺序，用于加载期自校验）。 */
export const REQUIRED_LOG_FIELDS = Object.freeze([
    'seatOpenLog',
    'staffLog',
    'dutyLog',
    'equipmentLog',
    'navLog',
    'weatherLog',
    'serviceLog',
    'safetyLog',
    'violationLog'
]);

/**
 * 校验日志字段表完整性（§10.4 验收 1 / 8）。
 * 缺任一必需字段、字段未绑定事件、id 重复或 index 越界均抛错。
 * @param {ReadonlyArray<object>} [fields]
 * @returns {true} 通过时返回 true
 */
export function validateLogFields(fields = LOG_FIELDS) {
    const list = Array.isArray(fields) ? fields : [];

    const missing = REQUIRED_LOG_FIELDS.filter(id => !list.some(f => f && f.id === id));
    if (missing.length) {
        throw new Error(`[logFields] 缺少必需的日志字段：${missing.join(', ')}`);
    }

    const noEvents = list.filter(f => !Array.isArray(f.events) || f.events.length === 0).map(f => f.id);
    if (noEvents.length) {
        throw new Error(`[logFields] 字段未绑定任何事件名：${noEvents.join(', ')}`);
    }

    const ids = list.map(f => f.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) {
        throw new Error(`[logFields] 字段 id 重复：${[...new Set(dup)].join(', ')}`);
    }

    const badIndex = list
        .filter(f => !Number.isInteger(f.index) || f.index < 1 || f.index > REQUIRED_LOG_FIELDS.length)
        .map(f => f.id);
    if (badIndex.length) {
        throw new Error(`[logFields] 字段 index 越界或非整数：${badIndex.join(', ')}`);
    }

    const noTitle = list.filter(f => !f.title).map(f => f.id);
    if (noTitle.length) {
        throw new Error(`[logFields] 字段缺少中文标题：${noTitle.join(', ')}`);
    }

    return true;
}

/* 加载期自校验：九项缺一即在此报错（§10.4 验收 8：缺字段在加载期报错）。 */
validateLogFields();