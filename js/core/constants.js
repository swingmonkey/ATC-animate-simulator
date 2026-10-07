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