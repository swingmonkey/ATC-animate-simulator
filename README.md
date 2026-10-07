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

### 🗼 塔台 / 进近 / 区调管制（v1.2 新增）

按真实管制单位划分三级席位，由内到外为 **塔台（TWR）→ 进近（APP）→ 区调（ACC）**，
航班按「距参考机场的水平距离」自动归属席位，跨界时执行**移交（handoff）**（对标 openScope 的 sector/position 与 handoff 机制）：

| 席位 | 频率 | 管制范围 | 职责 |
|------|------|----------|------|
| 🟠 塔台 TWR | 机场塔台频率（如 ZUUU 118.85） | 机场半径 15km | 起飞/落地许可、跑道、复飞 |
| 🔵 进近 APP | 机场进近频率（如 ZUUU 120.35） | 终端区 60km | 进近许可（ILS / RNAV / VOR-DME / 目视）、下高度调速、雷达引导 |
| 🟣 区调 ACC | 126.85 | 其余空域 | 巡航高度、航路、跨区移交 |

- **管制席位面板**：实时显示三个席位的频率、在管架数、待移交数；点击席位行可让进程单只显示该席位管辖的飞机（再点取消）
- **自动移交 / 自动许可**：两个开关默认开启——离港航班 45 秒后自动放行、进港航班进入终端区自动发进近许可、进入塔台区自动发落地许可；关闭后即变成「手动管制」玩法
- **交界迟滞**：已在席位内的航班需超出范围 25% 才外移，避免在边界反复移交
- **跑道与航道**：每个机场配示意跑道对，天气开启时按风场选择逆风跑道；焦点机场绘制跑道、进近航道延长线与 15km/60km 管制区圆环
- **落地闭环**：离港「可以起飞」→ 爬升加速；进港「可以进近」→ 下 900m/180kt；「可以落地」→ 下 300m/150kt，进入塔台区且高度到位即判定接地，飞机离开雷达
- **席位通话**：移交与许可都产生成对的管制指令 + 机组复诵通话，通话面板按席位着色（`[塔台]`/`[进近]`/`[区调]`）

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
- **分层架构（v1.3 起）**：`core → simulation → domain → game → ui/render/interaction` 单向依赖，由 `npm run check` 强制校验循环依赖与层级越界；
  领域层含**飞行阶段 FSM**、许可与复诵记录、席位/扇区、间隔预测，游戏层含班次与输入录制 —— 完整设计见 [`docs/PLAN-v2.md`](docs/PLAN-v2.md)
