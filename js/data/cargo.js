/**
 * data/cargo.js — 奇葩货物图鉴（数据层·只读常量）
 *
 * 航班货舱里到底装了什么是本作的重要悬念。每架航班按 flightNo 哈希
 * 确定性分配一件货物（不消耗随机源，因此同 seed 班次仍可复现）。
 *
 * 依赖方向：无（数据层叶子）。分配与播报逻辑见 game/cargo.js。
 */

/** 奇葩货物：icon 单字符徽面 / name 货物名 / line 落地播报的整活台词 */
export const CARGO = Object.freeze([
    { id: 'crabs', icon: '蟹', name: '200 只活螃蟹', line: '货舱门打开，200 只螃蟹正在举行越狱演习' },
    { id: 'panda', icon: '猫', name: '一只要升舱的国宝', line: '国宝对经济舱座椅表示强烈不满，已开启静坐抗议' },
    { id: 'granny', icon: '唱', name: '广场舞大妈合唱团', line: '大妈们巡航高度开演唱会，曲目《好日子》' },
    { id: 'husky', icon: '狗', name: '追无人机的哈士奇', line: '二哈同志全程贴着舷窗追无人机，尾巴扫倒三杯咖啡' },
    { id: 'spicy', icon: '辣', name: '十箱辣条', line: '辣条开封瞬间全舱欢呼，发动机噪声被完全覆盖' },
    { id: 'ufo', icon: 'U', name: '一货盘 UFO 纪念品', line: '副驾驶坚称货盘里飞出个飞碟，全机组正在拍照' },
    { id: 'snake', icon: '蛇', name: '一条越狱蟒蛇', line: '蟒蛇从货舱夹层探出头，地勤抄网待命' },
    { id: 'hotpot', icon: '锅', name: '三百份自热火锅', line: '三百份火锅同时加热，机舱能见度下降' },
    { id: 'mascot', icon: '鹅', name: '一只巡视舱门的鹅', line: '大白鹅大摇大摆巡视舱门，空乘不敢拦' },
    { id: 'rocket', icon: '箭', name: '模型火箭套装', line: '某小朋友拆开了模型火箭，家长正在道歉' },
    { id: 'moon', icon: '月', name: '一吨月饼', line: '中秋备货一吨月饼，货舱弥漫五仁气息' },
    { id: 'durian', icon: '榴', name: '整板的榴莲', line: '整板榴莲起飞，客舱谣言四起' },
    { id: 'pigeon', icon: '鸽', name: '赛鸽三千羽', line: '三千羽赛鸽起飞，塔台窗户砰砰作响' },
    { id: 'fish', icon: '鱼', name: '一池活鱼', line: '活鱼池水位晃动，机组报告"疑似轻度海浪"' },
    { id: 'robot', icon: '机', name: '送货机器人原型机', line: '原型机在货舱里循环播放"请给我让路"' },
    { id: 'gold', icon: '金', name: '一箱金条', line: '金条箱贴了张纸条"真的很沉"，搬班长腰复发' },
    { id: 'noodles', icon: '面', name: '速食面专机', line: '全机方便面，落地后三家超市打来感谢电话' },
    { id: 'tea', icon: '茶', name: '十万杯奶茶', line: '十万杯奶茶同时摇晃，怀疑货舱在开派对' },
    { id: 'costume', icon: '偶', name: '玩偶服军团', line: '一舱玩偶服在巡航高度集体睁眼' },
    { id: 'secrets', icon: '箱', name: '贴着"易碎"的铁锤', line: '贴满"易碎"标签的箱子里传出叮当声' },
    { id: 'fireworks', icon: '花', name: '哑火的焰火', line: '焰火在货舱里哑火又复燃，机长申请心理疏导' },
    { id: 'cake', icon: '糕', name: '三层婚礼蛋糕', line: '婚礼蛋糕完好无损，新人专程来塔台致谢' },
    { id: 'medal', icon: '奖', name: '一箱锦旗', line: '箱上写着"赠：从不延误的管制员"，你值得拥有' },
    { id: 'nothing', icon: '空', name: '什么也没有', line: '货舱空空如也，只有一张"下次一定"的纸条' }
]);

/** 航班号 → 稳定哈希（不消耗随机源，同航班号永远同一件货物） */
function cargoIndex(flightNo) {
    let h = 2166136261;
    const s = String(flightNo || 'AC');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % CARGO.length;
}

/**
 * 取（并记忆）一架航班的货物；同一航班重复调用结果一致。
 * @param {{flightNo:string, cargo?:object}} ac 航空器
 * @returns {{id:string,icon:string,name:string,line:string}}
 */
export function cargoFor(ac) {
    if (!ac) return null;
    if (ac.cargo && ac.cargo.id) return ac.cargo;
    const picked = CARGO[cargoIndex(ac.flightNo)];
    ac.cargo = picked;
    return picked;
}
