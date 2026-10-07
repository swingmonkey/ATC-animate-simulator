/**
 * domain/locationFile.js — Endless ATC 位置文件（.txt）解析器（领域层·纯函数）
 *
 * 兼容目标：startgrid《Endless ATC》自定义机场文件格式（社区库 EndlessATC/Airports，
 * 权威说明为该库根目录 example.txt）。解析结果是「通用结构」，语义解释在 domain/locations.js。
 *
 * 语法规则（严格按 example.txt）：
 *   · 行首 '#' 或 '##' 整行为注释；值内以空白 + ';' 起为行内注释
 *   · '[name]' 为节头（airspace / airport1 / area1 / configurations / departure1 / approach1 / …）
 *   · 'key = value' 为条目；value 可用逗号分隔多个字段
 *   · 以 tab/空格开头的行是**上一条目的多行列表续行**（每个续行是一行数据）
 *   · 坐标可为 纬度/经度（N51.47176, W0.457859、度分秒、decimaldegrees）或
 *     x, y（海里，原点为雷达中心，+y 为北）
 *
 * 本模块不做任何语义判断，也不依赖 core/其它层 —— 便于单测与复用（编辑器/导入器/校验器共用）。
 */

/** 海里 → km（与 core/constants.js 一致；此处内联以避免领域层依赖内核常量表） */
const NM_TO_KM = 1.852;

/** 去掉行内注释：';' 前必须是行首或空白，避免误伤值中的分号 */
function stripComment(line) {
    const m = line.match(/(^|[\t ]);/);
    return m ? line.slice(0, m.index + m[1].length) : line;
}

/** 逗号切分并 trim（保留空串，便于按位置取字段） */
function splitTokens(value) {
    return String(value).split(',').map(t => t.trim());
}

/**
 * 解析位置文件全文。
 * @param {string} text 文件内容
 * @returns {{version:number, sections:Array<{name:string,line:number,items:Object,keys:string[]}>,warnings:string[]}}
 */
export function parseLocationFile(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    const sections = [];
    const warnings = [];
    let current = null;
    let lastKey = null;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (!raw.trim()) continue;
        if (raw.trim().startsWith('#')) continue;              // 注释行（含 '##' 格式说明）

        const header = raw.trim().match(/^\[([^\]]+)\]$/);
        if (header) {
            current = { name: header[1].trim().toLowerCase(), line: i + 1, items: {}, keys: [] };
            sections.push(current);
            lastKey = null;
            continue;
        }

        const line = stripComment(raw);
        if (!line.trim()) continue;
        const indented = /^[\t ]/.test(raw);
        const eq = line.indexOf('=');

        if (!indented && eq > 0) {                              // 新条目
            if (!current) {
                warnings.push(`第 ${i + 1} 行：赋值出现在任何 [节] 之前`);
                lastKey = null;
                continue;
            }
            const key = line.slice(0, eq).trim().toLowerCase();
            const value = line.slice(eq + 1).trim();
            const item = { key, line: i + 1, rows: [] };
            if (value) item.rows.push(splitTokens(value));
            current.items[key] = item;                          // 同名条目以最后一次为准（与游戏行为一致）
            current.keys.push(key);
            lastKey = key;
        } else if (current && lastKey) {                        // 多行列表续行
            current.items[lastKey].rows.push(splitTokens(line.trim()));
        } else {
            warnings.push(`第 ${i + 1} 行：无法解析的内容「${raw.trim().slice(0, 40)}」`);
        }
    }

    return { version: 1, sections, warnings };
}

/* ---------------- 节与条目访问器 ---------------- */

export function getSection(parsed, name) {
    const key = String(name || '').toLowerCase();
    return parsed.sections.find(s => s.name === key) || null;
}

/** 取某前缀的全部节，例如 getSections(parsed, 'airport') → [airport1, airport2, …] */
export function getSections(parsed, prefix) {
    const p = String(prefix || '').toLowerCase();
    return parsed.sections.filter(s => s.name.startsWith(p));
}

export function itemOf(section, key) {
    if (!section) return null;
    return section.items[String(key || '').toLowerCase()] || null;
}

/** 条目的所有数据行（多行列表每行一个元素；单值条目仅一行） */
export function itemRows(section, key) {
    const it = itemOf(section, key);
    return it ? it.rows : [];
}

/** 条目第一行的 token 数组 */
export function itemTokens(section, key) {
    const rows = itemRows(section, key);
    return rows[0] || [];
}

/** 条目第一行第 idx 个字段（缺省空串） */
export function itemValue(section, key, idx = 0) {
    const t = itemTokens(section, key);
    return t[idx] === undefined ? '' : t[idx];
}

export function hasItem(section, key) {
    return !!itemOf(section, key);
}

/* ---------------- 值转换 ---------------- */

/** 宽松数字：'090' → 90；'18.6' → 18.6；非法 → dflt */
export function num(value, dflt = 0) {
    const n = parseFloat(String(value == null ? '' : value).replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(n) ? n : dflt;
}

/** 布尔：true/yes/1/on → true；false/no/0/off/空 → dflt */
export function bool(value, dflt = false) {
    const s = String(value == null ? '' : value).trim().toLowerCase();
    if (!s) return dflt;
    if (['true', 'yes', '1', 'on'].includes(s)) return true;
    if (['false', 'no', '0', 'off'].includes(s)) return false;
    return dflt;
}

/**
 * 十进制度解析（纬度或经度）。
 * 支持：'N51.47176'、'W0.457859'、"-0.457859"、"51°28'18.336''N"、"51°28'18N"
 * 南纬/西经返回负值。
 */
export function parseLatLon(value) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return NaN;
    const hemi = (s.match(/[NSEW]/i) || [''])[0].toUpperCase();
    const nums = s.match(/\d+(?:\.\d+)?/g) || [];
    if (!nums.length) return NaN;
    const deg = parseFloat(nums[0]);
    const min = nums[1] ? parseFloat(nums[1]) : 0;
    const sec = nums[2] ? parseFloat(nums[2]) : 0;
    let v = deg + min / 60 + sec / 3600;
    if (/^-/.test(s) || hemi === 'S' || hemi === 'W') v = -v;
    return v;
}

/** token 是否含半球字母（N/S/E/W），用于判断坐标模式 */
export function looksLikeLatLon(token) {
    return /[NSEW]/i.test(String(token == null ? '' : token));
}

/** 海里 → 本项目世界单位（km） */
export function nmToKm(v) { return num(v) * NM_TO_KM; }
