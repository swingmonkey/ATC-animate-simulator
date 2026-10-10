/**
 * render/effects.js — 画面反馈「果汁」：飘分 / 落地星光 / 徽章 toast（绘制层）
 *
 * v1.9 趣味性核心：把看不见的评分事件变成看得见的掌机风反馈——
 *   · 飘分（世界坐标，随地图平移/缩放）：落地 +1、间隔不足 −15、低于 MVA −10……
 *   · 落地星光：像素粒子四散；
 *   · 徽章 toast（屏幕坐标）：Pokémon 式「获得徽章」对话框，停留后淡出。
 *
 * 只订阅事件 + 读值，不写业务状态；tick 由 main.js 每帧驱动（暂停时也动画，保证反馈完整）。
 */

import { ctx, canvasWidth, viewScale } from '../core/viewport.js';
import { state } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import { acPos } from '../core/accessors.js';
import { getAirport } from '../data/airports.js';

/* ---------------- 配色令牌 ---------------- */
const C = {
    good: '#16713a',
    bonus: '#8a5b10',
    warn: '#c96a10',
    bad: '#b3271a',
    info: '#23398c',
    gold: '#f8c848',
    teal: '#1f8a80'
};

/* ---------------- 事件状态 ---------------- */
const popups = [];      // { x, y, text, color, life, ttl, drift }
const particles = [];   // { x, y, vx, vy, life, ttl, color, size }
const toasts = [];      // { icon, name, desc, life, ttl }

const POPUP_TTL = 1.6;
const TOAST_TTL = 4.2;

/** 按飞机找到飘分落点：优先飞机本身，其次航迹末点，再退回焦点机场 */
function anchorOf(callsign) {
    const ac = state.aircraft.find(a => a.flightNo === callsign);
    if (ac) {
        try {
            const p = acPos(ac);
            if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
        } catch (e) { /* 落入航迹兜底 */ }
        const trail = ac.trail;
        if (trail && trail.length) {
            const last = trail[trail.length - 1];
            return { x: last.x, y: last.y };
        }
    }
    const ap = getAirport(state.focusAirport);
    return ap ? { x: ap.x, y: ap.y } : { x: 0, y: 0 };
}

/** 评分事件 → 飘分文本与颜色（零权重事件不飘） */
function popupFor(event) {
    switch (event.kind) {
        case 'LANDED': return { text: landingStampText(event), color: landingStampColor(event) };
        case 'EARLY_BONUS': return { text: `+${event.weight || 5} 连击奖励!`, color: C.bonus };
        case 'DELAY': return { text: `−${Math.abs(event.weight)} 延误`, color: C.warn };
        case 'SEPARATION_BREACH': return { text: `−${Math.abs(event.weight)} 间隔不足!`, color: C.bad };
        case 'MVA_BREACH': return { text: `−${Math.abs(event.weight)} 低于MVA!`, color: C.bad };
        case 'GO_AROUND': return { text: `−${Math.abs(event.weight)} 复飞`, color: C.warn };
        case 'READBACK_MISSED': return { text: `−${Math.abs(event.weight)} 复诵未纠正`, color: C.warn };
        case 'HANDOFF_TIMEOUT': return { text: `−${Math.abs(event.weight)} 移交超时`, color: C.warn };
        case 'RUNWAY_CHANGE': return { text: '跑道解锁!', color: C.teal };
        default: return null;
    }
}

/** 落地印章（参考《我是航空管制官》的落地评价）：准时/延误分级 */
const DELAY_TOLERANCE_SEC = 180;
function landingDelaySec(event) {
    const ac = state.aircraft.find(a => a.flightNo === event.detail?.callsign);
    if (!ac || !Number.isFinite(ac.schedLanding)) return null;
    return Math.round((ac.landedTime || state.time) - ac.schedLanding);
}
function landingStampText(event) {
    const delay = landingDelaySec(event);
    if (delay === null || delay <= 0) return '+1 完美落地!';
    return delay > DELAY_TOLERANCE_SEC ? `+1 落地 · 延误 ${delay}s` : '+1 准时落地';
}
function landingStampColor(event) {
    const delay = landingDelaySec(event);
    if (delay === null || delay <= 0) return C.good;
    return delay > DELAY_TOLERANCE_SEC ? C.warn : C.good;
}

/** 生成一朵落地星光（像素粒子四散 + 一环金粉） */
function landingSparkles(x, y) {
    for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
        const speed = 26 + Math.random() * 42;
        particles.push({
            x, y,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed - 14,
            life: 0, ttl: 0.7 + Math.random() * 0.5,
            color: i % 3 === 0 ? C.gold : (i % 3 === 1 ? '#5cb85c' : '#fffdf2'),
            size: 2.2 + Math.random() * 2.4
        });
    }
}

/* ---------------- 事件订阅 ---------------- */

bus.on(EV.SCORE_CHANGED, ({ event } = {}) => {
    if (!event) return;
    const p = popupFor(event);
    if (p) {
        const anchor = anchorOf(event.detail?.callsign || (event.detail?.callsigns || [])[0]);
        popups.push({
            x: anchor.x + (Math.random() - 0.5) * 26,
            y: anchor.y,
            text: p.text,
            color: p.color,
            life: 0, ttl: POPUP_TTL,
            drift: 26 + Math.random() * 14
        });
    }
    if (event.kind === 'LANDED') {
        const anchor = anchorOf(event.detail?.callsign);
        landingSparkles(anchor.x, anchor.y);
    }
    requestRedraw();
});

