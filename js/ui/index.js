/**
 * ui/index.js — 界面层集结
 * 注意：ui 内部模块之间只允许单向依赖（panels/commPanel → dialogs/indicators），
 * 业务层请通过 store 动作 + 事件总线驱动 UI，勿直接调用刷新函数。
 */

export * from './panels.js';
export * from './dialogs.js';
export * from './indicators.js';
export * from './commPanel.js';
export * from './console.js';
export * from './seatPanel.js';
export * from './sessionPanel.js';
export * from './rosterPanel.js';
export * from './managementPanel.js';
export * from './subscriptions.js';
export * from './formBindings.js';
export { addComm } from '../core/store.js';