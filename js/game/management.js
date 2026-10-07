/**
 * game/management.js — 空管单位经营状态流转（游戏层）
 *
 * 经营层「世界怎么变」的唯一入口：把 domain/management.js 的纯规则 + data/management.js
 * 的常量，落成对 state.management 的显式变更，并通过 eventBus 广播，由 ui/subscriptions.js
 * 统一刷新面板与 HUD（与现场层同一「动作 → 事件 → 订阅」三段式）。
 *
 * 与现场层的关系：
 *   · 现场层（game/session.js）产出班次评级/绩效分 → endDay() 读取 sessionResult() 参与日结算；
 *   · 经营层推导的席位规划复用 domain/seats.planSeats()，与 §47-§51 门槛同一口径。
 *
 * 依赖方向：core(0) + data/domain(1-2) + 同层 session(3)；不碰 DOM。
 */

import { state } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import {
    MANAGEMENT, STAFF_ROLES, STAFF_ROLE_ORDER, STAFF_NAMES,
    ROOM_TYPES, ROOM_ORDER, TECH_LEVELS,
    UPGRADES, UPGRADE_ORDER, CONTRACT_TEMPLATES, CONTRACT_ORDER, TRIAL_STATUS
} from '../data/management.js';
import {
    createManagementState, normalizeManagementState,
    hasRoom, hasContract, hireFeeOf, totalAnnualMovements,
    availableSeatsOf, missingSeatsOf, sectorPlanOf, dailyProjectionOf,
    canHire, canAppoint, canBuild, canTrain, canAssign,
    canUpgrade, canSignContract, canRequestTrial, computeDaySettlement
} from '../domain/management.js';
import { sessionResult } from './session.js';

const round2 = v => Math.round((Number(v) || 0) * 100) / 100;
const clampReputation = v => Math.max(
    MANAGEMENT.reputationMin,
    Math.min(MANAGEMENT.reputationMax, Number(v) || 0)
);

function requireState() {
    if (!state.management) return { ok: false, reason: '经营状态未初始化（先调用 startManagement）' };
    return null;
}

/** 确定性 id 生成：扫描既有 id 的数值后缀取 max+1，避免导入旧档后重号 */
function nextStaffId(m) {
    let max = 0;
    for (const s of m.staff) {
        const hit = /^stf-(\d+)$/.exec(s.id || '');
        if (hit) max = Math.max(max, Number(hit[1]));
    }
    return `stf-${max + 1}`;
}

/* ---------------- 生命周期 ---------------- */

/**
 * 初始化 / 恢复经营状态。main.js 启动时在 loadState() 之后调用一次。
 * @param {{reset?:boolean}} [opts] reset=true 时丢弃旧档重开
 */
export function startManagement(opts = {}) {
    if (opts.reset) {
        state.management = createManagementState();
    } else if (!state.management) {
        state.management = createManagementState();
    } else {
        state.management = normalizeManagementState(state.management);
    }
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return state.management;
}

/** 重开经营（清空人员/房间/合同，回到起始预算） */
export function resetManagement() {
    state.management = createManagementState();
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return state.management;
}

/* ---------------- 人事 ---------------- */

/** 招聘一名员工（见习 / 管制员 / 主管）。扣招聘费 = N 个月薪资。 */
export function hireStaff(roleId) {
    const guard = requireState();
    if (guard) return guard;
    const m = state.management;
    const chk = canHire(m, roleId);
    if (!chk.ok) return chk;

    const role = STAFF_ROLES[roleId];
    const fee = hireFeeOf(roleId);
    m.cash = round2(m.cash - fee);

    const staff = {
        id: nextStaffId(m),
        name: STAFF_NAMES[m.staff.length % STAFF_NAMES.length],
        role: roleId,
        salary: role.salary,
        trainingLeft: 0,
        seat: null,
        fatigue: 0,
        hiredDay: m.day
    };
    m.staff.push(staff);

    bus.emit(EV.STAFF_CHANGED, { action: 'hire', staff: { ...staff } });
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return { ok: true, staff, cost: fee, reason: `已招聘${role.name}（招聘费 ${fee} 元）` };
}

