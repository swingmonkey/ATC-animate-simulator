/**
 * weather/weather.js — 天气层控制器
 * 管理天气开关、风暴生成、风场（由噪声梯度合成）与危险采样。
 */

import { state } from '../core/store.js';
import { posX, posY } from '../core/accessors.js';
import { octave } from './perlin.js';
import { generateStorm, sampleStorm, isStormDangerousAt, STORM_LEVELS } from './stormRadar.js';

export { STORM_LEVELS, sampleStorm, isStormDangerousAt };

/** 生成新一轮天气（风暴场），存入 state.storm */
export function generateWeather(intensity = 0.55) {
    state.storm = generateStorm(1400, 1400, 25, 0.006, intensity);
    return state.storm;
}

export function setWeatherEnabled(on) {
    state.weatherEnabled = !!on;
    if (on && !state.storm) generateWeather();
}

export function toggleWeather() {
    setWeatherEnabled(!state.weatherEnabled);
    return state.weatherEnabled;
}

/** 风场：由相邻噪声差合成风矢量，返回 {hdg, spd}（kt） */
export function windAt(x, y, scale = 0.01) {
    const eps = 8;
    const nL = octave((x - eps) * scale, y * scale, 3);
    const nR = octave((x + eps) * scale, y * scale, 3);
    const nU = octave(x * scale, (y - eps) * scale, 3);
    const nD = octave(x * scale, (y + eps) * scale, 3);
    const dx = nR - nL;
    const dy = nD - nU;
    const spd = Math.min(60, Math.sqrt(dx * dx + dy * dy) * 400);
    let hdg = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (hdg < 0) hdg += 360;
    return { hdg: Math.round(hdg), spd: Math.round(spd) };
}

/** 飞机当前位置是否处于危险天气 */
export function aircraftInWeatherDanger(ac) {
    if (!state.weatherEnabled || !state.storm) return false;
    return isStormDangerousAt(state.storm, posX(ac), posY(ac));
}
