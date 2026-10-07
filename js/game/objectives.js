/**
 * game/objectives.js — 班次目标与达成评估（游戏层·纯函数）
 *
 * 目标由场景包给出（`scenario.objectives`），缺省时用本模块的默认目标集。
 * 评估只读 game/scoring.js 的汇总与班次汇总（不读 state、不写任何状态），
 * 因此可直接单测与冒烟断言。
 */

/** 目标类型定义：label 显示名 / weight 权重（结算占分）/ value+unit 为数值型目标的默认阈值 */
export const OBJECTIVE_KINDS = {
    NO_SEPARATION_BREACH: { label: '零间隔不足', weight: 30, unit: '', describe: '任何时刻都不得出现低于隔离标准的配对' },
    MIN_LANDINGS: { label: '落地架数', weight: 25, value: 5, unit: '架', describe: '班次内至少落地指定架数的进港航班' },
    NO_MVA_BREACH: { label: '零最低高度违规', weight: 20, unit: '', describe: '不得把未获进近许可的进港航班降到最低高度区以下' },
    NO_READBACK_MISSED: { label: '无未纠正复诵', weight: 10, unit: '', describe: '机组复诵漏项须在宽限期内重新下发纠正' },
    AVG_DELAY_MAX: { label: '平均延误上限', weight: 15, value: 180, unit: 's', describe: '已落地航班的平均延误不得超过阈值' },
    GO_AROUND_MAX: { label: '复飞次数上限', weight: 10, value: 1, unit: '次', describe: '复飞次数不得超过阈值' },
    CONFIG_UNLOCKED: { label: '解锁更多跑道', weight: 10, unit: '', describe: '累积解锁分达到跑道构型门槛，开启更多跑道' }
};

/** 默认目标集（自由流量班次；关卡可在场景包中覆盖） */
export function defaultObjectives() {
    return [
        { kind: 'NO_SEPARATION_BREACH', weight: OBJECTIVE_KINDS.NO_SEPARATION_BREACH.weight },
        { kind: 'MIN_LANDINGS', value: 5, weight: OBJECTIVE_KINDS.MIN_LANDINGS.weight },
        { kind: 'NO_MVA_BREACH', weight: OBJECTIVE_KINDS.NO_MVA_BREACH.weight },
        { kind: 'AVG_DELAY_MAX', value: 180, weight: OBJECTIVE_KINDS.AVG_DELAY_MAX.weight },
        { kind: 'CONFIG_UNLOCKED', weight: OBJECTIVE_KINDS.CONFIG_UNLOCKED.weight }
    ];
}

/** 目标规范化（补 label/weight/阈值） */
export function normalizeObjective(obj) {
    const def = OBJECTIVE_KINDS[obj.kind] || { label: obj.kind, weight: 0, unit: '', describe: '' };
    return {
        kind: obj.kind,
        label: def.label,
        describe: def.describe,
        unit: def.unit,
        value: Number.isFinite(obj.value) ? obj.value : (def.value ?? null),
        weight: Number.isFinite(obj.weight) ? obj.weight : def.weight
    };
}

/**
 * 评估单个目标。
 * @param {object} objective 目标（normalizeObjective 之后）
 * @param {object} ctx { scoring: scoringSummary(), session: 班次汇总 }
 * @returns {{ok:boolean, actual:number|null, target:number|null}}
 */
export function evaluateObjective(objective, ctx) {
    const sc = ctx.scoring || {};
    const counts = sc.counts || {};
    switch (objective.kind) {
        case 'NO_SEPARATION_BREACH':
            return { ok: (counts.separation || 0) === 0, actual: counts.separation || 0, target: 0 };
        case 'NO_MVA_BREACH':
            return { ok: (counts.mva || 0) === 0, actual: counts.mva || 0, target: 0 };
        case 'NO_READBACK_MISSED':
            return { ok: (counts.readback || 0) === 0, actual: counts.readback || 0, target: 0 };
        case 'MIN_LANDINGS': {
            const target = objective.value ?? 5;
            return { ok: (sc.landed || 0) >= target, actual: sc.landed || 0, target };
        }
        case 'AVG_DELAY_MAX': {
            const target = objective.value ?? 180;
            return { ok: (sc.avgDelaySec || 0) <= target, actual: sc.avgDelaySec || 0, target };
        }
        case 'GO_AROUND_MAX': {
            const target = objective.value ?? 1;
            return { ok: (counts.goAround || 0) <= target, actual: counts.goAround || 0, target };
        }
        case 'CONFIG_UNLOCKED': {
            const runways = (sc.runway && sc.runway.land ? sc.runway.land.length : 0)
                + (sc.runway && sc.runway.start ? sc.runway.start.length : 0);
            return { ok: (sc.runwayChanges || 0) > 0 || runways > 2, actual: sc.runwayChanges || 0, target: 1 };
        }
        default:
            return { ok: true, actual: null, target: null };
    }
}

/**
 * 评估全部目标。
 * @param {Array} objectives 目标集
 * @param {{scoring:object, session:object}} ctx
 * @returns {{items:Array, passed:number, total:number, bonusScore:number}}
 */
export function evaluateObjectives(objectives, ctx) {
    const list = (objectives && objectives.length ? objectives : defaultObjectives()).map(normalizeObjective);
    const items = list.map(obj => {
        const r = evaluateObjective(obj, ctx);
        return {
            kind: obj.kind,
            label: obj.label,
            weight: obj.weight,
            unit: obj.unit,
            ok: r.ok,
            actual: r.actual,
            target: r.target
        };
    });
    const passed = items.filter(i => i.ok).length;
    return {
        items,
        passed,
        total: items.length,
        bonusScore: items.reduce((n, i) => n + (i.ok ? i.weight : 0), 0)
    };
}
