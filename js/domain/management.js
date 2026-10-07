/**
 * domain/management.js — 空管单位经营规则（领域层·纯函数）
 *
 * 只在「只读输入 + 返回结果」之间做推导，不修改 state、不碰 DOM、不广播事件：
 *   · 费用与日结算公式（收入 / 薪资 / 维护 / 培训 / 绩效奖励 / 声望）
 *   · 经营动作的前置条件（可否招聘 / 建造 / 培训 / 任命 / 排席 / 升级 / 签约 / 申请）
 *   · 扇区与席位推导：直接复用 domain/seats.planSeats()，与现场层保持同一门槛口径
 *
 * 依赖方向：data(1) + 同层 seats(2)；可被 game(3) / ui(5) 引用。
 */

import {
    MANAGEMENT, REPUTATION_BY_GRADE, STAFF_ROLES, ROOM_TYPES,
    UPGRADES, CONTRACT_TEMPLATES
} from '../data/management.js';
import { planSeats } from './seats.js';

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = v => Math.round(num(v) * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 房间 → 可提供席位（null / 缺失 = 不提供管制席位） */
export const ROOM_SEATS = Object.freeze({
    tower: ['TWR', 'GND', 'CD', 'SUP', 'APP'],
    approach: ['APP', 'APP-ARR', 'APP-DEP', 'NTZ'],
    area: ['ACC', 'ACC-RDR']
});

/** 经营状态初始值（与存档格式一致；所有字段可 JSON 序列化） */
export function createManagementState() {
    return {
        day: MANAGEMENT.startDay,
        cash: MANAGEMENT.startCash,
        reputation: MANAGEMENT.startReputation,
        tech: 'procedural',
        ilsCat: 1,
        parallelApproach: 'none',
        staff: [],
        rooms: [],
        seats: {},
        contracts: [],
        trial: { status: 'none', appliedDay: null, decidedDay: null, expiresDay: null, note: '' },
        lastSettledSessionId: null,
        lastSettlement: null,
        history: []
    };
}

/** 把任意存档片段补齐为完整经营状态（旧档 / 手工写入均可安全恢复） */
export function normalizeManagementState(raw) {
    const base = createManagementState();
    if (!raw || typeof raw !== 'object') return base;

    const m = { ...base, ...raw };
    m.day = Math.max(1, Math.floor(num(m.day) || base.day));
    m.cash = num(m.cash);
    m.reputation = clamp(num(m.reputation), MANAGEMENT.reputationMin, MANAGEMENT.reputationMax);
    m.tech = m.tech === 'surveillance' ? 'surveillance' : 'procedural';
    m.ilsCat = num(m.ilsCat) === 2 ? 2 : 1;
    m.parallelApproach = m.parallelApproach === 'independent' ? 'independent' : 'none';

    m.staff = Array.isArray(raw.staff) ? raw.staff.map(s => ({
        id: s.id,
        name: String(s.name || '未命名'),
        role: STAFF_ROLES[s.role] ? s.role : 'trainee',
        salary: num(s.salary) || STAFF_ROLES[s.role]?.salary || STAFF_ROLES.trainee.salary,
        trainingLeft: Math.max(0, Math.floor(num(s.trainingLeft))),
        seat: s.seat || null,
        fatigue: Math.max(0, Math.floor(num(s.fatigue))),
        hiredDay: Math.max(1, Math.floor(num(s.hiredDay) || 1))
    })) : [];

    m.rooms = Array.isArray(raw.rooms) ? raw.rooms.map(r => ({
        id: r.id,
        type: ROOM_TYPES[r.type] ? r.type : 'training',
        name: ROOM_TYPES[r.type]?.name || String(r.name || '设施'),
        cost: num(r.cost),
        builtDay: Math.max(1, Math.floor(num(r.builtDay) || 1))
    })) : [];

    m.seats = raw.seats && typeof raw.seats === 'object' ? { ...raw.seats } : {};
    m.contracts = Array.isArray(raw.contracts) ? raw.contracts.map(c => ({
        id: c.id,
        templateId: CONTRACT_TEMPLATES[c.templateId] ? c.templateId : 'regional',
        name: CONTRACT_TEMPLATES[c.templateId]?.name || String(c.name || '航班合同'),
        annualMovements: Math.max(0, Math.round(num(c.annualMovements))),
        revenuePerMovement: Math.max(0, num(c.revenuePerMovement)),
        signedDay: Math.max(1, Math.floor(num(c.signedDay) || 1))
    })) : [];

    m.trial = {
        status: ['none', 'pending', 'approved', 'rejected'].includes(raw.trial?.status) ? raw.trial.status : 'none',
        appliedDay: raw.trial?.appliedDay ?? null,
        decidedDay: raw.trial?.decidedDay ?? null,
        expiresDay: raw.trial?.expiresDay ?? null,
        note: String(raw.trial?.note || '')
    };

    m.history = Array.isArray(raw.history) ? raw.history.slice(-120) : [];
    m.lastSettledSessionId = raw.lastSettledSessionId ?? null;
    m.lastSettlement = raw.lastSettlement && typeof raw.lastSettlement === 'object' ? raw.lastSettlement : null;
    return m;
}

export function hasRoom(m, typeId) {
    return (m?.rooms || []).some(r => r.type === typeId);
}

export function hasContract(m, templateId) {
    return (m?.contracts || []).some(c => c.templateId === templateId);
}

export function hireFeeOf(roleId) {
    const role = STAFF_ROLES[roleId] || STAFF_ROLES.trainee;
    return Math.round(role.salary * MANAGEMENT.hireFeeMonths);
}

export function totalAnnualMovements(m) {
    return Math.round((m?.contracts || []).reduce((sum, c) => sum + num(c.annualMovements), 0));
}

/** 每日合同收入 = Σ(年架次 × 单架次收入 / 365) */
export function dailyRevenueOf(m) {
    return round2((m?.contracts || []).reduce(
        (sum, c) => sum + num(c.annualMovements) * num(c.revenuePerMovement) / 365, 0));
}

/** 每日薪资 = Σ(月薪 / 30) */
export function dailySalaryCostOf(m) {
    return round2((m?.staff || []).reduce((sum, s) => sum + num(s.salary) / MANAGEMENT.daysPerMonth, 0));
}

/** 每日维护 = 房间数 × maintenancePerDay */
export function dailyMaintenanceCostOf(m) {
    return round2((m?.rooms || []).length * MANAGEMENT.maintenancePerDay);
}

/** 今日经营预测（不含班次绩效奖励与一次性支出） */
export function dailyProjectionOf(m) {
    const revenue = dailyRevenueOf(m);
    const salary = dailySalaryCostOf(m);
    const maintenance = dailyMaintenanceCostOf(m);
    return { revenue, salary, maintenance, net: round2(revenue - salary - maintenance) };
}

/** 按当前合同流量、设备与环境推导应设扇区/席位（§47-§51 同口径） */
export function sectorPlanOf(m) {
    return planSeats({
        annualMovements: totalAnnualMovements(m),
        ilsCat: num(m?.ilsCat) || 1,
        airspaceComplex: false,
        parallelApproach: m?.parallelApproach || 'none',
        radarControl: m?.tech === 'surveillance'
    });
}

/** 已建设施能够真实提供的席位（规划 ∩ 设施） */
export function availableSeatsOf(m) {
    const plan = sectorPlanOf(m);
    const provided = new Set();
    for (const room of m?.rooms || []) {
        for (const seat of ROOM_SEATS[room.type] || []) provided.add(seat);
    }
    return [...plan.tower, ...plan.approach, ...plan.area].filter(seat => provided.has(seat));
}

/** 规划需要、但尚未建设施导致开不出的席位（UI 用「缺设施」提示） */
export function missingSeatsOf(m) {
    const plan = sectorPlanOf(m);
    const available = new Set(availableSeatsOf(m));
    return [...plan.tower, ...plan.approach, ...plan.area].filter(seat => !available.has(seat));
}

export function canHire(m, roleId) {
    const role = STAFF_ROLES[roleId];
    if (!role) return { ok: false, reason: '未知职级' };
    const fee = hireFeeOf(roleId);
    if (num(m?.cash) < fee) return { ok: false, reason: `资金不足（需 ${fee} 元）` };
    return { ok: true, reason: `可招聘${role.name}（招聘费 ${fee} 元）` };
}

export function canAppoint(m, staffId) {
    const staff = (m?.staff || []).find(s => s.id === staffId);
    if (!staff) return { ok: false, reason: '员工不存在' };
    if (staff.role !== 'controller') return { ok: false, reason: '只有管制员可以任命为管制主管' };
    if (num(m.cash) < MANAGEMENT.appointmentFee) return { ok: false, reason: `资金不足（任命费 ${MANAGEMENT.appointmentFee} 元）` };
    return { ok: true, reason: '可任命为管制主管（提升管理水平）' };
}

export function canBuild(m, typeId) {
    const type = ROOM_TYPES[typeId];
    if (!type) return { ok: false, reason: '未知设施' };
    if (hasRoom(m, typeId)) return { ok: false, reason: `${type.name}已建成` };
    if (num(m?.cash) < type.cost) return { ok: false, reason: `资金不足（需 ${type.cost} 元）` };
    return { ok: true, reason: `可建设${type.name}` };
}

export function canTrain(m, staffId) {
    const staff = (m?.staff || []).find(s => s.id === staffId);
    if (!staff) return { ok: false, reason: '员工不存在' };
    if (staff.role !== 'trainee') return { ok: false, reason: '只有见习管制员需要培训' };
    if (staff.trainingLeft > 0) return { ok: false, reason: `正在培训（剩余 ${staff.trainingLeft} 天）` };
    if (!hasRoom(m, 'training')) return { ok: false, reason: '需要先建设培训室' };
    const total = MANAGEMENT.trainingCostPerDay * MANAGEMENT.trainingDays;
    if (num(m.cash) < total) return { ok: false, reason: `资金不足（全程培训费 ${total} 元）` };
    return { ok: true, reason: `可开始 ${MANAGEMENT.trainingDays} 天培训` };
}

export function canAssign(m, staffId, seatCode) {
    const staff = (m?.staff || []).find(s => s.id === staffId);
    if (!staff) return { ok: false, reason: '员工不存在' };
    if (!seatCode) return { ok: true, reason: '解除席位安排' };
    const role = STAFF_ROLES[staff.role];
    if (!role?.canControl) return { ok: false, reason: '见习管制员不能独立值守席位' };
    const available = availableSeatsOf(m);
    if (!available.includes(seatCode)) return { ok: false, reason: `席位 ${seatCode} 未开放（需先满足流量门槛并建设对应现场）` };
    const holder = Object.entries(m?.seats || {}).find(([seat, id]) => seat === seatCode && id !== staffId);
    if (holder) return { ok: false, reason: `席位 ${seatCode} 已由其他管制员值守` };
    return { ok: true, reason: `可安排 ${seatCode}` };
}

export function canUpgrade(m, upgradeId) {
    const up = UPGRADES[upgradeId];
    if (!up) return { ok: false, reason: '未知升级项' };
    for (const room of up.requires || []) {
        if (!hasRoom(m, room)) return { ok: false, reason: `需要先建设${ROOM_TYPES[room]?.name || room}` };
    }
    if (m?.[up.field] !== up.from) return { ok: false, reason: `${up.name} 当前状态不满足升级条件` };
    if (num(m?.cash) < up.cost) return { ok: false, reason: `资金不足（需 ${up.cost} 元）` };
    return { ok: true, reason: `可升级：${up.name}` };
}

export function canSignContract(m, templateId) {
    const tpl = CONTRACT_TEMPLATES[templateId];
    if (!tpl) return { ok: false, reason: '未知合同' };
    if (hasContract(m, templateId)) return { ok: false, reason: `${tpl.name}已承接` };
    if (num(m?.reputation) < tpl.minReputation) {
        return { ok: false, reason: `声望不足（需 ${tpl.minReputation}，当前 ${Math.round(num(m?.reputation))}）` };
    }
    return { ok: true, reason: `可承接${tpl.name}（年 ${tpl.annualMovements} 架次）` };
}

export function canRequestTrial(m) {
    const status = m?.trial?.status || 'none';
    if (status === 'pending') return { ok: false, reason: '实验运行申请已递交，等待局方批复' };
    if (status === 'approved') return { ok: false, reason: '实验运行许可仍在有效期内' };
    if (num(m?.reputation) < MANAGEMENT.trialReputationMin) {
        return { ok: false, reason: `声望不足（需 ${MANAGEMENT.trialReputationMin}）` };
    }
    if (m?.tech !== 'surveillance') return { ok: false, reason: '需先将程序管制升级为监视管制' };
    if (!hasRoom(m, 'equipment')) return { ok: false, reason: '需要先建设设备机房' };
    return { ok: true, reason: '可向局方递交实验运行申请' };
}

/**
 * 日结算纯推导。
 * @param {object} m 经营状态（只读）
 * @param {{score?:number|null,grade?:string|null,restIgnored?:number}} [opts]
 */
export function computeDaySettlement(m, opts = {}) {
    const revenue = dailyRevenueOf(m);
    const salary = dailySalaryCostOf(m);
    const maintenance = dailyMaintenanceCostOf(m);
    const trainingCount = (m?.staff || []).filter(s => s.trainingLeft > 0).length;
    const training = round2(trainingCount * MANAGEMENT.trainingCostPerDay);
    const rawScore = opts.score;
    const score = (rawScore === null || rawScore === undefined || !Number.isFinite(Number(rawScore)))
        ? null : Number(rawScore);
    const bonus = score === null ? 0 : Math.max(0, Math.round(score * MANAGEMENT.performanceBonusPerScore));
    const grade = opts.grade || null;
    const reputationDelta = grade && REPUTATION_BY_GRADE[grade] !== undefined ? REPUTATION_BY_GRADE[grade] : 0;
    const net = round2(revenue + bonus - salary - maintenance - training);

    const trialDecision = m?.trial?.status === 'pending'
        ? (num(m.reputation) + reputationDelta >= MANAGEMENT.trialReputationMin ? 'approved' : 'rejected')
        : null;

    return {
        day: Math.max(1, Math.floor(num(m?.day) || 1)),
        revenue,
        bonus,
        salary,
        maintenance,
        training,
        trainingCount,
        net,
        score,
        grade,
        reputationDelta,
        restIgnored: Math.max(0, Math.floor(num(opts.restIgnored))),
        trialDecision
    };
}