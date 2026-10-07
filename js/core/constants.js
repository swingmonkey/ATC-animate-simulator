/**
 * core/constants.js — 全局常量（内核层·叶子模块）
 * 收口原先散落在 canvasInput/render/motion/commands 各文件中的魔法数字。
 */

/* ---------------- 单位换算 ---------------- */

/** 1 节 → km/s */
export const KT_TO_KMPS = 0.00051444 * 1.852;
/** 1 海里 → km */
export const NM_TO_KM = 1.852;

/* ---------------- 命中检测半径（世界坐标 px） ---------------- */

export const HIT = {
    /** 普通点击航路点 */
    POINT: 10,
    /** 连接模式点击航路点 */
    POINT_CONNECT: 12,
    /** 双击航路点 */
    POINT_DBL: 10,
    /** 拖拽/选择飞机 */
    AIRCRAFT: 22,
    /** 双击飞机 */
    AIRCRAFT_DBL: 18,
    /** 点击航线 */
    ROUTE: 12,
    /** 双击航线 */
    ROUTE_DBL: 8,
    /** 标签框命中（屏幕坐标） */
    LABEL_W: 80,
    LABEL_H: 54
};

/* ---------------- 业务规则 ---------------- */

/** 冲突检测垂直间隔 (m) */
export const CONFLICT_ALT_M = 300;
export const ALT_MIN = 3000;
export const ALT_MAX = 15000;
export const SPD_MIN = 200;
export const SPD_MAX = 600;
/** 相对调速步长 (kt) */
export const SPD_STEP = 20;
/** expedite 加速量 (kt) */
export const EXPEDITE_BONUS = 50;
/** 相对转向默认角度 (°) */
export const TURN_DEFAULT_DEG = 30;
/** 爬升/下降默认相对量 (m) */
export const CLIMB_STEP = 600;
export const DESCENT_STEP = 600;
/** 复飞增量 (m) */
export const GOAROUND_ALT = 1500;

/* ---------------- 管制席位 / 塔台·进近内容 ---------------- */

/** 席位边界迟滞系数：已在席位的航空器需超出 scopeKm × 1.25 才外移，避免边界反复移交 */
export const UNIT_SCOPE_HYSTERESIS = 1.25;
/** 进近许可默认目标（高度 m / 速度 kt） */
export const APPROACH_ALT = 900;
export const APPROACH_SPD = 180;
/** 落地许可默认目标（高度 m / 速度 kt） */
export const LANDING_ALT = 300;
export const LANDING_SPD = 150;
/** 判定「已接地」：距机场 km 与高度 m */
export const LANDING_ARRIVE_KM = 8;
export const LANDING_ARRIVE_ALT = 600;
/** 离港默认初始高度/速度（等待放行时保持） */
export const DEPARTURE_INIT_ALT = 900;
export const DEPARTURE_INIT_SPD = 220;
/** 自动放行延迟（模拟秒）：离港航班出现后多久自动发起飞许可 */
export const AUTO_TAKEOFF_DELAY = 45;

/* ---------------- 视图/交互 ---------------- */

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 5;
/** 键盘平移速度 (px/s) */
export const PAN_SPEED = 1250;
/** 航迹最大点数 */
export const TRAIL_MAX_PTS = 30;

/* ---------------- UI 刷新节流 ---------------- */

/** 进程单在播放中的最小刷新间隔 (ms)，避免 60× 倍速时每秒数千次 DOM 重建 */
export const PROGRESS_REFRESH_MS = 250;