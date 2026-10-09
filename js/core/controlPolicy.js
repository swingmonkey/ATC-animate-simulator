/** 自动运营时，人工指令只用于正在处置的特情。 */
import { state } from './store.js';

export function activeIncidents() { return state.activeIncidents || []; }
export function radarAvailable() {
    return !state.autoOperationsMode || activeIncidents().length > 0;
}
export function canManualControl(ac) {
    if (!ac || ac.landed || ac.exited) return false;
    if (!state.autoOperationsMode) return true;
    return activeIncidents().some(incident => incident.acId === null || incident.acId === ac.id);
}
