/**
 * core/clock.js — 模拟时钟（内核层）
 *
 * 推进 state.time 的唯一入口：由 main.js 的 rAF 循环每帧调用 tickClock(frameDt)，
 * 内部按固定逻辑步长累积步进（与渲染帧率解耦，保证重放一致），
 * 每模拟秒依次发出业务时钟事件。只有沙盒播放使用时间上限回卷。
 * 时钟不判断业务状态（是否播放/是否游戏模式由调用方决定是否 tick）。
 */

import { state } from './store.js';
import { bus, EV } from './eventBus.js';

/** 逻辑步长（秒） */
export const FIXED_DT = 1 / 60;
/** 单帧最大逻辑步数（安全阀：极端卡顿时不长时间阻塞，1 秒真实时间最多 600 步 = 10 模拟秒） */
const MAX_STEPS_PER_TICK = 600;

/** 时钟统计（调试与冒烟测试可读） */
export const clockStats = { ticks: 0, steps: 0, lastDt: 0 };

let accumulator = 0;
let nextBusinessTick = 1;
let stepsSinceBusinessTick = 0;

/**
 * 推进时钟。
 * @param {number} frameDt 真实帧间隔（秒，调用方已裁剪上限）
 * @returns {{stepped:boolean, steps:number, dt:number}} 是否发生步进、步数、本次推进的模拟秒数
 */
export function tickClock(frameDt) {
    clockStats.ticks++;
    clockStats.lastDt = frameDt;
    accumulator += frameDt * state.timeSpeed;

    let steps = 0;
    while (accumulator + 1e-9 >= FIXED_DT && steps < MAX_STEPS_PER_TICK) {
        state.time += FIXED_DT;
        accumulator -= FIXED_DT;
        if (!state.gameSessionActive && state.time > state.defaults.timeMax) {
            state.time = 0;
            accumulator = 0;
            nextBusinessTick = 1;
            stepsSinceBusinessTick = 0;
        }
        steps++;
        stepsSinceBusinessTick++;
        if (state.time + 1e-9 >= nextBusinessTick) {
            state.time = nextBusinessTick;
            const businessSteps = stepsSinceBusinessTick;
            stepsSinceBusinessTick = 0;
            nextBusinessTick++;
            bus.emit(EV.CLOCK_TICK, { time: state.time, steps: businessSteps, dt: businessSteps * FIXED_DT });
            if (!state.isPlaying) {
                accumulator = 0;
                break;
            }
        }
    }
    if (steps >= MAX_STEPS_PER_TICK) accumulator = 0;

    if (steps > 0) {
        clockStats.steps += steps;
    }
    return { stepped: steps > 0, steps, dt: steps * FIXED_DT };
}

/**
 * 清空累积器。暂停、加载场景、拖动时间轴/回放跳转后必须调用，
 * 否则下一帧会为“过去的真实时间”补步，造成位置跳变。
 */
export function resetClockAccumulator() {
    accumulator = 0;
    nextBusinessTick = Math.floor(state.time + 1e-9) + 1;
    stepsSinceBusinessTick = 0;
}

/** 当前累积器余量（秒，测试用） */
export function clockAccumulator() {
    return accumulator;
}