/** 任命管制员为管制主管（提升管理水平 + 声望）。 */
export function appointSupervisor(staffId) {
    const guard = requireState();
    if (guard) return guard;
    const m = state.management;
    const chk = canAppoint(m, staffId);
    if (!chk.ok) return chk;

    const staff = m.staff.find(s => s.id === staffId);
    m.cash = round2(m.cash - MANAGEMENT.appointmentFee);
    staff.role = 'supervisor';
    staff.salary = STAFF_ROLES.supervisor.salary;
    m.reputation = clampReputation(m.reputation + MANAGEMENT.reputationOnSupervisor);

    bus.emit(EV.STAFF_CHANGED, { action: 'appoint', staff: { ...staff } });
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return { ok: true, staff, reason: `已任命 ${staff.name} 为管制主管` };
}

/** 安排见习管制员进入培训（费用按日结算，不一次性扣除）。 */
export function trainStaff(staffId) {
    const guard = requireState();
    if (guard) return guard;
    const m = state.management;
    const chk = canTrain(m, staffId);
    if (!chk.ok) return chk;

    const staff = m.staff.find(s => s.id === staffId);
    staff.trainingLeft = MANAGEMENT.trainingDays;

    bus.emit(EV.STAFF_CHANGED, { action: 'train', staff: { ...staff } });
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return { ok: true, staff, days: MANAGEMENT.trainingDays, reason: `已开始 ${MANAGEMENT.trainingDays} 天培训` };
}

/* ---------------- 设施与技术 ---------------- */

/** 建设一间设施（塔台 / 进近 / 区域 / 培训室 / 休息室 / 设备机房）。 */
export function buildRoom(typeId) {
    const guard = requireState();
    if (guard) return guard;
    const m = state.management;
    const chk = canBuild(m, typeId);
    if (!chk.ok) return chk;

    const type = ROOM_TYPES[typeId];
    m.cash = round2(m.cash - type.cost);
    const room = { id: `room-${typeId}`, type: typeId, name: type.name, cost: type.cost, builtDay: m.day };
    m.rooms.push(room);

    bus.emit(EV.ROOM_CHANGED, { action: 'build', room: { ...room } });
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return { ok: true, room, cost: type.cost, reason: `已建成${type.name}（${type.cost} 元）` };
}

/** 技术 / 设备升级：程序管制 → 监视管制、ILS Ⅱ 类、独立平行进近。 */
export function upgradeTech(upgradeId) {
    const guard = requireState();
    if (guard) return guard;
    const m = state.management;
    const chk = canUpgrade(m, upgradeId);
    if (!chk.ok) return chk;

    const up = UPGRADES[upgradeId];
    m.cash = round2(m.cash - up.cost);
    m[up.field] = up.to;

    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return { ok: true, upgrade: up, cost: up.cost, reason: `已升级：${up.name}` };
}

/* ---------------- 席位 ---------------- */

/** 席位安排：seatCode 传 null/空 表示解除该员工的席位。 */
export function assignSeat(staffId, seatCode = null) {
    const guard = requireState();
    if (guard) return guard;
    const m = state.management;
    const chk = canAssign(m, staffId, seatCode);
    if (!chk.ok) return chk;

    const staff = m.staff.find(s => s.id === staffId);
    for (const [seat, id] of Object.entries(m.seats)) {
        if (id === staffId) delete m.seats[seat];
    }
    staff.seat = null;
    if (seatCode) {
        m.seats[seatCode] = staffId;
        staff.seat = seatCode;
    }

    bus.emit(EV.STAFF_CHANGED, { action: 'assign', staff: { ...staff }, seat: seatCode });
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return { ok: true, staff, seat: seatCode, reason: seatCode ? `已安排 ${seatCode} 席位` : '已解除席位安排' };
}

/* ---------------- 合同与局方 ---------------- */

/** 承接航班合同（签约奖励入账 + 声望 + 年架次计入席位规划）。 */
export function signContract(templateId) {
    const guard = requireState();
    if (guard) return guard;
    const m = state.management;
    const chk = canSignContract(m, templateId);
    if (!chk.ok) return chk;

    const tpl = CONTRACT_TEMPLATES[templateId];
    const contract = {
        id: `contract-${templateId}`,
        templateId,
        name: tpl.name,
        annualMovements: tpl.annualMovements,
        revenuePerMovement: tpl.revenuePerMovement,
        signedDay: m.day
    };
    m.contracts.push(contract);
    if (tpl.signBonus) m.cash = round2(m.cash + tpl.signBonus);
    m.reputation = clampReputation(m.reputation + MANAGEMENT.reputationOnContract);

    bus.emit(EV.CONTRACT_CHANGED, { action: 'sign', contract: { ...contract } });
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return { ok: true, contract, bonus: tpl.signBonus, reason: `已承接${tpl.name}` };
}

