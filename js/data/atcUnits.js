/**
 * data/atcUnits.js — 管制席位与管制区数据（数据层·叶子模块）
 *
 * 借鉴 openScope 的「席位（position）/扇区（sector）」组织方式：
 * 一个席位负责一定水平范围内的航空器，跨界时执行移交（handoff）。
 * 本模拟器简化为三级席位，由内到外为 塔台 → 进近 → 区调：
 *   TWR 塔台管制：机场半径 15km 以内，负责起飞/落地许可、跑道占用
 *   APP 进近管制：终端区 60km 以内，负责进近许可（ILS/RNAV/VOR/目视）、下高度调速
 *   ACC 区域管制：其余空域，负责巡航阶段的高度/航路
 * 水平范围（scopeKm）为示意值，可在此集中调整。
 */

import { getAirport, airportFrequency } from './airports.js';

export const ATC_UNITS = {
    ACC: {
        code: 'ACC', name: '区域管制', short: '区调', en: 'Center',
        freq: '126.85', scopeKm: Infinity, color: '#7c3aed', altitudeLimit: 15000,
        duty: '巡航高度、航路与跨区移交'
    },
    APP: {
        code: 'APP', name: '进近管制', short: '进近', en: 'Approach',
        freq: '119.25', scopeKm: 60, color: '#0369a1', altitudeLimit: 6000,
        duty: '进近许可、雷达引导与下高度调速'
    },
    TWR: {
        code: 'TWR', name: '塔台管制', short: '塔台', en: 'Tower',
        freq: '118.35', scopeKm: 15, color: '#b45309', altitudeLimit: 900,
        duty: '起飞/落地许可、跑道与复飞'
    }
};

/** 由内到外的席位顺序（塔台 → 进近 → 区调） */
export const UNIT_ORDER = ['TWR', 'APP', 'ACC'];

/** 进近方式（openScope 的 approach clearance 类型） */
export const APPROACH_TYPES = {
    ILS: { code: 'ILS', label: 'ILS 盲降', en: 'ILS', keywords: ['ils', '盲降', '仪表着陆'] },
    RNAV: { code: 'RNAV', label: 'RNAV 进近', en: 'RNAV', keywords: ['rnav', 'rnp', '区域导航'] },
    VOR: { code: 'VOR', label: 'VOR/DME 进近', en: 'VOR', keywords: ['vor', 'vor/dme'] },
    VISUAL: { code: 'VISUAL', label: '目视进近', en: 'Visual', keywords: ['目视', 'visual'] }
};

const APPROACH_ALIASES = [
    ['VISUAL', ['目视', 'visual']],
    ['VOR', ['vor/dme', 'vor']],
    ['RNAV', ['rnav', 'rnp']],
    ['ILS', ['ils', '盲降', '仪表着陆']]
];

/** 席位对象（未知代码回退区调，避免调用方到处判空） */
export function unit(code) {
    return ATC_UNITS[code] || ATC_UNITS.ACC;
}

/** "进近（APP）" 形式的中文+代码标签 */
export function unitLabel(code) {
    const u = unit(code);
    return `${u.name}（${u.code}）`;
}

/** 席位频率：塔台/进近优先取该机场频率，取不到再用席位默认频率 */
export function unitFrequency(code, airportCode) {
    const u = unit(code);
    if (airportCode && (code === 'TWR' || code === 'APP')) {
        const f = airportFrequency(airportCode, code === 'TWR' ? 'twr' : 'app');
        if (f) return f;
    }
    return u.freq;
}

/**
 * 下一管制席位（移交目标）。
 * @param {string} code 当前席位代码
 * @param {string} phase 'arrival' 进港（由外到内）/ 'departure' 离港（由内到外）
 * @returns {string|null} 无下一席位时返回 null（已到最内/最外）
 */
export function nextUnit(code, phase = 'arrival') {
    if (phase === 'overflight') return null;
    const chain = phase === 'departure' ? ['TWR', 'APP', 'ACC'] : ['ACC', 'APP', 'TWR'];
    const idx = chain.indexOf(code);
    if (idx < 0 || idx >= chain.length - 1) return null;
    return chain[idx + 1];
}

/** 上一管制席位（用于显示「由 ×× 移交」） */
export function prevUnit(code, phase = 'arrival') {
    if (phase === 'overflight') return null;
    const chain = phase === 'departure' ? ['TWR', 'APP', 'ACC'] : ['ACC', 'APP', 'TWR'];
    const idx = chain.indexOf(code);
    if (idx <= 0) return null;
    return chain[idx - 1];
}

/** 中文/英文关键词 → 席位代码（解析「移交塔台 / contact approach」类指令） */
export function unitFromText(text) {
    const t = String(text || '').toLowerCase();
    if (/塔台|tower|twr/.test(t)) return 'TWR';
    if (/进近|approach|app\b/.test(t)) return 'APP';
    if (/区调|区域|center|centre|acc\b/.test(t)) return 'ACC';
    return null;
}

/** 关键词 → 进近方式代码（未命中返回 null） */
export function approachFromText(text) {
    const t = String(text || '').toLowerCase();
    for (const [code, words] of APPROACH_ALIASES) {
        if (words.some(w => t.includes(w))) return code;
    }
    return null;
}

/** 进近方式标签（未指派显示「未指派」） */
export function approachLabel(code) {
    return code && APPROACH_TYPES[code] ? APPROACH_TYPES[code].label : '未指派';
}

/** 机场名称（无数据回退代码） */
export function airportLabel(code) {
    const a = getAirport(code);
    return a ? `${a.name}(${code})` : (code || '--');
}
