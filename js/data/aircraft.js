/**
 * data/aircraft.js — 机型数据表（数据层）
 * 参照参考项目的 aircraft_data：按机型定义类别、典型巡航速度/高度、升降率。
 * 纯数据 + 查询函数，无副作用。
 */

/** 机型类别 → 推导参数（升降率、默认高度区间） */
export const AIRCRAFT_CATEGORIES = {
    heavy:  { label: '重型机', vspeed: 1800, climbRate: 2200, descentRate: 1800 },
    large:  { label: '大型机', vspeed: 1500, climbRate: 1800, descentRate: 1500 },
    medium: { label: '中型机', vspeed: 1200, climbRate: 1500, descentRate: 1200 }
};

/** 机型字典：icao 代码 → 定义 */
export const AIRCRAFT = {
    B738: { icao: 'B738', name: '波音 737-800', category: 'medium', cruiseSpeed: 450, cruiseAlt: 10600, wake: 'M' },
    B739: { icao: 'B739', name: '波音 737-900', category: 'medium', cruiseSpeed: 450, cruiseAlt: 10600, wake: 'M' },
    B77W: { icao: 'B77W', name: '波音 777-300ER', category: 'heavy', cruiseSpeed: 490, cruiseAlt: 11000, wake: 'H' },
    B787: { icao: 'B787', name: '波音 787-9', category: 'heavy', cruiseSpeed: 485, cruiseAlt: 11000, wake: 'H' },
    A320: { icao: 'A320', name: '空客 A320', category: 'medium', cruiseSpeed: 450, cruiseAlt: 10200, wake: 'M' },
    A321: { icao: 'A321', name: '空客 A321', category: 'medium', cruiseSpeed: 450, cruiseAlt: 10200, wake: 'M' },
    A332: { icao: 'A332', name: '空客 A330-200', category: 'heavy', cruiseSpeed: 470, cruiseAlt: 11000, wake: 'H' },
    A359: { icao: 'A359', name: '空客 A350-900', category: 'heavy', cruiseSpeed: 485, cruiseAlt: 11500, wake: 'H' },
    A20N: { icao: 'A20N', name: '空客 A320neo', category: 'medium', cruiseSpeed: 455, cruiseAlt: 10400, wake: 'M' },
    E190: { icao: 'E190', name: 'Embraer E190', category: 'medium', cruiseSpeed: 430, cruiseAlt: 9800, wake: 'M' },
    C919: { icao: 'C919', name: '商飞 C919', category: 'medium', cruiseSpeed: 450, cruiseAlt: 10400, wake: 'M' },
    B752: { icao: 'B752', name: '波音 757-200', category: 'large', cruiseSpeed: 460, cruiseAlt: 11000, wake: 'H' },
    MD11: { icao: 'MD11', name: '麦道 MD-11', category: 'heavy', cruiseSpeed: 470, cruiseAlt: 11000, wake: 'H' }
};

/** 常见机型代码列表（供下拉框/生成器使用，按频率加权采样） */
export const COMMON_TYPES = ['B738', 'B738', 'B738', 'A320', 'A320', 'A321', 'B739', 'A332', 'B77W', 'A359', 'C919', 'E190'];

export function getAircraft(icao) {
    return AIRCRAFT[icao] || AIRCRAFT.B738;
}

export function getCategory(acType) {
    return AIRCRAFT_CATEGORIES[getAircraft(acType).category] || AIRCRAFT_CATEGORIES.medium;
}

/** 取机型默认巡航速度 */
export function defaultSpeed(acType) {
    return getAircraft(acType).cruiseSpeed;
}

/** 取机型默认巡航高度 */
export function defaultAltitude(acType) {
    return getAircraft(acType).cruiseAlt;
}

/** 随机抽一个常见机型 */
export function randomType() {
    return COMMON_TYPES[Math.floor(Math.random() * COMMON_TYPES.length)];
}
