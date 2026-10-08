/** 现场玩家状态机。移动按帧 dt 推进，经营快照决定能否进入席位。 */
import { state } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { WORKSPACES, WORKSPACE_ORDER, seatApproachPoint } from '../data/workspaces.js';
import { managementSummary } from './management.js';

const WALK_SPEED = 135;       // 现场图坐标 / 现实秒
const REACH = 46;
const X_MIN = 78, X_MAX = 922, Y_MIN = 186, Y_MAX = 490;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function slotFor(site, code) {
    return WORKSPACES[site]?.seats.find(seat => seat.code === code) || null;
}

/** 建设、流量席位规划和排班需同时满足，才允许玩家接管。 */
export function playableSeat(summary, site, code) {
    const slot = slotFor(site, code);
    if (!slot || !summary?.roomCounts?.[site] || !summary.availableSeats?.includes(code)) return null;
    const appInTower = !!summary.sectorPlan?.tower?.includes('APP');
    if (code === 'APP' && (site === 'tower') !== appInTower) return null;
    const occupant = summary.staff?.find(person => person.seat === code);
    return occupant ? { ...slot, occupant } : null;
}

function firstPlayable(summary) {
    for (const site of WORKSPACE_ORDER) {
        for (const seat of WORKSPACES[site].seats) {
            const active = playableSeat(summary, site, seat.code);
            if (active) return { site, seat: active };
        }
    }
    return null;
}

export function createAvatarState(summary) {
    const first = firstPlayable(summary);
    if (first) return { site: first.site, x: first.seat.x, y: first.seat.y + 55,
        mode: 'SEATED', seat: first.seat.code, targetSeat: first.seat.code, destination: null };
    const site = WORKSPACE_ORDER.find(key => summary?.roomCounts?.[key]) || 'tower';
    return { site, x: 500, y: 478, mode: 'IDLE', seat: null, targetSeat: null, destination: null };
}

/** 旧档无 avatar 时按当前经营状态初始化；无效旧座位安全退回门口。 */
export function initAvatar() {
    const summary = managementSummary();
    if (!summary) return null;
    if (!state.avatar || !WORKSPACES[state.avatar.site]) state.avatar = createAvatarState(summary);
    else {
        const avatar = state.avatar;
        avatar.x = clamp(Number(avatar.x) || 500, X_MIN, X_MAX);
        avatar.y = clamp(Number(avatar.y) || 478, Y_MIN, Y_MAX);
        if (avatar.mode === 'SEATED' && playableSeat(summary, avatar.site, avatar.seat)) {
            const seat = slotFor(avatar.site, avatar.seat);
            avatar.x = seat.x;
            avatar.y = seat.y + 55;
        } else {
            avatar.mode = 'IDLE';
            avatar.seat = null;
        }
        avatar.destination = null;
        if (!summary.roomCounts[avatar.site]) {
            avatar.site = WORKSPACE_ORDER.find(key => summary.roomCounts[key]) || 'tower';
            avatar.x = 500;
            avatar.y = 478;
            avatar.targetSeat = null;
        }
    }
    bus.emit(EV.AVATAR_CHANGED, { avatar: { ...state.avatar }, action: 'init' });
    return state.avatar;
}

/** 经营变更后清除已撤销的房间、排班或行进目标。 */
export function reconcileAvatar() {
    const avatar = state.avatar;
    const summary = managementSummary();
    if (!avatar || !summary) return false;
    let changed = false;
    if (!summary.roomCounts?.[avatar.site]) {
        avatar.site = WORKSPACE_ORDER.find(key => summary.roomCounts?.[key]) || 'tower';
        Object.assign(avatar, { x: 500, y: 478, mode: 'IDLE', seat: null,
            targetSeat: null, destination: null });
        changed = true;
    } else if (avatar.mode === 'SEATED' && !playableSeat(summary, avatar.site, avatar.seat)) {
        Object.assign(avatar, { x: 500, y: 478, mode: 'IDLE', seat: null, destination: null });
        changed = true;
    } else if (avatar.mode === 'WALKING' && !playableSeat(summary, avatar.site, avatar.targetSeat)) {
        Object.assign(avatar, { mode: 'IDLE', destination: null });
        changed = true;
    }
    if (changed) bus.emit(EV.AVATAR_CHANGED, { avatar: { ...avatar }, action: 'reconcile' });
    return changed;
}

export function setAvatarTarget(code) {
    if (!state.avatar) initAvatar();
    if (!state.avatar || !slotFor(state.avatar.site, code)) return false;
    state.avatar.targetSeat = code;
    bus.emit(EV.AVATAR_CHANGED, { avatar: { ...state.avatar } });
    return true;
}

/** 点击另一现场相当于经走廊换场；未建设现场只可预览。 */
export function visitWorkspace(site) {
    const summary = managementSummary();
    if (!state.avatar || !WORKSPACES[site] || !summary?.roomCounts?.[site]) return false;
    if (state.avatar.site === site) return true;
    state.avatar = { site, x: 500, y: 478, mode: 'IDLE', seat: null,
        targetSeat: null, destination: null };
    bus.emit(EV.AVATAR_CHANGED, { avatar: { ...state.avatar }, action: 'visit' });
    return true;
}