/** 向局方递交实验运行申请；批复在次日结束（endDay）时给出。 */
export function requestTrialRun() {
    const guard = requireState();
    if (guard) return guard;
    const m = state.management;
    const chk = canRequestTrial(m);
    if (!chk.ok) return chk;

    m.trial = {
        status: 'pending',
        appliedDay: m.day,
        decidedDay: null,
        expiresDay: null,
        note: '已递交实验运行申请，等待局方批复'
    };

    bus.emit(EV.TRIAL_CHANGED, { action: 'request', trial: { ...m.trial } });
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return { ok: true, trial: m.trial, reason: '已向局方递交实验运行申请' };
}

/* ---------------- 日结算 ---------------- */

/** 局方批复：pending → approved / rejected，并结算声望与有效期 */
function applyTrialDecision(m, settlement) {
    if (settlement.trialDecision === 'approved') {
        m.trial.status = 'approved';
        m.trial.decidedDay = m.day;
        m.trial.expiresDay = m.day + MANAGEMENT.trialDurationDays;
        m.trial.note = `局方批复：实验运行获批（有效期 ${MANAGEMENT.trialDurationDays} 天）`;
        m.reputation = clampReputation(m.reputation + MANAGEMENT.reputationOnTrialApproved);
        bus.emit(EV.TRIAL_CHANGED, { action: 'approved', trial: { ...m.trial } });
    } else if (settlement.trialDecision === 'rejected') {
        m.trial.status = 'rejected';
        m.trial.decidedDay = m.day;
        m.trial.expiresDay = null;
        m.trial.note = '局方不予批复（声望未达标），提升声望后可重新申请';
        bus.emit(EV.TRIAL_CHANGED, { action: 'rejected', trial: { ...m.trial } });
    }
}

/** 疲劳：值守席位者按忽略休息次数累积，未值守者每日恢复 1 点。 */
function applyFatigue(m, restIgnored) {
    const seated = new Set(Object.values(m.seats));
    for (const staff of m.staff) {
        if (seated.has(staff.id)) staff.fatigue = Math.min(10, staff.fatigue + Math.max(1, restIgnored));
        else staff.fatigue = Math.max(0, staff.fatigue - 1);
    }
}

/**
 * 结束今日经营：读班次结果 → 日结算 → 现金/声望/培训/疲劳/合同流量增长/实验运行批复 → 推进日期。
 * @param {{}} [opts]
 * @returns {{ok:boolean, day?:number, nextDay?:number, settlement?:object, graduated?:object[]}}
 */
export function endDay(opts = {}) {
    const guard = requireState();
    if (guard) return guard;
    const m = state.management;

    const result = sessionResult();
    const usable = !!(result && result.sessionId && result.sessionId !== m.lastSettledSessionId);
    const settlementOpts = usable
        ? { score: result.score, grade: result.grade, restIgnored: result.counts ? result.counts.restIgnored : 0 }
        : {};

    const settlement = computeDaySettlement(m, settlementOpts);
    const settledDay = m.day;

    /* 资金 / 声望 */
    m.cash = round2(m.cash + settlement.net);
    m.reputation = clampReputation(m.reputation + settlement.reputationDelta);

    /* 实验运行批复 */
    applyTrialDecision(m, settlement);

    /* 培训倒计时与转正 */
    const graduated = [];
    for (const staff of m.staff) {
        if (staff.trainingLeft > 0) {
            staff.trainingLeft -= 1;
            if (staff.trainingLeft === 0 && staff.role === 'trainee') {
                staff.role = 'controller';
                staff.salary = STAFF_ROLES.controller.salary;
                graduated.push({ id: staff.id, name: staff.name });
            }
        }
    }

    /* 疲劳 */
    applyFatigue(m, settlement.restIgnored);

    /* 合同流量自然增长（流量增长驱动「提前招聘 / 划扇区」的经营压力） */
    const growth = 1 + MANAGEMENT.trafficGrowthPerDay;
    for (const c of m.contracts) {
        c.annualMovements = Math.max(0, Math.round(c.annualMovements * growth));
    }

    /* 推进日期 */
    m.day += 1;

    /* 实验运行许可到期 */
    if (m.trial.status === 'approved' && m.trial.expiresDay !== null && m.day >= m.trial.expiresDay) {
        m.trial.status = 'none';
        m.trial.decidedDay = null;
        m.trial.expiresDay = null;
        m.trial.note = '实验运行许可已到期，可重新申请';
    }

    const entry = {
        day: settledDay,
        revenue: settlement.revenue,
        bonus: settlement.bonus,
        salary: settlement.salary,
        maintenance: settlement.maintenance,
        training: settlement.training,
        net: settlement.net,
        score: settlement.score,
        grade: settlement.grade,
        reputationDelta: settlement.reputationDelta,
        cash: m.cash,
        reputation: m.reputation,
        graduated: graduated.map(g => g.name)
    };
    m.history.push(entry);
    if (m.history.length > 120) m.history.splice(0, m.history.length - 120);

    if (usable) m.lastSettledSessionId = result.sessionId;
    m.lastSettlement = settlement;

    bus.emit(EV.DAY_SETTLED, { day: settledDay, nextDay: m.day, settlement, summary: managementSummary() });
    bus.emit(EV.MANAGEMENT_CHANGED);
    requestRedraw();
    return { ok: true, day: settledDay, nextDay: m.day, settlement, graduated };
}

