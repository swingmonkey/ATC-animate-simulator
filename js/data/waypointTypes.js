/**
 * data/waypointTypes.js — 航路点类型表（数据层）
 * 对应参考项目的导航点类型定义，纯展示/语义数据。
 */

export const WAYPOINT_TYPES = {
    normal:     { label: '普通点', symbol: '', color: '#2563eb' },
    intersection: { label: '交叉点', symbol: '✕', color: '#9333ea' },
    vor:        { label: 'VOR', symbol: '◎', color: '#dc2626' },
    navaid:     { label: '导航点', symbol: '△', color: '#16a34a' },
    reporting:  { label: '报告点', symbol: '◇', color: '#ea580c' }
};

export const POINT_COLORS = Object.fromEntries(
    Object.entries(WAYPOINT_TYPES).map(([k, v]) => [k, v.color])
);

export const POINT_LABELS = Object.fromEntries(
    Object.entries(WAYPOINT_TYPES).map(([k, v]) => [k, v.symbol])
);

export function waypointTypeList() {
    return Object.entries(WAYPOINT_TYPES).map(([key, v]) => ({ key, ...v }));
}
