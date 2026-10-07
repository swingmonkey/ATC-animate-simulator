/**
 * interaction/index.js — 输入层集结（副作用导入即注册事件）
 * 注意：输入层只依赖 core（store/viewport/eventBus）与 simulation，
 * 对话框打开经 ui 对话框函数，其余 UI 刷新一律走事件总线，勿直接 import 刷新函数。
 */

import './keyboard.js';
import './canvasInput.js';
import './palette.js';
import './toolbar.js';

export { tickKeyboard } from './keyboard.js';