/* ---------------- 只读汇总（面板 / HUD / 冒烟断言共用单一口径） ---------------- */

/** 经营总览快照。state.management 未初始化时返回 null。 */
export function managementSummary() {
    const m = state.management;
    if (!m) return null;

    const sectorPlan = sectorPlanOf(m);
    const availableSeats = availableSeatsOf(m);
    const missingSeats = missingSeatsOf(m);
    const proj = dailyProjectionOf(m);

    const staffCounts = { trainee: 0, controller: 0, supervisor: 0 };
    for (const s of m.staff) if (staffCounts[s.role] !== undefined) staffCounts[s.role]++;
    const roomCounts = {};
    for (const r of m.rooms) roomCounts[r.type] = (roomCounts[r.type] || 0) + 1;

    const trialCheck = canRequestTrial(m);

    return {
        day: m.day,
        cash: round2(m.cash),
        reputation: Math.round(m.reputation),
        tech: m.tech,
        techName: TECH_LEVELS[m.tech] ? TECH_LEVELS[m.tech].name : m.tech,
        ilsCat: m.ilsCat,
        parallelApproach: m.parallelApproach,

        staff: m.staff,
        staffCount: m.staff.length,
        staffCounts,
        trainingCount: m.staff.filter(s => s.trainingLeft > 0).length,

        rooms: m.rooms,
        roomCount: m.rooms.length,
        roomCounts,

        seats: { ...m.seats },
        sectorPlan,
        availableSeats,
        missingSeats,

        totalAnnualMovements: totalAnnualMovements(m),

        contracts: m.contracts,
        contractCount: m.contracts.length,
        contractAnnualMovements: totalAnnualMovements(m),

        daily: { revenue: proj.revenue, salary: proj.salary, maintenance: proj.maintenance, net: proj.net },

        hireOptions: STAFF_ROLE_ORDER.map(id => ({
            id, name: STAFF_ROLES[id].name, salary: STAFF_ROLES[id].salary, fee: hireFeeOf(id), ...canHire(m, id)
        })),
        buildOptions: ROOM_ORDER.map(id => ({
            id, name: ROOM_TYPES[id].name, cost: ROOM_TYPES[id].cost, brief: ROOM_TYPES[id].brief,
            built: hasRoom(m, id), ...canBuild(m, id)
        })),
        upgradeOptions: UPGRADE_ORDER.map(id => ({
            id, name: UPGRADES[id].name, cost: UPGRADES[id].cost, brief: UPGRADES[id].brief, ...canUpgrade(m, id)
        })),
        contractOptions: CONTRACT_ORDER.map(id => ({
            id, name: CONTRACT_TEMPLATES[id].name,
            annualMovements: CONTRACT_TEMPLATES[id].annualMovements,
            revenuePerMovement: CONTRACT_TEMPLATES[id].revenuePerMovement,
            minReputation: CONTRACT_TEMPLATES[id].minReputation,
            brief: CONTRACT_TEMPLATES[id].brief,
            signed: hasContract(m, id), ...canSignContract(m, id)
        })),

        trial: m.trial,
        trialStatusName: TRIAL_STATUS[m.trial.status] ? TRIAL_STATUS[m.trial.status].name : m.trial.status,
        canRequestTrial: trialCheck.ok,
        canRequestTrialReason: trialCheck.reason,

        lastSettlement: m.lastSettlement,
        history: m.history.slice(-10)
    };
}