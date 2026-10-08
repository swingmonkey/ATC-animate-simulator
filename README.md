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

### 🎯 班次与评分（v1.5 新增）
- **无限流量导演**：按进场点 + 航司概率表持续注入进离港航班，同 seed 完全可复现；导入位置文件后直接执行其 `[scenario]` 事件（`arr/dep/config/score/wind/text`）
- **三档难度**（街机/标准/拟真）：控制流量注入节奏与在管架数上限
- **实时评分与评级**：间隔不足 / 最低高度区违规 / 复飞 / 延误扣分，连续无延误落地加成；S/A/B/C/D 评级
- **跑道按分数解锁**：`[configurations]` 的分数门槛随解锁分升高开启更多跑道（解锁分：`score` 事件设定，每落地 +1）
- **HUD**：班次名、时钟、绩效分与评级、落地与解锁分、告警计数、风与落地/起飞跑道、场景字幕
- **结算复盘**：评级 + 得分构成 + 目标达成清单（5 项）+ 评分事件时间轴
- 班次内**实时不可回溯**（时间轴拖动被拦截）；沙盒模式（`🎲 生成随机场景`）仍可自由编辑与回放

### 🏢 单位经营层（v1.7 M1 新增）

现场层管飞机，经营层管**钱 / 人 / 设施 / 合同 / 局方**——流量增长倒逼单位扩容，扩容条件不足就先出报告：

- **日结算与资金**：每日按合同航班量结算 `收入 − 薪水 − 维护`，资金为负触发声誉惩罚；HUD 常驻显示 `💰 资金 / 🏅 声誉 / 👥 在编 / 🏠 设施`
- **招聘与任命**：见习 / 管制员 / 主管三档，签约费与日薪随角色递增；任命主管是开启扇区划分与更大流量的前提
- **设施建设**：塔台 / 进近 / 区调 / 培训室 / 休息室 / 设备机房六类，各有建造费与日维护费；机房是技术升级与实验运行的硬件门槛
- **培训与席位**：派管制员培训（3 天 × 2 万）提升资质，再把持证人员指派到塔台 / 进近 / 区调席位；席位缺口直接限制可承接架次
- **合同与流量**：支线 / 干线 / 枢纽三档合同，签约即锁定日均架次与年收入，流量超过现场承载能力会拉低班次评级
- **技术升级**：监视管制（雷达）→ ILS Ⅱ 类 → 独立平行进近，逐级解锁更小间隔标准与更低天气门槛
- **局方实验运行**：满足「声誉 ≥ 55 + 已装监视管制 + 有机房」后可向局方申请实验运行，次日批复；驳回扣声誉，批准则解锁高阶运行方式

> 经营层与现场层**共享同一套评分与航班量**：班次评级反向修正声誉（S +6 / A +4 / B +1 / C −2 / D −5），
> 形成「经营决策 → 现场表现 → 声誉 → 局方审批」的闭环。设计见 [`docs/MANAGEMENT.md`](docs/MANAGEMENT.md)。

### 🧭 2D 现场俯视

- 顶部「现场俯视」可切换塔台、进近、区调三个管制室；平面图有席位台、监视屏、窗口、通报台和交接区。
- 建设房间、签合同开放席位、安排管制员后，现场的席位状态和人员会随经营存档更新；未建设现场保持锁定预览。
- 监视屏状态灯与未排席主管的巡视路线有二维动画。点击平面图席位或右侧席位按钮可查看在岗人员，并从已值守席位进入相应尺度的雷达视角。
- 现场布局与人物动作是**模拟示意**。切换离开雷达会暂停班次，现场动画不推进航班与评分时钟；完整的步行、交接和值班制度仍按 [`docs/WORKPLACE.md`](docs/WORKPLACE.md) 后续步骤实现。

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
- **班次玩法（v1.5 起）**：`game/` 层加入关卡场景包与**种子随机**的流量导演、两条分数轴（绩效分/解锁分）、
  目标评估与结算；`render/hud.js` 提供屏幕空间 HUD —— v1.4 解析的 `[scenario]`/`entrypoints`/`airlines`/`[configurations]`/`[areaN]`
  在此全部被消费（无限流量注入、场景事件、跑道按分数解锁、MVA 违规记分），设计见 [`docs/PLAN-v2.md`](docs/PLAN-v2.md) 附录 C
