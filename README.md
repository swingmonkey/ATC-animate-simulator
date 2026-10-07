# 空管雷达动画模拟器（ATC Animate Simulator）

一个功能完整的空管雷达动画模拟器：**零构建原生 ES 模块 + Canvas 2D**，并可通过 Electron 打包为可直接双击运行的 Windows 可执行程序。

## 功能特点

### 📍 航路点管理
- 支持多种类型的航路点：普通点、交叉点、VOR点、导航点、报告点
- 可拖拽添加航路点到地图（工具栏拖放或按钮新增）
- 支持编辑航路点名称和类型

### 🔗 航线管理
- 按序连接航路点创建航线
- 支持自定义航线颜色
- 显示航线距离和航向度数

### ✈ 飞机管理
- 支持添加多架飞机；可设置航班号、应答机、起飞地、目的地、机型、高度、速度、航向
- 三种导航模式：航线导航、自由导航、航向飞行
- 支持飞机关联到航线（拖拽贴线）
- 到达航路点后可选择下一航路点（勾选"到达目标点后询问"后自动暂停并弹窗）

### ⏱ 时间控制
- 播放/暂停、可调播放速度（1x/2x/5x/10x/60x）
- 拖动进度条直接跳转时间点；飞机位置按时间确定性推导，回放精确

### 📻 陆空通话
- 管制员广播 / 向特定飞机发送指令（支持中英文关键词解析：高度、航向、速度、直飞、复飞等）
- 通话历史记录

### 🗺 地图与图层
- 滚轮缩放（鼠标锚点缩放）、ASWD/方向键平移
- 随机场景生成（多机场枢纽进离港航班 + STAR/SID 航线）
- 天气图层（Perlin 噪声风暴场 + 风场箭头 + 危险区判定）

### ⚙ 设置
- 飞机默认参数（高度、速度、机型、应答机）
- 显示参数（网格间距、最小间隔、时间轴长度）

## 技术实现

