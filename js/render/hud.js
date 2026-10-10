/**
 * render/hud.js — 屏幕空间 HUD（绘制层）
 *
 * 内容（docs/PLAN-v2.md §8.1）：班次名 / 时钟 / 绩效分与评级 / 落地与解锁进度 / 告警计数 /
 * 风与跑道构型 / [scenario] 字幕 / 最近告警条目。
 *
 * v1.9 宝可梦画风：顶部信息条为「菜单栏」（深蓝渐变 + 粗墨下边 + 硬投影），
 * 关键读数做成「徽章 chip」；字幕与告警为「对话框」（米白底 + 粗描边）。
 *
 * 数据全部来自 game/scoring.js 与 game/director.js 的汇总（单一口径），
 * 本模块不写任何状态，只做绘制与读值（hudModel 供面板与冒烟断言复用）。
 */

import { state } from '../core/store.js';
import { ctx, canvasWidth } from '../core/viewport.js';
import { formatHMS } from '../core/dom.js';
import { scoringSummary } from '../game/scoring.js';
import { directorSummary } from '../game/director.js';
import { currentSession, isSessionActive } from '../game/session.js';
import { managementSummary } from '../game/management.js';
import { badgeSummary } from '../game/badges.js';
import { stressSummary } from '../game/stress.js';

/** 秒 → hh:mm:ss（复用核心层格式化，避免重复实现） */
export const formatClock = formatHMS;

/** HUD 读值模型（面板 / 冒烟断言 / 绘制共用） */
export function hudModel() {
    const sc = scoringSummary();
    const d = directorSummary();
    const sess = currentSession();
    const mgmt = managementSummary();
    const cash = mgmt ? Math.round(mgmt.cash || 0) : 0;
    const badges = badgeSummary();
    const stress = stressSummary();
    return {
        sessionActive: isSessionActive(),
        playing: state.isPlaying,
        time: Math.round(state.time),
        timeText: formatClock(state.time),
        sessionId: sess ? sess.id : null,
        scenarioName: d.scenarioName,
        difficulty: d.difficultyLabel,
        score: sc.score,
        grade: sc.grade,
        gradeLabel: sc.gradeLabel,
        landed: sc.landed,
        progress: sc.progress,
        streak: sc.streak,
        avgDelaySec: sc.avgDelaySec,
        separation: sc.counts.separation,
        mva: sc.counts.mva,
        goAround: sc.counts.goAround,
        delay: sc.counts.delay,
        readback: sc.counts.readback,
        alerts: sc.counts.separation + sc.counts.mva + sc.counts.goAround + sc.counts.readback,
        runwayLand: sc.runway.land,
        runwayStart: sc.runway.start,
        configName: sc.runway.name,
        runwayChanges: sc.runwayChanges,
        wind: d.wind,
        banner: d.banner,
        timelineDone: d.timelineDone,
        spawned: d.totalSpawned,
        activeAircraft: d.activeAircraft,
        maxAircraft: d.maxAircraft,
        finish: d.finish,
        cash,
        cashText: `${Math.round(cash / 10000)}万`,
        reputation: mgmt ? mgmt.reputation : 0,
        staffCount: mgmt ? mgmt.staffCount : 0,
        roomCount: mgmt ? mgmt.roomCount : 0,
        day: mgmt ? mgmt.day : 0,
        badgeCount: badges.earnedCount,
        badgeTotal: badges.total,
        stress: stress.stress,
        stressLevel: stress.level,
        stressLevelLabel: stress.levelLabel,
        stressPeak: stress.peak,
        coffeeReady: stress.coffeeReady,
        coffeeCooldownLeft: stress.coffeeCooldownLeft
    };
}

const BAR_H = 34;
const PK_INK = '#2b2f4a';
const PK_NAVY = '#3556c0';

/** 评级 → chip 底色（掌机属性色） */
function gradeChipColor(grade) {
    switch (grade) {
        case 'S': return { bg: '#8878d8', fg: '#fffdf2' };
        case 'A': return { bg: '#5cb85c', fg: '#fffdf2' };
        case 'B': return { bg: PK_NAVY, fg: '#fffdf2' };
        case 'C': return { bg: '#f09030', fg: '#2b2f4a' };
        default: return { bg: '#e8503a', fg: '#fffdf2' };
    }
}

