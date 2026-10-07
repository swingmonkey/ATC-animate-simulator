/**
 * data/handoverChecklist.js — 岗位交接班检查单（数据层）
 *
 * 对齐 CCAR-93TM-R6 §60 与 WORKPLACE §5.4：7 项逐项确认，
 * 项名 / 来源 / 权重 / 漏项后果全部数据化，供值班面板与讲评复用。
 */

export const FAMILIARIZE_SEC = 60;

export const HANDOVER_CHECKLIST = Object.freeze([
    {
        id: 'sector',
        index: 1,
        title: '扇区态势',
        source: '当前在管航班数与分布',
        weight: 1,
        consequence: 'HANDOVER_MISSED −2'
    },
    {
        id: 'active',
        index: 2,
        title: '活动航班',
        source: '已发进近许可 / 已进跑道 / 五边上的航班',
        weight: 1.5,
        consequence: 'HANDOVER_MISSED −2（权重 ×1.5）'
    },
    {
        id: 'sequence',
        index: 3,
        title: '等待/排序',
        source: '等待航线、排序序列、复飞航班',
        weight: 1,
        consequence: 'HANDOVER_MISSED −2'
    },
    {
        id: 'flow',
        index: 4,
        title: '流控与限制',
        source: '通报板上的流控、高度限制、临时空域',
        weight: 1,
        consequence: 'HANDOVER_MISSED −2'
    },
    {
        id: 'weather',
        index: 5,
        title: '天气与跑道',
        source: '风、跑道构型、正在切换的跑道',
        weight: 1,
        consequence: 'HANDOVER_MISSED −2'
    },
    {
        id: 'emergency',
        index: 6,
        title: '特情',
        source: '未处置完的特情与已采取的处置',
        weight: 2,
        consequence: 'HANDOVER_MISSED −4（权重 ×2）'
    },
    {
        id: 'equipment',
        index: 7,
        title: '设备状态',
        source: '雷达/通信/进程单系统是否降级',
        weight: 1,
        consequence: 'HANDOVER_MISSED −2'
    }
]);

export const HANDOVER_CHECKLIST_IDS = Object.freeze(HANDOVER_CHECKLIST.map(item => item.id));
