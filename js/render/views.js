/** 从现场席位进入雷达时，应用对应的视口尺度并记住各席位的平移缩放。 */
import { setActiveViewKey } from '../core/store.js';
import { setActiveView, viewState, applyViewGeometry, markViewInitialized } from '../core/viewport.js';
import { profileFor, fitScaleForRange } from '../data/viewProfiles.js';

export function focusRadarView(code) {
    const profile = profileFor(code);
    setActiveView(profile.code, { zoom: profile.zoom });
    if (!viewState(profile.code).initialized) {
        applyViewGeometry({ scale: fitScaleForRange(profile.rangeKm), offsetX: 0, offsetY: 0 });
        markViewInitialized(profile.code);
    }
    setActiveViewKey(profile.code);
    return profile;
}
