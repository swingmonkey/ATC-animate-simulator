/**
 * render/hud.js — 屏幕空间 HUD（绘制层）
 *
 * 内容（docs/PLAN-v2.md §8.1）：班次名 / 时钟 / 绩效分与评级 / 落地与解锁进度 / 告警计数 /
 * 风与跑道构型 / [scenario] 字幕 / 最近告警条目。
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

/** 秒 → hh:mm:ss（复用核心层格式化，避免重复实现） */
export const formatClock = formatHMS;

/** HUD 读值模型（面板 / 冒烟断言 / 绘制共用） */
export function hudModel() {
    const sc = scoringSummary();
    const d = directorSummary();
    const sess = currentSession();
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
        finish: d.finish
    };
}

const BAR_H = 26;

/** 顶部信息条 + 场景字幕 + 告警列表（在世界变换之外调用，坐标为屏幕像素） */
export function drawHud() {
    const m = hudModel();
    const w = canvasWidth;

    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.82)';
    ctx.fillRect(0, 0, w, BAR_H);

    ctx.font = '12px Consolas, monospace';
    ctx.textBaseline = 'middle';
    let x = 10;
    const put = (text, color) => {
        ctx.fillStyle = color;
        ctx.fillText(text, x, BAR_H / 2);
        x += ctx.measureText(text).width + 14;
    };

    if (m.sessionActive) {
        put(`🎯 ${m.scenarioName || '--'}`, '#e2e8f0');
        put(`🕒 ${m.timeText}`, '#93c5fd');
        put(`⭐ ${m.score} (${m.grade})`, m.score >= 85 ? '#4ade80' : (m.score >= 60 ? '#fbbf24' : '#f87171'));
        put(`🛬 ${m.landed}${m.finish && m.finish.count ? '/' + m.finish.count : ''}`, '#e2e8f0');
        put(`🔓 ${m.progress}`, '#a5b4fc');
        put(`⚠ ${m.alerts}`, m.alerts ? '#f87171' : '#64748b');
        put(`🛣 ${(m.runwayLand || []).join('/') || '--'}`, '#34d399');
        put(`↗ ${(m.runwayStart || []).join('/') || '--'}`, '#fbbf24');
        put(`💨 ${m.wind ? `${m.wind.dir}° ${m.wind.spd}kt` : '--'}`, '#7dd3fc');
        put(`✈ ${m.activeAircraft}/${m.maxAircraft}`, '#cbd5e1');
    } else {
        put('🎯 未开始班次 — 点击右侧「开始班次」装载关卡（无限流量 + 评分）', '#cbd5e1');
        put(`🕒 ${m.timeText}`, '#93c5fd');
        put(m.playing ? '沙盒模式 · 播放中' : '沙盒模式 · 暂停', '#94a3b8');
    }
    ctx.restore();

    /* [scenario] 字幕（黄字，位于信息条下方居中；保持显示到被下一条替换） */
    if (m.banner && m.banner.text) {
        ctx.save();
        ctx.font = 'bold 15px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(15,23,42,0.75)';
        const tw = ctx.measureText(m.banner.text).width;
        ctx.fillRect(w / 2 - tw / 2 - 12, BAR_H + 8, tw + 24, 24);
        ctx.fillStyle = '#fde047';
        ctx.fillText(m.banner.text, w / 2, BAR_H + 20);
        ctx.restore();
    }

    /* 最近告警（左下角，最多 3 条） */
    const alerts = scoringSummary().alerts.filter(a => a.kind !== 'LANDED');
    if (alerts.length) {
        ctx.save();
        ctx.font = '11px Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        alerts.slice(-3).forEach((a, i) => {
            const y = 46 + i * 15;
            ctx.fillStyle = 'rgba(15,23,42,0.7)';
            const tw = ctx.measureText(a.text).width;
            ctx.fillRect(8, y - 11, tw + 10, 15);
            ctx.fillStyle = a.kind === 'SEPARATION_BREACH' || a.kind === 'MVA_BREACH' ? '#fca5a5' : '#fcd34d';
            ctx.fillText(a.text, 12, y);
        });
        ctx.restore();
    }
}