- **兼容 Endless ATC 机场文件（v1.4 起）**：直接导入 [startgrid《Endless ATC》](https://github.com/EndlessATC/Airports) 社区位置文件（`.txt`）——
  空域参数（半径/高度上下限/隔离标准）、跑道（真航向/长度/标高/ILS）、信标、最低高度区（MVA）、跑道构型、
  SID/STAR 航路、进场点、航司表、机型性能表、`[scenario]` 事件时间轴与背景线；工具栏「📂 导入机场 / 📍 示例机场」即可使用

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
│   │   ├── clock.js            # 固定步长时钟（时间推进的唯一入口）
│   │   ├── viewport.js         # 画布与视图变换的唯一事实源（缩放/平移/坐标互转）
│   │   ├── persistence.js      # localStorage 读写
│   │   ├── constants.js        # 命中半径、单位换算、业务常量
│   │   ├── accessors.js        # 显示值访问器（收口重复的 display* 取值）
│   │   ├── ids.js              # 统一 ID 生成
│   │   └── dom.js              # $ / escapeHtml / HH:MM:SS 格式化
│   ├── data/                   # 静态数据：机型、航司、机场（含示意跑道/频率）、航路点类型、管制席位与进近方式
│   │   └── locationSamples.js  # 内置示例位置文件（Endless ATC 格式，本项目自撰）
│   ├── simulation/             # 仿真内核：geometry（纯几何）/ motion（时间推演 + 逐帧钩子）/ constraints（约束原语）
│   ├── domain/                 # 领域层（无 DOM）
│   │   ├── aircraft.js         # 航空器模型、尾流、逐帧推进（席位→许可→接地→阶段）、1Hz 采样
│   │   ├── phases.js           # 飞行阶段 FSM + 指令合法性（canIssue / issueHint）
│   │   ├── airspace.js         # 席位/扇区、距离与迟滞、移交、跑道指派
│   │   ├── clearances.js       # 许可对象与记录、起飞/进近/落地/跑道/复飞
│   │   ├── separation.js       # 间隔标准、冲突判定与预测（AMBER/RED）
│   │   ├── locationFile.js     # Endless ATC 位置文件语法解析器（纯函数）
│   │   └── locations.js        # 位置文件语义转换与应用（坐标/单位换算、机场注册）
│   ├── game/                   # 游戏层
│   │   └── session.js          # 班次生命周期、管制输入录制、领域层装配
│   ├── commands/               # 文本指令：parser（纯解析）/ executor（施加约束与许可）
│   ├── render/                 # Canvas 绘制：background / airports（机场·跑道·管制区）/ routes / aircraft
│   │   └── location.js         # 位置文件图层：最低高度区（MVA）、空域边界、背景线
│   ├── ui/                     # 界面层
│   │   ├── panels.js           # 航路点/航线/飞机面板
│   │   ├── dialogs.js          # 各对话框（含飞机对话框的席位/跑道/进近字段）
│   │   ├── indicators.js       # 模式指示、时间显示、进程单（内置节流 + 席位过滤）
│   │   ├── seatPanel.js        # 管制席位面板（频率/在管架数/待移交）
│   │   ├── commPanel.js        # 通话面板（按席位着色 + 输入录制）
│   │   ├── formBindings.js     # 对话框表单控件事件绑定
│   │   └── subscriptions.js    # 事件订阅中枢（唯一刷新接线处）
│   ├── interaction/            # 输入层：canvasInput / keyboard / palette / toolbar / factory
│   ├── generators/             # 随机场景生成（进港/离港 + 预指派跑道）
│   └── weather/                # 风暴场 / 风场（跑道逆风选择复用）
├── docs/PLAN-v2.md             # 空管指挥游戏重构方案（分层规则/领域模型/玩法/界面/里程碑）
├── build/icon.ico              # 应用图标（由 tools/make-icon.py 生成）
├── desktop/main.js             # Electron 主进程（app:// 协议 + --smoke 冒烟测试）
├── tools/check-imports.mjs     # 零依赖 ES 模块导入/导出静态校验（含循环依赖与层级越界）
├── tools/check-location.mjs    # Endless ATC 位置文件离线校验（解析摘要 + 告警）
├── tools/make-icon.py          # 图标生成（Pillow 绘制雷达屏图标，多尺寸 ICO）
├── package.json                # 开发/打包脚本与 electron-builder 配置
└── README.md
```

### 依赖方向（单向、无循环，已由工具强制校验）

```
输入 interaction → 界面 ui → 游戏 game → 领域 domain → 仿真 simulation → 内核 core
                                  ↘ 渲染 render ↗        （data / weather 为横向资源）
```

| 层 | 目录 | 允许 import |
|---|---|---|
| 0 内核 | `core/` | 仅本层 |
| 1 仿真/数据/天气 | `simulation/`、`data/`、`weather/` | 层 0–1 |
| 2 领域 | `domain/` | 层 0–2 |
| 3 游戏/渲染 | `game/`、`render/` | 层 0–3 |
| 4 命令/生成 | `commands/`、`generators/` | 层 0–4 |
| 5 界面 | `ui/` | 层 0–5 |
| 6 输入 | `interaction/` | 层 0–6 |
| 装配点 | `js/main.js` | 全部（唯一允许跨层 import 的文件） |

- `npm run check` 会做**循环依赖检测**与**层级越界检测**（越界即构建失败），规则详见 [`docs/PLAN-v2.md`](docs/PLAN-v2.md) §3.1
- 领域层需要逐帧推进时使用**依赖倒置**（`simulation/motion.js` 的 `onAircraftStep(fn)`），仿真层不反向依赖领域层
- UI 刷新一律由 `ui/subscriptions.js` 订阅事件完成，业务层不再手工调用刷新函数

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
# 产物：dist/ATC-Simulator-1.2.0.exe —— 双击即运行，无需安装、无需浏览器
```

**直接下载（免打包）**：见 [Releases](https://github.com/swingmonkey/ATC-animate-simulator/releases) 页面的
`ATC-Simulator-1.2.0.exe`（Windows 便携版，单文件，约 74MB）。

应用图标由 `tools/make-icon.py`（Pillow）绘制生成 `build/icon.ico`，窗口/任务栏图标在
`desktop/main.js` 中通过 `BrowserWindow.icon` 指定；网页端使用 `<link rel="icon">`。
如需重新生成图标：

```bash
npm run icon        # 等价于 python tools/make-icon.py
```

> ⚠️ EXE **文件本身**的图标需要在 `package.json` 中启用 `win.signAndEditExecutable`（默认关闭）：
> electron-builder 会下载 `winCodeSign` 并调用 rcedit 改写 exe 资源，而该压缩包内含
> macOS 符号链接，在未开启 Windows 开发者模式的机器上解压会失败。关闭后功能不受影响，
> 仅资源管理器中的 exe 图标保持 Electron 默认图标。

若 GitHub 直连受限，可先设置镜像再安装/打包：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install --registry=https://registry.npmmirror.com
npm run build:win
```

### 校验与冒烟测试

```bash
npm run check    # 静态校验 54 个模块、435 条具名导入 + 循环依赖 + 层级越界
npm run smoke    # 无头启动应用（Electron 离屏）并脚本化驱动关键交互，61 项断言
npm run location -- <机场文件.txt>   # Endless ATC 位置文件离线校验（解析摘要 + 告警）
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
| 塔台放行 | `CCA1234 可以起飞` / `可以落地` | 起飞许可（爬升到计划高度）、落地许可（下 300m/150kt） |
| 进近许可 | `CCA1234 ILS 进近 跑道 02L` / `可以进近` / `目视进近` | 指派进近方式与跑道，下 900m/180kt |
| 跑道 | `CCA1234 跑道 20R` | 指派/更换跑道（可随进近、落地许可一起下发） |
| 席位移交 | `CCA1234 移交塔台` / `联系进近` / `contact tower` | 手动移交（关闭自动移交后使用） |
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

## v1.2 塔台 / 进近管制内容

在 v1.1 架构之上补齐「管制单位」这一层业务，主要新增与改动：

| # | 内容 | 实现位置 |
|---|------|----------|
| 1 | 三级席位（塔台/进近/区调）+ 管制区半径 + 频率 + 职责数据 | `data/atcUnits.js` |
| 2 | 席位归属（距离 + 迟滞判定）、移交（自动/手动）、起飞/进近/落地许可、跑道指派（按风选择逆风端） | `simulation/units.js` |
| 3 | 约束原语下沉为叶子模块，避免 `motion ⇄ units` 循环依赖 | `simulation/constraints.js` |
| 4 | 指令词表：`可以起飞/可以落地/进近许可(ILS/RNAV/VOR/目视)/跑道 xx/移交塔台` + 英文别名 | `commands/parser.js`、`commands/executor.js` |
| 5 | 机场图层：跑道、进近航道延长线、各机场塔台区、焦点机场进近区 | `render/airports.js`、`core/viewport.js`（`kmToPxFixed`） |
| 6 | 雷达标签第 5 行显示席位/跑道/进近方式；进程单增加「席位 · 管制状态」行 | `render/aircraft.js`、`ui/indicators.js` |
| 7 | 管制席位面板：频率、在管架数、待移交数、席位过滤、自动开关、视图定位 | `ui/seatPanel.js`、`index.html`、`styles.css` |
| 8 | 飞机对话框新增席位/跑道/进近方式字段与「移交下一席位」按钮 | `ui/dialogs.js`、`ui/formBindings.js` |
| 9 | 通话面板按席位着色（`[塔台]`/`[进近]`/`[区调]`） | `ui/commPanel.js` |
| 10 | 生成场景后自动聚焦焦点机场；离港航班改为「待放行 → 放行后爬升」，让席位流程在时间轴上可见 | `interaction/toolbar.js`、`generators/flightGenerator.js` |
| 11 | 应用图标（雷达屏主题，多尺寸 ICO）+ 窗口图标 + 网页 favicon | `tools/make-icon.py`、`build/icon.ico`、`desktop/main.js`、`index.html` |
| 12 | 冒烟测试扩充到 45 项：席位边界/许可/移交/过滤/自动流程/图标随包 | `desktop/main.js` |

> 跑道与频率为**示意数据**（真实机场的简化近似），仅用于模拟演示，不作为飞行依据。
> 席位范围的 km 值与地图世界坐标的换算采用固定比例（`pxToKmFixed` / `kmToPxFixed`），
> 因此缩放地图不会改变席位的归属判定。

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

