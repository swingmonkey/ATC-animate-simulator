/**
 * data/airlines.js — 航司数据表（数据层）
 * 呼号前缀(三字码) → 航司名 + 枢纽机场。用于航班号生成与起降地选择。
 */

export const AIRLINES = {
    CCA: { name: '中国国际航空', hubs: ['ZBAA', 'ZUUU', 'ZGGG'] },
    CSN: { name: '中国南方航空', hubs: ['ZGGG', 'ZGSZ', 'ZGHA'] },
    CES: { name: '中国东方航空', hubs: ['ZSPD', 'ZSSS', 'ZUGY'] },
    CHH: { name: '海南航空', hubs: ['ZJHK', 'ZBTJ', 'ZUUU'] },
    CSZ: { name: '深圳航空', hubs: ['ZGSZ'] },
    CSC: { name: '四川航空', hubs: ['ZUUU', 'ZUCK'] },
    CXA: { name: '厦门航空', hubs: ['ZSAM'] },
    CDG: { name: '重庆航空', hubs: ['ZUCK'] },
    CQH: { name: '春秋航空', hubs: ['ZSSS', 'ZBYN'] },
    GCR: { name: '山东航空', hubs: ['ZSQD'] },
    CHB: { name: '祥鹏航空', hubs: ['ZPPP'] },
    CWU: { name: '成都航空', hubs: ['ZUUU'] },
    KNA: { name: '中国联航', hubs: ['ZBAD'] }
};

/** 按枢纽机场查找其所属航司三字码列表 */
export function airlinesByHub(airportCode) {
    return Object.entries(AIRLINES)
        .filter(([, a]) => a.hubs.includes(airportCode))
        .map(([code]) => code);
}

/** 随机选一家航司 */
export function randomAirline() {
    const codes = Object.keys(AIRLINES);
    return codes[Math.floor(Math.random() * codes.length)];
}

/** 取一家以 givenHub 为枢纽的航司，否则随机 */
export function airlineForHub(givenHub) {
    const candidates = airlinesByHub(givenHub);
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
    return randomAirline();
}

/** 生成航班号：三字码 + 3~4 位数字 */
export function makeCallsign(airlineCode, flightNo) {
    return `${airlineCode}${flightNo}`;
}

export function randomFlightNumber() {
    return String(Math.floor(Math.random() * 9000) + 1000);
}
