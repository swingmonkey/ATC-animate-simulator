/**
 * data/events.js — 随机特情与经营事件（数据层·只读常量）
 *
 * M2 随机性全部由 seed 驱动（见 core/random.js），本文件只描述「有哪些事件、
 * 各档难度下的相对权重、对经营数值的确定性影响」，不含任何流程逻辑。
 *
 * 依赖方向：无（数据层叶子）。业务逻辑见 game/events.js。
 */

/** 事件系统调参（示意值，需试玩校验） */
export const EVENT_TUNING = Object.freeze({
    baseIntervalSec: 150,        // 基准事件间隔（标准难度）
    minGapSec: 45,               // 两次事件最短间隔
    firstDelaySec: 75,           // 班次开始后首次抽检延迟
    maxPerSession: 12,           // 单班次随机事件上限
    spawnThreshold: 1,           // 场上至少 N 架航空器才开始抽特情
    lowFuelDelaySec: 45,         // 低油量请求后未处置 → 升级紧急
    commFailureCheckSec: 30,     // 通讯失效周期性提醒间隔
    runwayClosureSec: 180,       // 跑道临时关闭时长
    stormDriftSec: 120           // 雷暴单元驻留时长
});

/**
 * 随机特情（docs/PLAN-v2.md §7.3 的 7 类落点 + 移交/相邻扇区事件 + v2.0 荒诞事件）。
 * weight 为相对权重；severity 用于 UI 提示等级；kind 决定 game/events.js 的执行分支。
 *
 * v2.0「空管嘉年华」：后 6 条为搞怪事件（参考主题医院式荒诞）——
 * 它们复用既有指令链路（改航向 / 调速 / 优先落地），不新造平行系统。
 */
export const EMERGENCY_EVENTS = Object.freeze([
    { id: 'windShift', kind: 'windShift', name: '风变 / 跑道反向', severity: 'warning', weight: 12, brief: '风向突变，需评估跑道反向运行' },
    { id: 'thunderstorm', kind: 'thunderstorm', name: '雷暴单元漂移', severity: 'warning', weight: 14, brief: '雷暴单元逼近，进离场需绕飞' },
    { id: 'runwayClosure', kind: 'runwayClosure', name: '跑道临时关闭', severity: 'danger', weight: 8, brief: '跑道临时关闭，进近须复飞或改航' },
    { id: 'medical', kind: 'medical', name: '机上医疗紧急', severity: 'danger', weight: 10, brief: '机上旅客急症，需优先落地' },
    { id: 'commsFailure', kind: 'commsFailure', name: '通讯失效', severity: 'danger', weight: 9, brief: '航空器失去双向通讯，按失效程序处置' },
    { id: 'unstableApproach', kind: 'unstableApproach', name: '进近不稳定', severity: 'warning', weight: 13, brief: '进近不稳定，管制员应令复飞' },
    { id: 'lowFuel', kind: 'lowFuel', name: '低油量请求直飞', severity: 'danger', weight: 7, brief: '航空器低油量，请求直飞优先落地' },
    { id: 'goAround', kind: 'goAround', name: '进近复飞', severity: 'warning', weight: 12, brief: '机组自行复飞，需重新排序进近' },
    { id: 'handoffTimeout', kind: 'handoffTimeout', name: '移交超时', severity: 'warning', weight: 10, brief: '邻区未接收移交，需协调或保持监视' },
    { id: 'neighborCall', kind: 'neighborCall', name: '相邻扇区来话', severity: 'info', weight: 11, brief: '相邻扇区通报流量，提示后续协调' },
    /* ---- v2.0 荒诞特情（主题医院式整活） ---- */
    { id: 'crabEscape', kind: 'crabEscape', name: '货舱螃蟹越狱', severity: 'warning', weight: 9, brief: '螃蟹占领驾驶舱门，机长请求保持平稳（严禁急转）' },
    { id: 'pandaUpgrade', kind: 'pandaUpgrade', name: '国宝要求升舱', severity: 'danger', weight: 7, brief: '机上大熊猫静坐抗议，请求优先落地' },
    { id: 'ufoSighting', kind: 'ufoSighting', name: '机长目击 UFO', severity: 'warning', weight: 8, brief: '机组正在拍照已偏离航向，需引导归航' },
    { id: 'spicySnack', kind: 'spicySnack', name: '辣条引发狂欢', severity: 'warning', weight: 8, brief: '全舱欢呼盖过发动机噪声，机长要求复述指令' },
    { id: 'grannyChoir', kind: 'grannyChoir', name: '大妈合唱团巡航演出', severity: 'info', weight: 7, brief: '合唱团开演出机长听得入迷，已偏离航向 15 度' },
    { id: 'snakeLoose', kind: 'snakeLoose', name: '蟒蛇逃进货舱夹层', severity: 'danger', weight: 6, brief: '蟒蛇出逃，地勤抄网待命，请求尽快落地' }
]);

/** 经营事件（日结算时按 seed 抽取；mods 为对次日经营数值的确定性影响） */
export const MANAGEMENT_EVENTS = Object.freeze([
    {
        id: 'equipmentFault', name: '设备故障', severity: 'warning', weight: 10,
        brief: '关键设备故障，维修支出与运行受限', cashDelta: -60000,
        mods: { revenueMult: 0.94, maintenanceMult: 1.25 }
    },
    {
        id: 'trafficSurge', name: '航班高峰', severity: 'info', weight: 12,
        brief: '次日航班高峰，收入提升但席位压力增大', cashDelta: 0,
        mods: { revenueMult: 1.12 }
    },
    {
        id: 'regulatoryAudit', name: '局方检查', severity: 'warning', weight: 9,
        brief: '局方例行检查通过，声望提升', cashDelta: 0,
        reputationDelta: 3, mods: {}
    },
    {
        id: 'staffIllness', name: '员工病假', severity: 'warning', weight: 8,
        brief: '一名管制员请病假，人手紧张', cashDelta: -12000,
        mods: { staffMod: -1 }
    },
    {
        id: 'equipmentGrant', name: '设备补贴', severity: 'info', weight: 7,
        brief: '上级设备补贴到账，维护支出下降', cashDelta: 80000,
        mods: { maintenanceMult: 0.85 }
    }
]);

/** 事件日志单条字段（持久化到 state.eventLog / state.management.eventLog） */
export const EVENT_LOG_FIELDS = Object.freeze([
    'id', 'scope', 'type', 'name', 'day', 't', 'severity', 'text', 'aircraft', 'meta'
]);
