/**
 * core/dom.js — DOM 小工具（内核层·叶子模块）
 */

/** 按 id 取元素 */
export const $ = id => document.getElementById(id);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * 转义 HTML 特殊字符。
 * 航路点名/航线名/航班号/通话文本均为用户输入，拼进 innerHTML 前必须转义。
 */
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

/** 用于 CSS 类名的发送者标识（如通话面板消息气泡） */
export function sanitizeClass(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown';
}

/** 秒 → HH:MM:SS */
export function formatHMS(totalSeconds) {
    const t = Math.max(0, Math.floor(totalSeconds));
    const h = String(Math.floor(t / 3600)).padStart(2, '0');
    const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}