bus.on(EV.BADGE_EARNED, ({ badge } = {}) => {
    if (!badge) return;
    toasts.push({ icon: badge.icon, name: badge.name, desc: badge.desc, life: 0, ttl: TOAST_TTL });
    requestRedraw();
});

/* 奇葩货物送达：在飞机位置再弹一条「货物」飘分 */
bus.on(EV.CARGO_LANDED, ({ flightNo, cargo } = {}) => {
    if (!cargo) return;
    const anchor = anchorOf(flightNo);
    popups.push({
        x: anchor.x + (Math.random() - 0.5) * 20,
        y: anchor.y + 22,
        text: `${cargo.icon} ${cargo.name}`,
        color: C.teal,
        life: 0, ttl: POPUP_TTL + 0.5,
        drift: 18
    });
    requestRedraw();
});

bus.on(EV.SESSION_ENDED, (result) => {
    if (!result) return;
    const grade = result.grade;
    if (grade === 'S' || grade === 'A') {
        const ap = getAirport(state.focusAirport);
        if (ap) {
            for (let i = 0; i < 26; i++) {
                const ang = (i / 26) * Math.PI * 2;
                const speed = 50 + Math.random() * 60;
                particles.push({
                    x: ap.x, y: ap.y,
                    vx: Math.cos(ang) * speed,
                    vy: Math.sin(ang) * speed,
                    life: 0, ttl: 1.2 + Math.random() * 0.6,
                    color: i % 2 ? C.gold : '#5cb85c',
                    size: 2.6 + Math.random() * 2.6
                });
            }
        }
    }
    requestRedraw();
});

/* ---------------- 推进与绘制 ---------------- */

/** 每帧推进（真实秒；由 main.js 动画循环调用，暂停时反馈也播完） */
export function tickEffects(dt) {
    for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        p.life += dt;
        if (p.life >= p.ttl) popups.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i];
        q.life += dt;
        if (q.life >= q.ttl) { particles.splice(i, 1); continue; }
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vy += 42 * dt;      // 一点重力，粒子自然垂落
        q.vx *= (1 - 1.4 * dt);
    }
    for (let i = toasts.length - 1; i >= 0; i--) {
        toasts[i].life += dt;
        if (toasts[i].life >= toasts[i].ttl) toasts.splice(i, 1);
    }
}

/** 世界坐标效果（在雷达世界变换内调用：飘分 + 粒子） */
export function drawEffects() {
    if (!popups.length && !particles.length) return;
    const u = 1 / viewScale;

    /* 粒子（像素方块，带淡出） */
    particles.forEach(q => {
        const k = 1 - q.life / q.ttl;
        ctx.save();
        ctx.globalAlpha = Math.max(0, k);
        ctx.fillStyle = q.color;
        const s = q.size * (0.5 + k * 0.5);
        ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
        ctx.restore();
    });

    /* 飘分：上升 + 放大式淡出的粗体文字（米白描边保证任何底色可读） */
    popups.forEach(p => {
        const k = p.life / p.ttl;
        const rise = p.drift * k;
        const alpha = k < 0.12 ? k / 0.12 : (1 - (k - 0.12) / 0.88);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.font = `bold ${13 / viewScale}px 'Microsoft YaHei', sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3 / viewScale;
        ctx.strokeStyle = 'rgba(255,253,242,0.95)';
        const ty = p.y - rise;
        ctx.strokeText(p.text, p.x, ty);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, ty);
        ctx.textAlign = 'left';
        ctx.restore();
    });
}

/** 屏幕坐标效果（在世界变换之外调用：徽章 toast） */
export function drawToasts() {
    if (!toasts.length) return;
    const w = canvasWidth;
    toasts.forEach((t, index) => {
        const k = t.life / t.ttl;
        // 进场：前 0.25s 滑入；出场：最后 0.5s 淡出
        const slide = k < 0.08 ? (1 - k / 0.08) : 0;
        const fade = k > 0.88 ? 1 - (k - 0.88) / 0.12 : 1;
        const bw = 250, bh = 58;
        const bx = w / 2 - bw / 2;
        const by = 52 + index * (bh + 8) + slide * 26;
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        /* 对话框：硬投影 + 粗描边 + 米白底 */
        ctx.shadowColor = 'rgba(43,47,74,0.35)';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#fffdf2';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, 12);
        else ctx.rect(bx, by, bw, bh);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = '#2b2f4a';
        ctx.lineWidth = 3;
        ctx.stroke();
        /* 徽章图标（金底圆章） */
        const cx = bx + 30, cy = by + bh / 2;
        ctx.fillStyle = '#f8c848';
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2b2f4a';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#fffdf2';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2b2f4a';
        ctx.font = "900 14px 'Microsoft YaHei', sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.icon, cx, cy + 1);
        /* 文案 */
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#23398c';
        ctx.font = "bold 13px 'Microsoft YaHei', sans-serif";
        ctx.fillText('获得徽章！', bx + 56, by + 22);
        ctx.fillStyle = '#2b2f4a';
        ctx.font = "900 14px 'Microsoft YaHei', sans-serif";
        ctx.fillText(`${t.name}`, bx + 56, by + 40);
        ctx.fillStyle = '#8a94ad';
        ctx.font = "10px 'Microsoft YaHei', sans-serif";
        ctx.fillText(t.desc, bx + 56 + ctx.measureText(t.name).width + 8, by + 40);
        ctx.restore();
    });
}

/** 当前进行中的效果数量（调试/冒烟用） */
export function effectsCount() {
    return { popups: popups.length, particles: particles.length, toasts: toasts.length };
}
