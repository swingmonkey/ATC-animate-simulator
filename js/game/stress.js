/**
 * game/stress.js — 管制员压力与咖啡冷静期（游戏层·v2.0 空管嘉年华）
 *
 * 玩法钩子（参考《我是航空管制官》的处置压力 + 主题医院的荒诞道具）：
 *   · 出错涨压力：间隔不足 +10 / 低于 MVA +8 / 复飞 +5 / 复诵未纠正 +5 / 落地延误 +2
 *   · 落地回落 −6，班次中每模拟秒自然回落 0.25
 *   · 压力 ≥40「紧张」：领班开始劝咖啡；≥75「手抖」：雷达屏抖动（render/effects.js 读取）
 *   · ☕ 喝咖啡：−30 压力，60 模拟秒冷却（工具栏按钮，含整活播报）
 *
 * 压力只影响「表现与画面」，不改判定与评分（红线），peak 供结算评语取用。
 * 依赖方向：core(0) + 同层 game(3)；不碰 DOM。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';

const MAX_STRESS = 100;
const CALM_LIMIT = 40;          // 紧张阈值
const FRIED_LIMIT = 75;         // 手抖阈值
const COFFEE_CD_SEC = 60;       // 咖啡冷却（模拟秒）
const COFFEE_RELIEF = 30;       // 一杯咖啡降压
const NAG_INTERVAL_SEC = 25;    // 领班劝咖啡间隔

const ledger = {
    stress: 0,
    peak: 0,
    coffeeReadyAt: 0,
    lastNagAt: -Infinity,
    lastEmitLevel: 'calm',
    level: 'calm'
};

function levelOf(stress) {
    if (stress >= FRIED_LIMIT) return 'fried';
    if (stress >= CALM_LIMIT) return 'tense';
    return 'calm';
}

/** 增加压力并广播变化（同步 level / peak / 领班台词） */
export function addStress(amount, reason) {
    if (!Number.isFinite(amount) || amount === 0) return ledger.stress;
    const before = levelOf(ledger.stress);
    ledger.stress = Math.max(0, Math.min(MAX_STRESS, Math.round(ledger.stress + amount)));
    ledger.peak = Math.max(ledger.peak, ledger.stress);
    const after = levelOf(ledger.stress);
    const changed = after !== before;
    if (changed || Math.abs(amount) >= 5) emitStress(reason, changed ? after : null);
    ledger.lastEmitLevel = after;
    ledger.level = after;
    return ledger.stress;
}

function emitStress(reason, levelChange) {
    bus.emit(EV.STRESS_CHANGED, { stress: ledger.stress, level: ledger.level, reason, levelChange });
}

/** 事件 → 压力增减表 */
const STRESS_WEIGHTS = {
    SEPARATION_BREACH: 10,
    MVA_BREACH: 8,
    GO_AROUND: 5,
    READBACK_MISSED: 5,
    HANDOVER_MISSED: 4,
    DELAY: 2,
    REST_IGNORED: 6,
    LANDED: -6
};

bus.on(EV.SCORE_CHANGED, ({ event } = {}) => {
    if (!event) return;
    const weight = STRESS_WEIGHTS[event.kind];
    if (weight === undefined) return;
    if (weight < 0) {
        // 落地冷静：只在仍有压力时回落，避免无意义广播
        if (ledger.stress <= 0) return;
        ledger.stress = Math.max(0, ledger.stress + weight);
        ledger.level = levelOf(ledger.stress);
        ledger.lastEmitLevel = ledger.level;
        emitStress('LANDED');
        return;
    }
    addStress(weight, event.kind);
});

/** 每模拟秒：自然回落 + 领班劝咖啡（跨阈值时广播，供 HUD 换色） */
bus.on(EV.CLOCK_TICK, () => {
    if (!state.isPlaying) return;
    const prevLevel = ledger.level;
    if (ledger.stress > 0) {
        ledger.stress = Math.max(0, Math.round((ledger.stress - 0.25) * 100) / 100);
        const newLevel = levelOf(ledger.stress);
        ledger.level = newLevel;
        if (newLevel !== prevLevel) emitStress('decay', newLevel);
    }
    const now = state.time;
    if (ledger.stress >= CALM_LIMIT && now - ledger.lastNagAt >= NAG_INTERVAL_SEC) {
        ledger.lastNagAt = now;
        const line = ledger.stress >= FRIED_LIMIT
            ? '领班：「你脸色比雷达还绿，立刻停一手，咖啡在右边工具栏！」'
            : '领班：「看你眼皮打架了，要不要来杯咖啡冷静一下？」';
        addComm('acc', line);
    }
});

/** 开班清零（上局峰值已被结算面板读取） */
bus.on(EV.SESSION_STARTED, () => resetStress());

/**
 * ☕ 喝咖啡：−30 压力，冷却内不可续杯。
 * @returns {{ok:boolean, stress:number, cooldownLeft:number, message:string}}
 */
export function drinkCoffee() {
    const cooldownLeft = Math.max(0, Math.ceil(ledger.coffeeReadyAt - state.time));
    if (cooldownLeft > 0) {
        return { ok: false, stress: ledger.stress, cooldownLeft, message: `咖啡见底了，${cooldownLeft}s 后才能续杯` };
    }
    const before = ledger.stress;
    ledger.coffeeReadyAt = state.time + COFFEE_CD_SEC;
    ledger.stress = Math.max(0, ledger.stress - COFFEE_RELIEF);
    ledger.level = levelOf(ledger.stress);
    ledger.lastEmitLevel = ledger.level;
    const lines = [
        '你灌下一杯咖啡，手不抖了，就是心跳有点自己的想法。',
        '续杯成功。隔壁领班投来赞许的目光。',
        '咖啡因入体，雷达上的飞机忽然看起来亲切了许多。'
    ];
    const message = before >= FRIED_LIMIT ? lines[0] : (before >= CALM_LIMIT ? lines[1] : lines[2]);
    addComm('atc', `☕ ${message}`);
    emitStress('coffee');
    return { ok: true, stress: ledger.stress, cooldownLeft: COFFEE_CD_SEC, message };
}

/** 重置（开班次时）；peak 跨班保留到结算读取后清零 */
export function resetStress({ keepPeak = false } = {}) {
    ledger.stress = 0;
    ledger.level = 'calm';
    ledger.lastEmitLevel = 'calm';
    ledger.coffeeReadyAt = 0;
    ledger.lastNagAt = -Infinity;
    if (!keepPeak) ledger.peak = 0;
}

/** 压力快照（HUD / 结算 / 冒烟共用；peak 跨本班保留，开班时清零） */
export function stressSummary() {
    const cooldownLeft = Math.max(0, Math.ceil(ledger.coffeeReadyAt - state.time));
    return {
        stress: ledger.stress,
        peak: ledger.peak,
        level: ledger.level,
        levelLabel: ledger.level === 'fried' ? '手抖' : ledger.level === 'tense' ? '紧张' : '淡定',
        coffeeCooldownLeft: cooldownLeft,
        coffeeReady: cooldownLeft <= 0,
        calmLimit: CALM_LIMIT,
        friedLimit: FRIED_LIMIT
    };
}
