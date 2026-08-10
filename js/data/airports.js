/**
 * data/airports.js — 机场数据表（数据层）
 * 机场四字码 → 名称 + 在世界坐标系中的近似位置（km，以雷达中心为原点）。
 * 位置用于航班生成时确定进/离港起降地。
 */

export const AIRPORTS = {
    ZBAA: { name: '北京首都', region: '华北', x: 380, y: -260 },
    ZBTJ: { name: '天津滨海', region: '华北', x: 420, y: -230 },
    ZBAD: { name: '石家庄正定', region: '华北', x: 360, y: -180 },
    ZSSS: { name: '上海虹桥', region: '华东', x: 720, y: 120 },
    ZSPD: { name: '上海浦东', region: '华东', x: 760, y: 100 },
    ZSNJ: { name: '南京禄口', region: '华东', x: 640, y: 60 },
    ZGGG: { name: '广州白云', region: '中南', x: 520, y: 520 },
    ZGSZ: { name: '深圳宝安', region: '中南', x: 560, y: 560 },
    ZGHA: { name: '长沙黄花', region: '中南', x: 460, y: 380 },
    ZHCC: { name: '郑州新郑', region: '中南', x: 420, y: 60 },
    ZUUU: { name: '成都双流', region: '西南', x: -120, y: 320 },
    ZUCK: { name: '重庆江北', region: '西南', x: -40, y: 360 },
    ZUGY: { name: '贵阳龙洞堡', region: '西南', x: 40, y: 460 },
    ZPPP: { name: '昆明长水', region: '西南', x: -120, y: 560 },
    ZLXY: { name: '西安咸阳', region: '西北', x: 200, y: 60 },
    ZLLL: { name: '兰州中川', region: '西北', x: 60, y: -40 },
    ZWSH: { name: '乌鲁木齐地窝堡', region: '西北', x: -420, y: -180 },
    ZJHK: { name: '海口美兰', region: '中南', x: 540, y: 720 },
    ZSAM: { name: '厦门高崎', region: '华东', x: 700, y: 360 },
    ZSQD: { name: '青岛胶东', region: '华东', x: 640, y: -40 }
};

export function getAirport(code) {
    return AIRPORTS[code] || null;
}

export function airportName(code) {
    const a = AIRPORTS[code];
    return a ? a.name : code;
}

export function randomAirportCode(exclude) {
    const codes = Object.keys(AIRPORTS).filter(c => c !== exclude);
    return codes[Math.floor(Math.random() * codes.length)];
}

/** 取与给定机场不同区域的一个机场（用于制造跨区航班） */
export function distantAirport(exclude) {
    const a = AIRPORTS[exclude];
    if (!a) return randomAirportCode(exclude);
    const candidates = Object.entries(AIRPORTS)
        .filter(([code, ap]) => code !== exclude && ap.region !== a.region)
        .map(([code]) => code);
    if (!candidates.length) return randomAirportCode(exclude);
    return candidates[Math.floor(Math.random() * candidates.length)];
}
