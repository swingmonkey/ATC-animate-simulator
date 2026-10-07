/**
 * data/airports.js — 机场数据表（数据层）
 * 机场四字码 → 名称 + 在世界坐标系中的近似位置（km，以雷达中心为原点）。
 * 位置用于航班生成时确定进/离港起降地。
 */

/**
 * 跑道与频率为「示意数据」：跑道走向按真实机场简化，频率取值近似，
 * 仅供模拟演示使用，不作为真实飞行依据。
 * runways 采用「跑道对」写法（如 02L/20R 表示 02L 与反向 20R 同一条跑道）。
 * twr / app 分别为塔台、进近管制频率（MHz）。
 */
export const AIRPORTS = {
    ZBAA: { name: '北京首都', region: '华北', x: 380, y: -260, runways: ['01/19', '18L/36R', '18R/36L'], twr: '118.5', app: '119.0' },
    ZBTJ: { name: '天津滨海', region: '华北', x: 420, y: -230, runways: ['16L/34R', '16R/34L'], twr: '118.1', app: '119.15' },
    ZBAD: { name: '北京大兴', region: '华北', x: 360, y: -180, runways: ['17L/35R', '17R/35L', '11L/29R'], twr: '118.35', app: '119.7' },
    ZBSJ: { name: '石家庄正定', region: '华北', x: 330, y: -130, runways: ['15/33'], twr: '118.6', app: '120.05' },
    ZSSS: { name: '上海虹桥', region: '华东', x: 720, y: 120, runways: ['18L/36R', '18R/36L'], twr: '118.1', app: '120.3' },
    ZSPD: { name: '上海浦东', region: '华东', x: 760, y: 100, runways: ['16L/34R', '16R/34L', '17L/35R', '17R/35L'], twr: '118.2', app: '119.0' },
    ZSNJ: { name: '南京禄口', region: '华东', x: 640, y: 60, runways: ['06/24', '07/25'], twr: '118.85', app: '120.35' },
    ZGGG: { name: '广州白云', region: '中南', x: 520, y: 520, runways: ['02L/20R', '02R/20L'], twr: '118.1', app: '120.8' },
    ZGSZ: { name: '深圳宝安', region: '中南', x: 560, y: 560, runways: ['15/33', '16/34'], twr: '118.45', app: '120.35' },
    ZGHA: { name: '长沙黄花', region: '中南', x: 460, y: 380, runways: ['18/36'], twr: '118.55', app: '119.65' },
    ZHCC: { name: '郑州新郑', region: '中南', x: 420, y: 60, runways: ['12L/30R', '12R/30L'], twr: '118.35', app: '119.3' },
    ZUUU: { name: '成都双流', region: '西南', x: -120, y: 320, runways: ['02L/20R', '02R/20L'], twr: '118.85', app: '120.35' },
    ZUCK: { name: '重庆江北', region: '西南', x: -40, y: 360, runways: ['02L/20R', '02R/20L'], twr: '118.2', app: '119.55' },
    ZUGY: { name: '贵阳龙洞堡', region: '西南', x: 40, y: 460, runways: ['01/19'], twr: '118.6', app: '119.9' },
    ZPPP: { name: '昆明长水', region: '西南', x: -120, y: 560, runways: ['03/21', '04/22'], twr: '118.5', app: '120.1' },
    ZLXY: { name: '西安咸阳', region: '西北', x: 200, y: 60, runways: ['05L/23R', '05R/23L'], twr: '118.6', app: '119.6' },
    ZLLL: { name: '兰州中川', region: '西北', x: 60, y: -40, runways: ['18/36'], twr: '118.7', app: '120.2' },
    ZWSH: { name: '乌鲁木齐地窝堡', region: '西北', x: -420, y: -180, runways: ['07/25'], twr: '118.1', app: '119.6' },
    ZJHK: { name: '海口美兰', region: '中南', x: 540, y: 720, runways: ['09/27', '10/28'], twr: '118.35', app: '119.9' },
    ZSAM: { name: '厦门高崎', region: '华东', x: 700, y: 360, runways: ['05/23'], twr: '118.4', app: '120.2' },
    ZSQD: { name: '青岛胶东', region: '华东', x: 640, y: -40, runways: ['17L/35R', '17R/35L'], twr: '118.6', app: '120.1' }
};

export function getAirport(code) {
    return AIRPORTS[code] || null;
}

/**
 * 运行期注册/覆盖机场（由 domain/locations.js 导入 Endless ATC 位置文件时调用）。
 * 与 AIRPORTS 同库：导入后本场跑道/频率立即对生成器、席位与渲染生效。
 * @param {string} code 四字码
 * @param {object} def { name, region, x, y, runways, twr, app }
 */
export function registerAirport(code, def) {
    if (!code || !def) return null;
    AIRPORTS[code] = { ...(AIRPORTS[code] || {}), ...def };
    return AIRPORTS[code];
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

/** 机场跑道对列表（无数据时回退到通用双跑道示意） */
export function runwayList(code) {
    const a = AIRPORTS[code];
    return (a && a.runways && a.runways.length) ? a.runways : ['18/36'];
}

/** 由跑道对取「着陆方向」跑道号，如 02L/20R + 0 → '02L'，+1 → '20R' */
export function runwayEnd(pair, end = 0) {
    const parts = String(pair || '').split('/');
    return (parts[end] || parts[0] || '').trim();
}

/** 跑道号 → 磁航向（'02L' → 20°，'16R' → 160°），非法返回 null */
export function runwayHeading(label) {
    const m = String(label || '').match(/^(\d{2})/);
    if (!m) return null;
    const num = parseInt(m[1], 10);
    return (num * 10) % 360;
}

/** 反向跑道号（'02L' → '20R'） */
export function reciprocalRunway(label) {
    const m = String(label || '').match(/^(\d{2})([LRC]?)$/);
    if (!m) return String(label || '');
    const reciprocal = (parseInt(m[1], 10) + 18) % 36 || 36;
    const side = m[2] === 'L' ? 'R' : (m[2] === 'R' ? 'L' : (m[2] === 'C' ? 'C' : ''));
    return String(reciprocal).padStart(2, '0') + side;
}

/** 机场塔台/进近频率（无数据时回退空串） */
export function airportFrequency(code, kind = 'twr') {
    const a = AIRPORTS[code];
    if (!a) return '';
    return kind === 'app' ? (a.app || '') : (a.twr || '');
}