/** 顶部信息条 + 场景字幕 + 告警列表（在世界变换之外调用，坐标为屏幕像素） */
export function drawHud() {
    const m = hudModel();
    const w = canvasWidth;
    const mode = state.activeView === 'TWR' ? '塔台' : state.activeView === 'ACC' ? '区调' : '进近';

    ctx.save();

    /* ---- 菜单栏：深蓝渐变 + 粗墨下边 + 底部硬投影 ---- */
    const grad = ctx.createLinearGradient(0, 0, 0, BAR_H);
    grad.addColorStop(0, '#3f63d8');
    grad.addColorStop(1, '#23398c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, BAR_H);
    ctx.fillStyle = PK_INK;
    ctx.fillRect(0, BAR_H - 3, w, 3);
    ctx.fillStyle = 'rgba(43,47,74,0.22)';
    ctx.fillRect(0, BAR_H, w, 3);

    ctx.font = "bold 12px 'Microsoft YaHei', sans-serif";
    ctx.textBaseline = 'middle';
    let x = 10;

    /** 普通文本读数 */
    const put = (text, color) => {
        ctx.fillStyle = color;
        ctx.fillText(text, x, BAR_H / 2);
        x += ctx.measureText(text).width + 16;
    };
    /** chip 读数（徽章底 + 粗描边） */
    const putChip = (text, bg, fg, outline = PK_INK) => {
        ctx.font = "bold 12px 'Microsoft YaHei', sans-serif";
        const tw = ctx.measureText(text).width;
        const chipH = 21;
        const chipY = (BAR_H - chipH) / 2;
        ctx.fillStyle = bg;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, chipY, tw + 14, chipH, 6);
        else ctx.rect(x, chipY, tw + 14, chipH);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = fg;
        ctx.fillText(text, x + 7, BAR_H / 2);
        x += tw + 14 + 12;
    };

    if (m.sessionActive) {
        put(`✦ ${mode} · ${m.scenarioName || '值班中'}`, '#e8eeff');
        putChip(m.timeText, '#fffdf2', PK_INK);
        const gc = gradeChipColor(m.grade);
        putChip(`${m.score} 分 · ${m.grade}`, gc.bg, gc.fg, PK_INK);
        putChip(`落地 ${m.landed}${m.finish?.count ? '/' + m.finish.count : ''}`, '#ffe9a8', PK_INK);
        if (m.alerts) putChip(`告警 ${m.alerts}`, '#e8503a', '#fffdf2');
        else put('告警 0', '#9fb0e8');
        /* 压力读数：淡定/紧张/手抖 三档属性色，紧张以上才占位 */
        if (m.sessionActive && m.stress > 0) {
            const stressChip = m.stressLevel === 'fried' ? { bg: '#e8503a', fg: '#fffdf2' }
                : m.stressLevel === 'tense' ? { bg: '#f8c848', fg: '#2b2f4a' }
                    : { bg: '#5cb85c', fg: '#fffdf2' };
            putChip(`压力 ${Math.round(m.stress)} · ${m.stressLevelLabel}`, stressChip.bg, stressChip.fg);
            if (!m.coffeeReady) put(`☕ ${m.coffeeCooldownLeft}s`, '#9fb0e8');
        }
        if (w > 820) put(`飞机 ${m.activeAircraft}/${m.maxAircraft}`, '#cdd9ff');
        if (w > 1050) put(`跑道 ${(m.runwayLand || []).join('/') || '--'}`, '#9fb0e8');
        if (m.badgeCount) putChip(`徽章 ${m.badgeCount}/${m.badgeTotal}`, '#f8c848', PK_INK);
    } else {
        put(`✦ ${mode}值班`, '#e8eeff');
        putChip(m.timeText, '#fffdf2', PK_INK);
        put(m.playing ? '自由模拟 · 运行中' : '右侧开始班次 / 自由模拟', '#9fb0e8');
        if (m.badgeCount) putChip(`徽章 ${m.badgeCount}/${m.badgeTotal}`, '#f8c848', PK_INK);
    }
    ctx.restore();

    /* [scenario] 字幕（对话框样式，位于信息条下方居中；保持显示到被下一条替换） */
    if (m.banner && m.banner.text) {
        ctx.save();
        ctx.font = "bold 14px 'Microsoft YaHei', sans-serif";
        ctx.textAlign = 'center';
        const tw = ctx.measureText(m.banner.text).width;
        const bx = w / 2 - tw / 2 - 12, by = BAR_H + 10, bw = tw + 24, bh = 26;
        ctx.fillStyle = 'rgba(255,253,242,0.96)';
        ctx.strokeStyle = PK_INK;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, 8);
        else ctx.rect(bx, by, bw, bh);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#8a5b10';
        ctx.fillText(m.banner.text, w / 2, by + 17);
        ctx.restore();
    }

    /* 最近告警（左下角对话框，最多 3 条） */
    const alerts = scoringSummary().alerts.filter(a => a.kind !== 'LANDED');
    if (alerts.length) {
        ctx.save();
        ctx.font = "bold 11px 'Microsoft YaHei', sans-serif";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        alerts.slice(-3).forEach((a, i) => {
            const y = 48 + i * 19;
            const tw = ctx.measureText(a.text).width;
            const bad = a.kind === 'SEPARATION_BREACH' || a.kind === 'MVA_BREACH';
            ctx.fillStyle = 'rgba(255,253,242,0.96)';
            ctx.strokeStyle = bad ? '#e8503a' : '#f09030';
            ctx.lineWidth = 2;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') ctx.roundRect(8, y - 13, tw + 14, 17, 5);
            else ctx.rect(8, y - 13, tw + 14, 17);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = bad ? '#b3271a' : '#8a5b10';
            ctx.fillText(a.text, 14, y);
        });
        ctx.restore();
    }
}
