/**
 * data/management.js — 经营管理参数（数据层·只读常量）
 *
 * 本文件承载「经营层」（单位怎么活）的全部可调数值：资金 / 人员 / 房间 / 设备 / 合同 /
 * 扇区 / 局方审批。经营层的席位规划不再另起一套，而是直接复用
 * domain/seats.js 的 planSeats()（与现场层 §47-§51 同一口径）。
 *
 * 所有数值均为示意值，可按试玩调参；业务逻辑不得硬编码。
 */

export const MANAGEMENT = Object.freeze({
    startDay: 1,
    startCash: 5000000,             // 起始预算（元）
    startReputation: 50,            // 起始声望（0-100）
    reputationMin: 0,
    reputationMax: 100,
    daysPerMonth: 30,               // 月薪 → 日薪换算
    trafficGrowthPerDay: 0.005,     // 日流量自然增长率（需试玩校验）
    maintenancePerDay: 2000,        // 每间房每日运维支出
    hireFeeMonths: 1,               // 招聘费 = N 个月薪资
    appointmentFee: 60000,          // 任命主管的任命费
    trainingCostPerDay: 20000,      // 每人每日培训费
    trainingDays: 3,                // 见习 → 管制员所需培训日
    reputationOnSupervisor: 2,      // 任命主管的声望收益
    reputationOnContract: 5,        // 签约的声望收益
    reputationOnTrialApproved: 8,   // 实验运行获批的声望收益
    trialReputationMin: 55,         // 申请实验运行的声望门槛
    trialDurationDays: 14,          // 实验运行有效期
    performanceBonusPerScore: 200,  // 班次绩效奖励系数（绩效分 × 系数，元）
    sectorMaxSeats: 4,              // 单个扇区最多承载席位数
    sectorMinControllers: 2         // 单个扇区最少管制员数
});

/** 班次评级 → 日结算声望增减（无班次结果时按 0 处理） */
export const REPUTATION_BY_GRADE = Object.freeze({ S: 6, A: 4, B: 1, C: -2, D: -5 });

/** 人员职级：见习 → 管制员 → 管制主管；salary 为月薪（元） */
export const STAFF_ROLES = Object.freeze({
    trainee: { id: 'trainee', name: '见习管制员', salary: 8000, canControl: false, rank: 0 },
    controller: { id: 'controller', name: '管制员', salary: 15000, canControl: true, rank: 1 },
    supervisor: { id: 'supervisor', name: '管制主管', salary: 26000, canControl: true, rank: 2 }
});

export const STAFF_ROLE_ORDER = ['trainee', 'controller', 'supervisor'];

/** 人员姓名池（无输入时按序分配，避免重名） */
export const STAFF_NAMES = [
    '陈靖', '李航', '王雪松', '赵一鸣', '周岚', '孙泽宇', '吴桐', '郑文博',
    '刘思远', '黄若楠', '徐若海', '马思齐'
];

/** 房间 / 现场：provides 为对应的管制席位族（null = 支撑设施） */
export const ROOM_TYPES = Object.freeze({
    tower: { id: 'tower', name: '塔台现场', cost: 800000, buildDays: 2, provides: 'TWR', brief: '提供 TWR / GND / CD 席位' },
    approach: { id: 'approach', name: '进近现场', cost: 600000, buildDays: 2, provides: 'APP', brief: '提供 APP / APP-W / APP-E / APP-ARR / APP-DEP / NTZ 席位' },
    area: { id: 'area', name: '区域现场', cost: 1200000, buildDays: 3, provides: 'ACC', brief: '提供 ACC / ACC-N / ACC-S / ACC-RDR 席位' },
    training: { id: 'training', name: '培训室', cost: 400000, buildDays: 1, provides: null, brief: '开展见习管制员培训（每人每日培训费）' },
    rest: { id: 'rest', name: '休息室', cost: 300000, buildDays: 1, provides: null, brief: '岗位轮换与疲劳恢复（§123-§128）' },
    equipment: { id: 'equipment', name: '设备机房', cost: 500000, buildDays: 1, provides: null, brief: '技术升级的前置设施（监视管制 / ILS Ⅱ 类 / 平行进近）' }
});

export const ROOM_ORDER = ['tower', 'approach', 'area', 'training', 'rest', 'equipment'];

/** 管制技术等级（程序管制 → 监视管制） */
export const TECH_LEVELS = Object.freeze({
    procedural: { id: 'procedural', name: '程序管制', level: 0, brief: '按报告点与时限间隔放行（§51 基线）' },
    surveillance: { id: 'surveillance', name: '监视管制', level: 1, brief: '雷达 / ADS-B 监视，ACC 增开雷达管制席（§51）' }
});

export const TECH_ORDER = ['procedural', 'surveillance'];

/** 可购买的升级项：field 指向 state.management 上的落点 */
export const UPGRADES = Object.freeze({
    surveillance: {
        id: 'surveillance', name: '程序管制 → 监视管制', cost: 900000,
        requires: ['equipment'], field: 'tech', from: 'procedural', to: 'surveillance',
        brief: '接入监视数据，ACC 增开雷达管制席（§51）'
    },
    ils2: {
        id: 'ils2', name: 'ILS 升级到 Ⅱ 类', cost: 600000,
        requires: ['equipment'], field: 'ilsCat', from: 1, to: 2,
        brief: '低能见度运行；须开放 GND 席（§47）'
    },
    parallel: {
        id: 'parallel', name: '独立平行进近', cost: 750000,
        requires: ['equipment', 'approach'], field: 'parallelApproach', from: 'none', to: 'independent',
        brief: '双跑道独立平行进近；须设 NTZ 监控席（§49）'
    }
});

export const UPGRADE_ORDER = ['surveillance', 'ils2', 'parallel'];

/** 航班合同模板：annualMovements 决定 domain/seats.js 的席位门槛与日收入 */
export const CONTRACT_TEMPLATES = Object.freeze({
    regional: { id: 'regional', name: '区域支线包', annualMovements: 20000, revenuePerMovement: 260, signBonus: 0, minReputation: 0, brief: '省内支线，架次平稳' },
    trunk: { id: 'trunk', name: '干线航班包', annualMovements: 60000, revenuePerMovement: 320, signBonus: 200000, minReputation: 40, brief: '干线航班，架次密集，签约有奖励' },
    hub: { id: 'hub', name: '枢纽中转包', annualMovements: 110000, revenuePerMovement: 360, signBonus: 500000, minReputation: 70, brief: '枢纽中转，架次最高，须先扩席位与技术' }
});

export const CONTRACT_ORDER = ['regional', 'trunk', 'hub'];

/** 局方（民航局 / 地区管理局）实验运行审批状态 */
export const TRIAL_STATUS = Object.freeze({
    none: { id: 'none', name: '未申请' },
    pending: { id: 'pending', name: '已递交（待局方批复）' },
    approved: { id: 'approved', name: '实验运行许可（已批复）' },
    rejected: { id: 'rejected', name: '不予批复' }
});