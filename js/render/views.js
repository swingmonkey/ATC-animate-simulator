/** 从现场席位进入雷达时，应用对应的视口尺度并记住各席位的平移缩放。 */
import { state, setActiveViewKey } from '../core/store.js';
import { setActiveView, viewState, applyViewGeometry, markViewInitialized, centerOnWorldPoint } from '../core/viewport.js';
import { profileFor, fitScaleForRange } from '../data/viewProfiles.js';
import { getAirport } from '../data/airports.js';

const focusedAirportByView = new Map();

export function focusRadarView(code) {
    const profile = profileFor(code);
    setActiveView(profile.code, { zoom: profile.zoom });
    if (!viewState(profile.code).initialized) {
        applyViewGeometry({ scale: fitScaleForRange(profile.rangeKm), offsetX: 0, offsetY: 0 });
        markViewInitialized(profile.code);
    }
    if (focusedAirportByView.get(profile.code) !== state.focusAirport) {
        const airport = getAirport(state.focusAirport);
        if (airport) centerOnWorldPoint(airport.x, airport.y);
        focusedAirportByView.set(profile.code, state.focusAirport);
    }
    setActiveViewKey(profile.code);
    return profile;
}
