/**
 * data/locationSamples.js — 内置示例位置文件（Endless ATC 格式 · 本项目自撰）
 *
 * 用途：让「导入 Endless ATC 机场」功能开箱可用，并作为格式参考（字段含义见文件内注释）。
 * 来源声明：**本文件内容由本项目自行撰写**（跑道走向取自本项目 data/airports.js 的示意数据，
 * 航路点/边界/最低高度区为教学简化值），不复制 Endless ATC 社区机场文件，避免版权问题。
 * 格式兼容：startgrid《Endless ATC》自定义机场文件（社区库 EndlessATC/Airports 的 example.txt）。
 * 单位：高度为英尺（altitude / floor / ceiling / above / elevation），距离为海里，
 *       长度（runways 的 length）为英尺；启动 speedrestriction 为「半径NM, 限速kt, 高度ft, 限速kt」。
 */

export const SAMPLE_ZUUU_TEXT = `
# 成都双流 ZUUU 示例位置文件（本项目自撰，示意数据）
# 用法：工具栏「导入 Endless ATC 机场」选择本文件，或点击「载入示例机场(ZUUU)」。
# 语法：# 起始为整行注释，值后可用 空格+; 追加注释；缩进行是上一条目的多行列表。

[airspace]
radius = 30                 ; 管制区半径（NM）
zoom = 6.5
elevation = 1624            ; 机场标高（英尺）
floor = 2000                ; 可指令最低高度（英尺）
descentaltitude = 5000      ; 进港初始高度下限
ceiling = 8000              ; 可指令最高高度
above = 12000               ; 离港最高高度（SID 启用时）
speedrestriction = 15, 220, 3000, 250
localizerspeed = 30, 200
diversionaltitude = 7000
transitionaltitude = 18000
separation = 3              ; 最小间隔（NM）→ 本项目冲突判定阈值
metric = true               ; 本项目以米显示高度
letters = 2
automatic = true
strictspawn = false
name = 成都进近, 成都区调
magneticvar = 0

beacons =
    CTU, -14, 6, 0, chengdu
    ZUUU, 0, 0, 0, shuangliu
    PDU, 12, -8, 0, pudong
    SAS, -6, -16, 0, sasan

boundary =
    -25, -23
    25, -23
    25, 24
    -25, 24

line1 =
    -22, 14
    -16, 9
    -9, 5
line2 =
    18, -14
    22, -9
    24, -4

handoff =
    090, 成都进近, chengdu approach, 120.35
    270, 成都区调, chengdu control, 128.7

[airport1]
name = 成都双流, chengdu
code = ZUUU
runways =
    rwy1, 02L, -5.2, 0.6, 20.0, 11800, 0, 0, 1624, 3, 20, 0, 0, CTU, 8.0, 0, 0, 118.85, tower
    rwy2, 02R, 2.4, 0.6, 20.0, 11800, 0, 0, 1624, 3, 20, 0, 0, CTU, 8.0, 0, 0, 118.85, tower
climbaltitude = 6000

sids =
    north, 0, 20, northbound
    south, 0, -20, southbound
    east, 20, 0, eastbound
    west, -20, 0, westbound

entrypoints =
    090, PDU, 8000
    180, SAS, 9000
    270, CTU, 8000
    360, CTU, 9000

airlines =
    cca, 3, a320/b738, air china
    csc, 3, a320/a330, sichuan
    ces, 2, a320/b738, china eastern
    csn, 2, a320/b738, china southern
    cq, 1, b777/e190, chongqing
    n-12345, 0.5, arj21

[area1]
shape = circle
altitude = 2000
radius = 10
position = 0, 0
labelpos = 10, 0

[area2]
shape = circle
altitude = 3500
radius = 20
position = 0, 0
labelpos = 20, 0

[configurations]
# 格式：分数门槛, 跑道标识, 用法（start=起飞 land=落地 rev=反向 int=交叉口 track=航迹 nosid=无SID）
# 分数门槛 = 该用法生效所需的最低「解锁分」（[scenario] 的 score 事件可设定，每落地一架 +1）
config1 =
    0, rwy1, landstart
    6, rwy2, landstart      ; 解锁分达到 6 后才开启第二跑道（02R）
config2 =
    0, rwy1, landstartrev
    0, rwy2, landstartrev

[departure1]
runway = rwy1
route1 =
    north, northbound
    0, 8
    0, 16
    4, 24
route2 =
    south, southbound
    0, -8
    0, -16

[approach1]
runway = rwy1
beacon = CTU, -14, 6, 0, chengdu
route1 =
    090, ctu1a, chengdu one alpha
    1, 10
    1, 16, 4000
    -3, 16, 0, 180
    10.5, 3000, 200
route2 =
    270, ctu1b, chengdu one bravo
    -1, 10
    -1, 16, 4000
    -3, 16, 0, 180
    10.5, 3000, 200

[planetypes]
types =
    a320, 4, 150, 250, 2.9, 3.1, 1400, 1600, 130, 140, 1.2, 1.3, airbus, 25, 30, 3, 5, 3900, 4200
    b777, 2, 170, 280, 2.7, 3.0, 1600, 1800, 145, 155, 1.3, 1.5, boeing, 25, 30, 3, 5, 4400, 4800

[scenario]
finish = 8, 1800

events =
    0, config, 1
    0, score, 5
    0, wind, 20, 8
    0, text, 成都双流 · 02L/02R 落地起飞
    0, elapse, 30
    0, arr, 090, PDU, a320, 8000, 5000, 250
    0, elapse, 60
    5, dep, rwy1, north, b738
    60, arr, 270, CTU, a330, 9000, 5000, 250
    120, dep, rwy2, north, a320

[background]
line1 =
    coast
    -20, 18
    -8, 22
    6, 20
    18, 14
line2 =
    airspace
    -3, -8
    3, -8
    3, -2
    -3, -2
    -3, -8
`;

/** 内置示例清单（导入面板/冒烟测试使用） */
export const LOCATION_SAMPLES = [
    { code: 'ZUUU', name: '成都双流（示例 · 02L/02R）', text: SAMPLE_ZUUU_TEXT }
];

export function sampleLocationText(code) {
    const s = LOCATION_SAMPLES.find(x => x.code === code);
    return s ? s.text : '';
}