- **关卡与复诵（v1.6 起）**：`data/scenarios.js` 内置 L1/L2/L3 教学关卡；`data/phraseology.js` + `ui/console.js` 构成
  **指令台 2.0**（按席位/阶段推荐用语、非法项灰显并说明原因）；`domain/readback.js` 实现机组**复诵**与漏项错诵判定
  （随机源为 `core/random.js` 的种子序列，可复现），漏项未纠正按次扣分 —— 设计见附录 D

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
│   │   ├── random.js           # 带种子的伪随机（流量注入/复诵抽取共用，保证可复现）
│   │   ├── accessors.js        # 显示值访问器（收口重复的 display* 取值）
│   │   ├── ids.js              # 统一 ID 生成
│   │   └── dom.js              # $ / escapeHtml / HH:MM:SS 格式化
│   ├── data/                   # 静态数据：机型、航司、机场（含示意跑道/频率）、航路点类型、管制席位与进近方式
│   │   ├── locationSamples.js  # 内置示例位置文件（Endless ATC 格式，本项目自撰）
│   │   ├── scenarios.js        # 内置关卡包 L1/L2/L3（进场点/航司表/事件时间轴/目标）
│   │   ├── phraseology.js      # 管制用语模板表（按席位/阶段推荐，指令台 2.0 数据源）
│   │   └── management.js       # 经营层静态数据（角色薪资/设施造价/技术升级/合同模板/始资金）
│   ├── simulation/             # 仿真内核：geometry（纯几何）/ motion（时间推演 + 逐帧钩子）/ constraints（约束原语）
│   ├── domain/                 # 领域层（无 DOM）
│   │   ├── aircraft.js         # 航空器模型、尾流、逐帧推进（席位→许可→接地→阶段）、1Hz 采样
│   │   ├── phases.js           # 飞行阶段 FSM + 指令合法性（canIssue / issueHint）
│   │   ├── airspace.js         # 席位/扇区、距离与迟滞、移交、跑道指派
│   │   ├── clearances.js       # 许可对象与记录、起飞/进近/落地/跑道/复飞
│   │   ├── separation.js       # 间隔标准、冲突判定与预测（AMBER/RED）
│   │   ├── readback.js         # 机组复诵：措辞生成、漏项错诵抽取、复诵状态与纠正
│   │   ├── locationFile.js     # Endless ATC 位置文件语法解析器（纯函数）
│   │   ├── locations.js        # 位置文件语义转换与应用（坐标/单位换算、机场注册）
│   │   └── management.js       # 经营规则（建造/招聘/培训/席位/合同/技术/实验运行/日结算）
│   ├── game/                   # 游戏层
│   │   ├── session.js          # 班次生命周期、管制输入录制、装载/结算、领域层装配
│   │   ├── scenario.js         # 关卡场景包 v3 + [scenario] 事件时间轴 + 种子随机（可复现）
│   │   ├── director.js         # 流量导演：无限注入进离港 + 场景事件驱动
│   │   ├── scoring.js          # 评分与评级、解锁进度分、[configurations] 跑道开关
│   │   ├── objectives.js       # 班次目标定义与达成评估（纯函数）
│   │   └── management.js       # 经营层状态机与动作（hire/appoint/train/build/upgrade/assign/sign/trial/endDay）
│   ├── commands/               # 文本指令：parser（纯解析）/ executor（施加约束与许可）
│   ├── render/                 # Canvas 绘制：background / airports（机场·跑道·管制区）/ routes / aircraft
│   │   ├── location.js         # 位置文件图层：最低高度区（MVA）、空域边界、背景线
│   │   └── hud.js              # 屏幕空间 HUD（分数/评级/告警/跑道/场景字幕）
│   ├── ui/                     # 界面层
│   │   ├── panels.js           # 航路点/航线/飞机面板
│   │   ├── dialogs.js          # 各对话框（含飞机对话框的席位/跑道/进近字段）
│   │   ├── indicators.js       # 模式指示、时间显示、进程单（内置节流 + 席位过滤）
│   │   ├── seatPanel.js        # 管制席位面板（频率/在管架数/待移交）
│   │   ├── sessionPanel.js     # 班次面板（关卡/难度、开始结束、实时读数、结算结果）
│   │   ├── managementPanel.js  # 经营面板（资金/人员/设施/技术/合同/席位/实验运行/结束当日）
│   │   ├── console.js          # 指令台 2.0（推荐用语/灰显/一键下发/复诵回显）
│   │   ├── commPanel.js        # 通话面板（按席位着色 + 输入录制 + submitAtcText 统一提交）
│   │   ├── formBindings.js     # 对话框表单控件事件绑定
│   │   └── subscriptions.js    # 事件订阅中枢（唯一刷新接线处）
│   ├── interaction/            # 输入层：canvasInput / keyboard / palette / toolbar / factory
│   ├── generators/             # 随机场景生成（进港/离港 + 预指派跑道）
│   └── weather/                # 风暴场 / 风场（跑道逆风选择复用）
├── docs/PLAN-v2.md             # 空管指挥游戏重构方案（分层规则/领域模型/玩法/界面/里程碑）
├── docs/FLIGHT-LIFECYCLE.md    # 航班全流程与管制岗位服务规范（离港 9 段 / 进港 6 段 × 6 岗位）
├── docs/WORKPLACE.md           # 工作现场与值班制度规范（三个工作现场 / 角色与小人 / 疲劳与交接 / 突发情况）
├── docs/CCAR-93TM-ALIGNMENT.md # CCAR-93TM-R6 规章对齐与合规边界（席位门槛 / 复诵 / 间隔 / 疲劳 / 记录）
├── docs/MANAGEMENT.md          # 经营层设计说明（经济/人员/设施/技术/局方实验运行与 M1 范围）
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
git clone git@github.com:swingmonkey/ATC-animate-simulator.git
cd ATC-animate-simulator
python -m http.server 8000
# 打开 http://localhost:8000
```

网页默认进入**经营指挥台**：签合同、建设设施、招聘并排席；在**现场俯视**查看管制室的实际开放和值守状态，再进入**雷达值班**完成班次。经营进度自动保存在当前浏览器的 `localStorage`，换浏览器或设备不会自动同步。Electron 桌面版默认进入雷达值班，顶部也可切换视图。

### 在线游玩与部署

在线地址：[空管模拟运营平台](https://www.airtraffic.site/atc-simulator/)。该子路径由 HP 服务器 Nginx 提供静态文件，独立于根站点。

Windows 家里 PC 在提交并推送代码、确认 `npm run check` 与 `npm run smoke` 通过后运行：

```powershell
.\deploy\deploy-web.ps1
```

脚本只打包 `index.html`、`styles.css`、`js/`、`build/icon.ico`；在 `/var/www/atc-simulator/releases/<commit>` 保存版本，通过 `current` 符号链接切换。首次部署会备份 `/etc/nginx/sites-available/airtraffic`，仅添加 `/atc-simulator/` 路径配置，并在重载前执行 `nginx -t`。上一版链接保存在 `/var/www/atc-simulator/previous`。如需回退：

```bash
ssh hp 'ln -sfn "$(readlink -f /var/www/atc-simulator/previous)" /var/www/atc-simulator/current.next && mv -Tf /var/www/atc-simulator/current.next /var/www/atc-simulator/current'
```

### 桌面运行（Electron）

```bash
npm install          # 首次会下载 Electron 运行时（约 100MB）
npm start
```

### 打包为单文件 EXE（Windows 便携版）

```bash
npm run build:win
# 产物：dist/ATC-Simulator-1.8.0.exe —— 双击即运行，无需安装、无需浏览器
```

**直接下载（免打包）**：见 [Releases](https://github.com/swingmonkey/ATC-animate-simulator/releases) 页面的
`ATC-Simulator-1.8.0.exe`（Windows 便携版，单文件，约 74MB）。

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
npm run check    # 校验导入、循环依赖与层级边界
npm run smoke    # Electron 离屏端到端冒烟；含经营视图、存档恢复与 L1 教学
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

## v1.5 班次玩法（无限流量 · 评分 · HUD · 结算）

在 v1.4 已解析的 Endless ATC 数据之上，把「看雷达动画」变成「值守一个班次」：

**核心循环**：开始班次 → 导演按进场点/航司表持续注入流量（并执行 `[scenario]` 事件）→ 读进程单发许可/引导/调速 → HUD 实时显示绩效分与告警 → 落地积累解锁分 → 达标或手动结束 → 结算评级 + 目标达成 + 事件时间轴。

| # | 内容 | 实现位置 |
|---|------|----------|
| 1 | 场景包 v3（机场/难度/种子/目标/时间轴）+ 由位置文件派生关卡；`[scenario].events` 首列按「距上一事件的经过秒数」累积，`elapse` 只推进时间轴 | `game/scenario.js` |
| 2 | 流量导演：`arr`/`dep`/`config`/`score`/`wind`/`text` 事件逐条驱动；`entrypoints` + `airlines` 概率表**无限注入**（机型别名映射、进港高度阶梯、跑道取自构型计划）；同 seed 完全可复现 | `game/director.js` |
| 3 | 评分：绩效分 100 起，间隔不足 −15 / MVA 违规 −10 / 复飞 −6 / 延误 −2，连续 5 架无延误 +5；评级 S≥95 / A≥85 / B≥75 / C≥60 / D<60 | `game/scoring.js` |
| 4 | `[configurations]` 分数门槛解锁/关闭跑道（解锁分：`score` 事件设定，每落地 +1） | `game/scoring.js` |
| 5 | `[areaN]` 最低高度区违规判定（重叠区取更高者；仅对未获进近许可的进港航班计违规） | `domain/airspace.js` |
| 6 | 目标清单评估（零间隔不足 / 零 MVA 违规 / 落地架数 / 平均延误 / 复飞 / 解锁跑道） | `game/objectives.js` |
| 7 | 屏幕空间 HUD：班次名·时钟·绩效分与评级·落地与解锁分·告警·风与跑道·`[scenario]` 字幕 | `render/hud.js` |
| 8 | 班次面板：开始/结束按钮、难度选择、实时读数、结算结果（评级·目标达成·评分事件时间轴） | `ui/sessionPanel.js` |
| 9 | 班次内**实时不可回溯**（时间轴拖动被拦截）；复盘改用评分事件时间轴与场景事件序列 | `interaction/toolbar.js`、`game/session.js` |
| 10 | 缺陷修复：`下降 <绝对高度>` 原先绕过位置文件的 `floor` 可指令下限，现与高度指令一致受上下限约束 | `commands/executor.js` |
| 11 | 冒烟测试扩充到 77 项：关卡装载/导演注入/事件时间轴/分数门槛解锁跑道/MVA 记分/HUD/结算/结果面板 | `desktop/main.js` |

> 班次的**实时不可回溯**与**确定性**是一体两面：运动模型按时间解析求解，导演用种子随机注入，
> 因此同一 seed + 同一输入序列可完整复现，评分与复盘才有依据（见 `docs/PLAN-v2.md` §3.1、§11）。
>
> 尚未接入（P3）：`[departureN]`/`[approachN]` 程序飞行（当前导演航路为「进场点→本场」直线）、
> 尾流间隔与限速、等待航线与进近排序自动化 —— 因此同场多机同时进近时需管制员自行引导间隔。

### 开始一个班次（v1.5 玩法）
1. （可选）点击「📍 示例机场」或「📂 导入机场」载入位置文件 —— 班会直接使用其空域/跑道/进场点/航司表/`[scenario]` 事件；
   也可直接在「🎯 班次与评分」下拉选择内置关卡 **L1/L2/L3**（自带进场点、航司表、事件与目标，无需位置文件）
2. 在右侧「🎯 班次与评分」选择难度（街机/标准/拟真；选内置关卡时难度随关卡），点击「🎬 开始班次」
3. 导演立即按进场点与航司表注入流量（首架约 40s），HUD 显示时钟、绩效分、落地与解锁分、告警与跑道
4. **指令台**（v1.6）：点击进程单选中航班 → 按该席位列出推荐用语；灰显项表示当前阶段不可下发（悬停看原因）；
   点击按钮即用呼号填充并直接下发。也可在「陆空通话」输入框自由输入
5. **复诵**（v1.6）：定向指令会有机组复诵；若复诵漏掉关键参数（拟真难度概率更高），面板会高亮提示，
   点「🔁 重新下发（要求复诵）」纠正；30 秒内不纠正将扣分
6. 落地会累计解锁分，达到 `[configurations]` 门槛后自动开启更多跑道（HUD 与通话面板会播报）
7. 达成 `finish`（落地架数/时限）或点击「⏹ 结束并结算」→ 结果面板给出评级、得分构成、目标达成与评分事件时间轴

> 班次内时间轴不可回溯（拖动会被拦截）：这是「实时管制」与「确定性回放」的取舍，
> 复盘请看结算页的事件时间轴；需要自由回放/编辑时使用沙盒模式（「🎲 生成随机场景」）。

## v1.6 关卡包 · 指令台 2.0 · 复诵

在 v1.5 的班次循环上补齐「教学关卡 + 说得出话 + 复诵闭环」：

| # | 内容 | 实现位置 |
|---|------|----------|
| 1 | **内置关卡 L1/L2/L3**：L1 进近入门（单跑道 02L · 街机）、L2 离港洪峰（双跑道 + 解锁分 5 开放 02R · 标准）、L3 逆风换向（`rev` 反向跑道 20R/20L · 拟真）；关卡自带进场点/航司表/事件时间轴/目标清单，**无需位置文件即可开局** | `data/scenarios.js` |
| 2 | **指令台 2.0**：按选中飞机的席位与阶段列出推荐用语；**非法项灰显并给出原因**（如「尚未进入进近阶段（当前：等待放行）」）；点击即用呼号填充并直接下发 | `ui/console.js`、`data/phraseology.js` |
| 3 | **机组复诵**：定向指令播报中文复诵（`下降到 3000，CCA1234`）；按难度概率抽取**漏项错诵**（街机 0% / 标准 8% / 拟真 20%），漏项未在 30s 宽限期内纠正 → 每次 −3 并计入「无未纠正复诵」目标；点「🔁 重新下发（要求复诵）」即视为纠正 | `domain/readback.js`、`game/scoring.js` |
| 4 | 随机源统一收口到 `core/random.js`（mulberry32 种子随机）：流量注入与复诵抽取共用，同一 seed 可完整复现 | `core/random.js` |
| 5 | 结算面板增加未复诵计数；HUD 告警计数纳入未复诵 | `ui/sessionPanel.js`、`render/hud.js` |
| 6 | 冒烟测试扩充到 92 项：关卡清单/难度随关卡/L2 装载/分数门槛/指令台模板与灰显/一键下发/复诵不符与纠正/未纠正扣分/事件驱动解锁跑道/结算复诵目标 | `desktop/main.js` |

> 关卡与「自动模式」并存：下拉选「自动」时按已导入的位置文件派生关卡，未导入则用自由流量班次；
> 选中内置关卡时难度随关卡设计（难度下拉灰显）。
> 尚未交付：电子进程单 2.0（分栏/排序/延误列）、复盘逐帧重放、成绩持久化（P4）。

## v1.7 经营层 M1（已完成，本次交付）

在既有现场层之上叠加**单位经营层**：流量增长 → 招聘/任命 → 划分扇区/安排席位 → 培训 → 设备与环境投资 → 局方实验运行 → 技术升级。

| 主题 | M1 实现 | 入口 |
|---|---|---|
| 资金与日结算 | 合同收入 − 日薪 − 维护，资金为负扣声誉 | `game/management.js` `endDay` |
| 人员 | 见习/管制员/主管招聘、主管任命、培训（3 天 × 2 万） | `domain/management.js` |
| 设施 | 塔台/进近/区调/培训室/休息室/机房建造与日维护 | `data/management.js` |
| 席位 | 人员指派到 TWR/APP/ACC，统计席位缺口 | `assignSeat` |
| 合同 | 支线/干线/枢纽三档，锁定日均架次与年收入 | `signContract` |
| 技术 | 监视管制 → ILS Ⅱ 类 → 独立平行进近 | `upgradeTech` |
| 局方 | 声誉 ≥ 55 + 监视管制 + 机房 → 申请实验运行，次日批复 | `requestTrialRun` |

> `tasks/handoff-v1.7-workplace.md` 为现场层（三张地图）规范，与经营层 M1 并行；本段只覆盖经营层交付。
## v1.7 规划：三张地图 = 三个工作现场（规范已就位）

「塔台 / 进近 / 区调」不只是三张雷达图，而是**三种不同的工作场景**：区域管制大厅（几个席位各管一块空域 + 领班巡视）、
进近管制室（进场/离场席 + 塔台协调窗口）、塔台（塔台/地面/放行/机坪席 + 视景窗）。
玩家有一个**可操控的小人**，走到席位就座即进入该席位的席位地图；现场还有 AI 同事、领班、休息区与交接台。

| 层 | 回答的问题 | 现状 |
|---|---|---|
| **现场层**（Scene） | 我在哪？谁在岗？现场出了什么事？ | 三现场 2D 俯视与经营排班联动已上线；步行/交接等 Step W1 交互仍按 [`docs/WORKPLACE.md`](docs/WORKPLACE.md) 规划 |
| **席位层**（Seat） | 我负责哪块空域/跑道？看得见什么？ | 档案（`data/viewProfiles.js`）与多视图几何（`core/viewport.js`）已就位，渲染接线待做 |
| **信息层**（Info） | 现在该做什么？做得怎么样？ | 已交付（v1.5/v1.6：HUD / 进程单 / 指令台 / 复诵 / 结算） |

**值班制度**：工作 90 min → 疲劳累积 → 强制休息 → **交接班检查单** → 接班管制员（AI）接管；
离席期间由 AI 代管（走 `core/random.js`，同 seed 可复现）。
**突发情况**：席位突发（特情航班，走既有指令链路）/ 现场突发（设备、人员）/ 协同突发（跑道侵入、FOD），
由领班通报并**改变玩法条件**（流控速率、跑道构型、设备降级）。

> 三条红线：**移动必须低成本**（默认坐席开局 + 快速前往 + 可关闭现场层）、**离席不能毁体验**、**一切可复现**。
> 完整规范与 Step W1/W2/W3 实施步骤见 [`docs/WORKPLACE.md`](docs/WORKPLACE.md)。

## v1.8 规划：规章对齐（规范已就位）

> 参考文本：《交通运输部关于修改〈民用航空空中交通管理规则〉的决定》
> （**CCAR-93TM-R6**，2023-01-01 施行）。下列机制均能指回具体条号，完整对照见
> [`docs/CCAR-93TM-ALIGNMENT.md`](docs/CCAR-93TM-ALIGNMENT.md)。

| 对齐点 | 规章依据 | 游戏机制 |
|---|---|---|
| **席位门槛规则化** | §11–§13 / §111–§113 | 按**架次门槛**决定开放哪些席位；小机场合并值守、大机场分席可被体验（`domain/seats.js`） |
| **必背复诵清单** | §118 | 补齐 `holdShort/crossRunway/backtrack/lineUp/qnh/squawk/transitionLevel/route` 等必背项，错诵可纠正、可判失效（`domain/readback.js`） |
| **间隔按席位分级** | §406 / §407 / §408 | 进近 / 区调 / 未协调用不同标准；5 km 特批 9 条件、15°/2 km 目视间隔均为**可开关**的示意值 |
| **运行记录合规** | §62–§69 | 只在**本地**存档、复盘、练习日志；**不采集、不上传、不对外提供**任何运行记录 |

> **免责声明**：文中所有数值（席位门槛、间隔、休息时长、疲劳阈值……）均为**游戏化示意值**，
> 仅用于模拟演示与教学设计，**不得作为真实运行的任何依据**。本项目**不是**民航运行系统。

**实施步骤**：R1（席位 + 值班 + 疲劳 + 记录骨架）→ R2（复诵 + 责任移交 + 间隔分级）→ R3（应急演练 + 日志闭环），
共 ≈78 项新断言；与现场层并行推进，顺序建议 `W1 → R1 → W2 → R2 → W3 → R3`。

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
