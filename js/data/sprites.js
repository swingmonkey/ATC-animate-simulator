/**
 * data/sprites.js — 像素精灵图素材库（数据层·只读常量）
 *
 * 全部素材以「字符矩阵」描述：'X' = 主体像素，'o' = 座舱亮像素，'.' = 镂空。
 * 绘制时先铺一圈墨色描边再填机身（见 render/pixel.js 的 drawSprite），
 * 得到掌机 RPG 的粗描边小精灵观感。
 *
 * 机型侧写（与 data/aircraftTypes.js 的机型表对齐）：
 *   narrow  窄体（B737/A320/C919/ARJ21 系）
 *   wide    宽体（B777/B787/A330/A350）
 *   jumbo   巨无霸（A380，双层的粗壮机身）
 *   regional 支线（E190/CRJ900，小巧灵活）
 *
 * 依赖方向：无（数据层叶子）。渲染见 render/pixel.js。
 */

/** 窄体机（机头朝右，与 heading 旋转约定一致） */
const PLANE_NARROW = [
    '...........o..',
    '..........ooo.',
    '..........ooo.',
    'XX........ooo.',
    'XXX......ooooo',
    'XXX.....oooooo',
    'XXXXXXXXXXXXXX',
    'XXX.....oooooo',
    'XXX......ooooo',
    'XX........ooo.',
    '..........ooo.',
    '..........ooo.',
    '...........o..'
];

/** 宽体机（机身更粗，四台发动机痕迹） */
const PLANE_WIDE = [
    '............o..',
    '...........ooo.',
    '...........ooo.',
    'XX.........ooo.',
    'XXX.......ooo..',
    'XXX......ooooo.',
    'XXXX....ooooooo',
    'XXXXXXXXXXXXXXX',
    'XXXX....ooooooo',
    'XXX......ooooo.',
    'XXX.......ooo..',
    'XX.........ooo.',
    '...........ooo.',
    '...........ooo.',
    '............o..'
];

/** 巨无霸 A380（双层粗机身 + 大翼展） */
const PLANE_JUMBO = [
    '.............o..',
    '............ooo.',
    'XX.........oooo.',
    'XXX........oooo.',
    'XXXX.......oooo.',
    'XXXXX.....oooooo',
    'XXXXXX...ooooooo',
    'XXXXXXXXXXXXXXXX',
    'XXXXXX...ooooooo',
    'XXXXX.....oooooo',
    'XXXX.......oooo.',
    'XXX........oooo.',
    'XX.........oooo.',
    '............ooo.',
    '.............o..'
];

/** 支线机（小身板短翼） */
const PLANE_REGIONAL = [
    '..........o..',
    '.........ooo.',
    'X........ooo.',
    'XX.......oooo',
    'XXX.....ooooo',
    'XXXXXXXXXXXXX',
    'XXX.....ooooo',
    'XX.......oooo',
    'X........ooo.',
    '.........ooo.',
    '..........o..'
];

/** 机型 → 精灵（含缩放系数：宽体显大、支线显小） */
export const PLANE_VARIANTS = Object.freeze({
    narrow: { rows: PLANE_NARROW, scale: 1 },
    wide: { rows: PLANE_WIDE, scale: 1.14 },
    jumbo: { rows: PLANE_JUMBO, scale: 1.28 },
    regional: { rows: PLANE_REGIONAL, scale: 0.86 }
});

/** 机型表 → 精灵档位（前缀匹配，命中率从高到低） */
const TYPE_RULES = Object.freeze([
    { match: ['A380'], variant: 'jumbo' },
    { match: ['B777', 'B787', 'A330', 'A350', 'A340', 'B747'], variant: 'wide' },
    { match: ['E190', 'E195', 'CRJ', 'ARJ'], variant: 'regional' },
    { match: ['B737', 'B738', 'B739', 'A319', 'A320', 'A321', 'C919', 'C909'], variant: 'narrow' }
]);

/**
 * 按机型代码取精灵档位（未知机型回 narrow）。
 * @param {string} [type] 机型代码如 'B738'
 * @param {'narrow'|'wide'|'jumbo'|'regional'} [fallback]
 */
export function planeVariantFor(type, fallback = 'narrow') {
    const code = String(type || '').toUpperCase();
    for (const rule of TYPE_RULES) {
        if (rule.match.some(prefix => code.startsWith(prefix))) return rule.variant;
    }
    return fallback;
}

/** 像素小树（地图装饰 / 塔台图草地共用） */
export const SPRITE_TREE = Object.freeze({
    trunk: ['#8a5a32'],
    leaves: [
        '..XXX..',
        '.XXXXX.',
        'XXXXXXX',
        '.XXXXX.',
        '..XXX..'
    ],
    leafColor: '#3f8f4e',
    leafLight: '#57aa5f'
});

/** 像素小房子（区域图民房） */
export const SPRITE_HOUSE = Object.freeze({
    body: [
        '..XXXX..',
        '.XXXXXX.',
        'XXXXXXXX',
        'XXXXXXXX',
        'XXXXXXXX',
        'XXXXXXXX',
        'X.XX.XX.',
        'X.XX.XX.'
    ],
    bodyColor: '#e8d8b8',
    roofColor: '#c96a4a',
    doorColor: '#8a6a48'
});

/** 像素控制塔（焦点机场地物：粗塔身 + 瞭望台 + 雷达罩） */
export const SPRITE_TOWER = Object.freeze({
    cab: '#8ed0e8',
    cabGlass: '#c9ecf8',
    frame: '#46576d',
    body: '#d8d8d0'
});