export function cycleWorkspace() {
    const summary = managementSummary();
    const sites = WORKSPACE_ORDER.filter(key => summary?.roomCounts?.[key]);
    if (sites.length < 2 || !state.avatar) return false;
    const index = sites.indexOf(state.avatar.site);
    return visitWorkspace(sites[(index + 1) % sites.length]);
}

export function walkToSeat(code = state.avatar?.targetSeat) {
    const avatar = state.avatar;
    const seat = playableSeat(managementSummary(), avatar?.site, code);
    if (!avatar || !seat) return { ok: false, reason: '该席位尚未开放或未安排人员' };
    if (avatar.mode === 'SEATED' && avatar.seat === code) return { ok: true, arrived: true };
    const point = seatApproachPoint(seat);
    avatar.mode = 'WALKING';
    avatar.seat = null;
    avatar.targetSeat = code;
    avatar.destination = point;
    bus.emit(EV.AVATAR_CHANGED, { avatar: { ...avatar }, action: 'walk' });
    return { ok: true, arrived: false };
}

export function fastTravelToSeat(code = state.avatar?.targetSeat) {
    const avatar = state.avatar;
    const seat = playableSeat(managementSummary(), avatar?.site, code);
    if (!avatar || !seat) return { ok: false, reason: '该席位尚未开放或未安排人员' };
    Object.assign(avatar, { ...seatApproachPoint(seat), mode: 'IDLE', seat: null,
        targetSeat: code, destination: null });
    bus.emit(EV.AVATAR_CHANGED, { avatar: { ...avatar }, action: 'fast-travel' });
    return { ok: true };
}

export function tickAvatar(dt) {
    const avatar = state.avatar;
    if (!avatar || avatar.mode !== 'WALKING' || !avatar.destination) return false;
    const dx = avatar.destination.x - avatar.x;
    const dy = avatar.destination.y - avatar.y;
    const distance = Math.hypot(dx, dy);
    const step = WALK_SPEED * clamp(dt, 0, 0.1);
    if (distance <= step || distance < 1) {
        avatar.x = avatar.destination.x;
        avatar.y = avatar.destination.y;
        avatar.mode = 'IDLE';
        avatar.destination = null;
        bus.emit(EV.AVATAR_CHANGED, { avatar: { ...avatar }, action: 'arrived' });
    } else {
        avatar.x += dx / distance * step;
        avatar.y += dy / distance * step;
    }
    return true;
}

export function moveAvatar(dx, dy, dt, fast = false) {
    const avatar = state.avatar;
    if (!avatar || avatar.mode === 'SEATED' || (!dx && !dy)) return false;
    const length = Math.hypot(dx, dy);
    const speed = WALK_SPEED * (fast ? 1.8 : 1) * clamp(dt, 0, 0.1);
    avatar.x = clamp(avatar.x + dx / length * speed, X_MIN, X_MAX);
    avatar.y = clamp(avatar.y + dy / length * speed, Y_MIN, Y_MAX);
    avatar.mode = 'IDLE';
    avatar.destination = null;
    return true;
}

export function commitAvatarPosition() {
    if (state.avatar) bus.emit(EV.AVATAR_CHANGED, { avatar: { ...state.avatar }, action: 'moved' });
}

export function sitAvatar(code = state.avatar?.targetSeat) {
    const avatar = state.avatar;
    const seat = playableSeat(managementSummary(), avatar?.site, code);
    if (!avatar || !seat) return { ok: false, reason: '该席位尚未开放或未安排人员' };
    const point = seatApproachPoint(seat);
    if (Math.hypot(avatar.x - point.x, avatar.y - point.y) > REACH && !(avatar.mode === 'SEATED' && avatar.seat === code)) {
        return { ok: false, reason: '先走近席位，或按 F 快速前往' };
    }
    Object.assign(avatar, { x: seat.x, y: seat.y + 55, mode: 'SEATED',
        seat: code, targetSeat: code, destination: null });
    bus.emit(EV.AVATAR_CHANGED, { avatar: { ...avatar }, action: 'seated' });
    bus.emit(EV.AVATAR_SEATED, { site: avatar.site, seat: code, view: WORKSPACES[avatar.site].view });
    return { ok: true, view: WORKSPACES[avatar.site].view };
}

export function leaveAvatarSeat() {
    const avatar = state.avatar;
    if (!avatar || avatar.mode !== 'SEATED') return false;
    const oldSeat = avatar.seat;
    const seat = slotFor(avatar.site, oldSeat);
    Object.assign(avatar, { ...seatApproachPoint(seat), mode: 'IDLE',
        seat: null, targetSeat: oldSeat, destination: null });
    bus.emit(EV.AVATAR_CHANGED, { avatar: { ...avatar }, action: 'left' });
    bus.emit(EV.AVATAR_LEFT, { site: avatar.site, seat: oldSeat });
    return true;
}