- **原生 HTML5 + CSS3 + JavaScript（ES 模块）**，无打包、无构建步骤，`index.html` 直接由浏览器或 Electron 加载
- **Canvas 2D 渲染**，脏标记按需重绘（播放中每帧，暂停空闲时零绘制）
- **事件总线（发布-订阅）驱动 UI 刷新**：参考 [openscope](https://github.com/openscope/openscope) 的 EventEmitter 架构，模块间不互相直接调用刷新函数
- **集中式 store（单一数据源）+ 动作函数**：`select / commitScene / togglePlay / addComm` 等
- **确定性运动模型**：约束收敛（高度/速度/航向）+ 时间推导，保证时间轴拖拽可精确回放
- **localStorage 场景持久化**（键 `atc_simulator_state_v2`，兼容 v1 存档）
- **Electron + electron-builder**：`app://` 自定义协议规避 `file://` 下 ES 模块 CORS 限制，并保证存档来源稳定

## 项目结构

```
ATC-animate-simulator/
├── index.html                  # 主页面（模块入口 js/main.js）
├── styles.css                  # 样式
├── js/
│   ├── main.js                 # 入口：订阅注册、固定步长循环、按需重绘、键盘并帧
│   ├── core/                   # 内核层（叶子模块，不依赖任何业务层）
│   │   ├── eventBus.js         # 发布-订阅 + 重绘脏标记
│   │   ├── store.js            # 全局状态与动作（select/commitScene/togglePlay/addComm）
│   │   ├── viewport.js         # 画布与视图变换的唯一事实源（缩放/平移/坐标互转）
│   │   ├── persistence.js      # localStorage 读写
│   │   ├── constants.js        # 命中半径、单位换算、业务常量
│   │   ├── accessors.js        # 显示值访问器（收口重复的 display* 取值）
│   │   ├── ids.js              # 统一 ID 生成
│   │   └── dom.js              # $ / escapeHtml / HH:MM:SS 格式化
│   ├── data/                   # 静态数据：机型、航司、机场、航路点类型
│   ├── simulation/             # 运动模型：geometry（纯几何）/ motion（约束收敛）/ conflict（冲突检测）
│   ├── commands/               # 文本指令：parser（纯解析）/ executor（施加约束）
│   ├── render/                 # Canvas 绘制：background / routes / aircraft
│   ├── ui/                     # 界面层
│   │   ├── panels.js           # 航路点/航线/飞机面板
│   │   ├── dialogs.js          # 各对话框
│   │   ├── indicators.js       # 模式指示、时间显示、进程单（内置节流）
│   │   ├── commPanel.js        # 通话面板
│   │   ├── formBindings.js     # 对话框表单控件事件绑定
│   │   └── subscriptions.js    # 事件订阅中枢（唯一刷新接线处）
│   ├── interaction/            # 输入层：canvasInput / keyboard / palette / toolbar / factory
│   ├── generators/             # 随机场景生成
│   └── weather/                # 风暴场 / 风场
├── desktop/main.js             # Electron 主进程（app:// 协议 + --smoke 冒烟测试）
├── tools/check-imports.mjs     # 零依赖 ES 模块导入/导出静态校验
├── package.json                # 开发/打包脚本与 electron-builder 配置
└── README.md
```

### 依赖方向（单向、无循环）

```
interaction ─┐
commands ────┼─→ store / eventBus ─→ ui（订阅刷新） / render / simulation → core
generators ──┘
```

- UI 刷新一律由 `ui/subscriptions.js` 订阅事件完成，业务层不再手工调用刷新函数
- `ui` 不依赖 `interaction`；`core` 不依赖任何业务层
- 对话框由输入层/界面层调用打开函数，其余交互经 store 动作 + 事件总线

## 快速开始

### 浏览器运行（零构建）

```bash
git clone https://github.com/swingmonkey/ATC-animate-simulator.git
cd ATC-animate-simulator
python -m http.server 8000
# 打开 http://localhost:8000
```

### 桌面运行（Electron）

```bash
npm install          # 首次会下载 Electron 运行时（约 100MB）
npm start
```

### 打包为单文件 EXE（Windows 便携版）

```bash
npm run build:win
# 产物：dist/ATC-Simulator-1.1.0.exe —— 双击即运行，无需安装、无需浏览器
```

若 GitHub 直连受限，可先设置镜像再安装/打包：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install --registry=https://registry.npmmirror.com
npm run build:win
```

### 校验与冒烟测试

```bash
npm run check    # 静态校验 40 个模块、261 条具名导入的导入/导出一致性
npm run smoke    # 无头启动应用并脚本化驱动关键交互，26 项断言
```

## 使用指南

### 基本操作
1. **添加航路点**：从右侧工具栏拖拽航路点到地图，或点击"+ 添加航路点"
2. **创建航线**：点击"🔗 按序连接航路点"后依次点击航路点，再次点击该按钮完成
3. **添加飞机**：从工具栏拖拽飞机到地图，或点击"+ 添加飞机"
4. **关联航线**：在编辑模式下把飞机拖到航线上（自动贴线并取航向）
5. **开始模拟**：点击"▶ 播放"（空格键同样有效）
6. **调整时间**：拖动时间滑块跳转到任意时刻

### 键盘与鼠标
- **滚轮**：以鼠标位置为锚点缩放（0.2x ~ 5x）
- **ASWD / 方向键**：平移地图
- **空格**：播放/暂停　**Esc**：关闭对话框并清除选择　**Delete**：删除选中目标
- **双击**：打开飞机/航路点/航线编辑对话框　**右键**：快速打开实体编辑框
- **拖动飞机标签**：调整标签位置（30° 吸附，最大偏移 80px）

### 管制指令示例
在"陆空通话"输入框输入（可带航班号定向，不含则全体广播）：

| 指令 | 示例 | 说明 |
|------|------|------|
| 高度 | `CCA1234 上升 3000` / `下降 600` | 绝对高度或相对升降 |
| 航向 | `CCA1234 航向 270` / `左转 20` / `右转` | 航向飞行模式 |
| 速度 | `加速到 500` / `减速` / `尽快` | 绝对或相对调速 |
| 直飞 | `直飞 W1234` | 自由导航至指定航路点 |
| 其他 | `保持高度` / `盘旋` / `复飞` | 平飞、保持航向、复飞爬升 |

## v1.1 深度重构说明

重构参考了 `openscope/openscope` 的事件总线与命令模式实践，在**不改动运行方式（仍为零构建 ES 模块）**的前提下完成架构级整理：

| # | 原问题 | 处理方式 |
|---|--------|----------|
| 1 | `core.js` 上帝模块；视图偏移在 `core.js` 与 `interaction/view.js` 各存一份（双事实源） | 拆分为 `core/` 八个模块；`viewport.js` 为视图唯一事实源，原 `view.js` 合并删除 |
| 2 | 状态变更后需手工调用一串 `updateXxxList()`，遗漏即成 bug | 事件总线 + store 动作，`ui/subscriptions.js` 单点订阅刷新 |
| 3 | `ui` 内部循环依赖（indicators ⇄ dialogs），用动态 `import()` 压制 | `updateModeIndicator` 归位 `indicators`；`updateRouteSelectOptions` 内聚到 `dialogs`；播放动作归位 store |
| 4 | 指令层直接操作 DOM（`executor → comm.js`） | `addComm` 移入 store（记录 + 发事件），DOM 追加由 `commPanel` 订阅 |
| 5 | 动画循环每帧全量重建进程单；键盘平移用独立 `setInterval(16ms)` | 进程单 250ms、时间显示 100ms 节流；键盘并入 rAF；暂停时空闲零重绘 |
| 6 | `innerHTML` 直接拼接用户输入（航路点名/通话文本） | 统一 `escapeHtml` / `sanitizeClass` |
| 7 | 三套 ID 生成（`Date.now()`、随机序列）存在同毫秒碰撞 | `core/ids.js` 单调递增统一生成 |
| 8 | 死代码：`connections` / `distanceLines` / `tempMeasureLine` / `labelFollowMouse` / `saveBasePositions` / `mousePos` / `currentTool` 等只写不读 | 状态、渲染分支与调用链一并移除 |
| 9 | 隐性缺陷 | 修复 `dialogs.js` 缺失导入 `updateRouteSelectOptions`（打开飞机对话框触发 ReferenceError）；修复航路点拖动不落盘；恢复"到达航路点询问下一航路点"（原先从未被触发） |
| 10 | 命中半径、单位换算等魔法数字散落 | 收敛至 `core/constants.js` |

> 场景数据键保持 `atc_simulator_state_v2`，旧存档可直接读取。
> 需要清空存档时在开发者工具执行：`localStorage.removeItem('atc_simulator_state_v2')`

## 浏览器兼容性

- Chrome / Edge 79+（支持 ES 模块与可选链）
- Firefox 67+、Safari 13.1+
- Electron 内置 Chromium（打包版无需外部浏览器）

## 贡献

欢迎提交 Issue 和 Pull Request。提交前建议执行 `npm run check` 与 `npm run smoke`。

## 许可证

MIT License

## 联系方式

- 项目地址：https://github.com/swingmonkey/ATC-animate-simulator
- 作者：swingmonkey

