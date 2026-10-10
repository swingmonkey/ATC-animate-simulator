/**
 * game/cargo.js — 奇葩货物分配与落地播报（游戏层）
 *
 * 每架航班按 flightNo 哈希确定性分配一件「荒诞货物」（见 data/cargo.js），
 * 不消耗随机源，因此同 seed 班次仍可复现（docs/PLAN-v2.md §3.1）。
 * 落地时向通话频道播报整活台词，并推一条 cargo:landed 事件
 * （render/effects.js 据此弹「货物送达」飘分）。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { cargoFor } from '../data/cargo.js';

/**
 * 给一架航班分配货物（幂等：已分配则原样返回）。
 * @param {{flightNo:string}} ac
 */
export function attachCargo(ac) {
    return ac ? cargoFor(ac) : null;
}

/** 读取一架航班的货物（未分配则先分配） */
export function cargoOf(ac) {
    return ac ? cargoFor(ac) : null;
}

/** 本班次已落地航班的货物清单（结算面板用） */
export function landedCargoList() {
    return state.aircraft
        .filter(ac => ac.landed && ac.cargo)
        .map(ac => ({ flightNo: ac.flightNo, cargo: ac.cargo }));
}

/* 落地播报：既写通话历史（游戏层职责），也发事件给画面反馈 */
bus.on(EV.SCORE_CHANGED, ({ event } = {}) => {
    if (!event || event.kind !== 'LANDED') return;
    const callsign = event.detail?.callsign;
    const ac = state.aircraft.find(item => item.flightNo === callsign);
    const cargo = ac ? cargoOf(ac) : null;
    if (!ac || !cargo) return;
    addComm('atc', `${ac.flightNo} 落地，货舱舱门打开：${cargo.line}。`);
    bus.emit(EV.CARGO_LANDED, { flightNo: ac.flightNo, cargo });
});
