/**
 * game/zany.js — 结算搞怪内容（游戏层·v2.0 空管嘉年华）
 *
 * 主题医院式「一本正经地胡说八道」：结算不再只有评级，还有
 *   · 荒诞职称（按评级 + 表现封称号）
 *   · 乘客投诉信（按延误 / 告警 / 复诵失误生成，玩家可会心一笑）
 *   · 每日头条新闻（经营快照造句）
 * 另有一个班次中的「场间吐槽」ticker：随机播放雷达观测冷吐槽（纯调味，不影响任何数值）。
 *
 * 依赖方向：core(0) + 同层 game(3)；不碰 DOM（内容全部纯函数或 store 播报）。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { makeRng } from '../core/random.js';

/* ---------------- 荒诞职称 ---------------- */

const TITLES = {
    S: [
        { title: '雷达之神', sub: '飞机见了你都自动排队' },
        { title: '空中交警之王', sub: '两只海鸥为你鼓掌' },
        { title: '零告警传说', sub: '局方怀疑你开了预知外挂' }
    ],
    A: [
        { title: '好评率 99% 的金手指', sub: '剩下 1% 是那只不服管的鹅' },
        { title: '冷静的操作机器', sub: '领班想给你发小红花' },
        { title: '教科书级值班', sub: '你的班次已被隔壁单位偷学' }
    ],
    B: [
        { title: ' Mondays 综合症患者', sub: '不是错，只是有点周一' },
        { title: '咖啡因驱动型管制员', sub: '性能随咖啡余量波动' },
        { title: '差一口气的艺术家', sub: '再稳半拍就是传奇' }
    ],
    C: [
        { title: '雷达面前的人肉问号', sub: '飞机：你确定？我也不确定' },
        { title: '正在加载中的传奇', sub: '进度 12%，请勿断电' },
        { title: '被螃蟹欺负过的男人', sub: '但那不是你的错' }
    ],
    D: [
        { title: '地勤部在向你招手', sub: '他们说地面也需要梦想' },
        { title: '今日份空域喜剧主演', sub: '乘客表示像坐了三次过山车' },
        { title: '建议与领班促膝长饮', sub: '咖啡因与心理辅导双重套餐' }
    ]
};

/**
 * 荒诞职称（按评级抽一条；确定性：同班次同结果同称号用 seed 取模）。
 * @param {string} grade 评级 S/A/B/C/D
 * @param {number} [salt] 附加盐值（如 input 数），保证不同班次不同称号
 */
export function zanyTitle(grade, salt = 0) {
    const pool = TITLES[grade] || TITLES.D;
    const idx = Math.abs(Math.round(salt)) % pool.length;
    return pool[idx];
}

/* ---------------- 乘客投诉信 ---------------- */

/**
 * 乘客投诉信（按结算数据挑最扎心的一封）。
 * @param {{score:number, landed:number, avgDelaySec:number, separation:number,
 *          mva:number, goAround:number, readback:number, streak:number, grade:string}} result 结算结果
 * @returns {{from:string, title:string, text:string}}
 */
export function complaintLetter(result) {
    const r = result || {};
    if (r.grade === 'S') {
        return { from: '头等舱常旅客', title: '请求给你们涨工资', text: '本人环球飞行四十年，第一次遇到让飞机排队像 clockwork 的管制单位。随信附上锦旗一面，请务必收下。' };
    }
    if (r.goAround > 0) {
        return { from: '第二次进近的乘客', title: '关于免费过山车', text: '第一次复飞我理解，第二次复飞我开始怀疑我的降落仇恨值。落地后我吐在了三楼行李转盘上，请注意清理。' };
    }
    if (r.separation > 0) {
        return { from: '被迫当观众的两机乘客', title: '关于间距的艺术', text: '两架飞机贴得能看清对面机长在吃什么，我拍到了年度最佳合影。但请告诉我，间隔标准是拿尺子量过我这条命吗？' };
    }
    if (r.mva > 0) {
        return { from: '贴着山脊飞过的乘客', title: '关于低空观景项目', text: '我从舷窗数清了山下三户人家晾了几件衣服。景色绝美，代价是我的速效救心丸。建议将本航段列入景区线路。' };
    }
    if (r.readback > 0) {
        return { from: '旁听全程的耳机发烧友', title: '关于贵单位口音', text: '贵单位管制员复诵时漏参数的技艺炉火纯青，机长追问三遍的样子令人心碎。建议开设普通话等级考试，从塔台抓起。' };
    }
    if (r.avgDelaySec >= 120) {
        return { from: '赶婚礼的乘客', title: '关于我的泡面与婚礼', text: '延误 ' + r.avgDelaySec + ' 秒。我的泡面坨了，我表哥的婚礼走完了彩排，我错过的不只是一碗面，是亲情。' };
    }
    if (r.avgDelaySec >= 60) {
        return { from: '带娃旅行的妈妈', title: '关于娃的睡眠', text: '孩子登机时还醒着，现在睡了。落地时她又醒了。这一覺价值 ' + r.avgDelaySec + ' 秒，请折算成积分谢谢。' };
    }
    if (r.landed > 0) {
        return { from: '普通的乘客', title: '居然没什么可投诉的', text: '本来写好了三千字差评，结果一路平稳到有点无聊。这种人我会推荐给全部亲戚，真烦。' };
    }
    return { from: '匿名旅客', title: '关于本场次的存在感', text: '我飞进来又飞出去，你们好像根本没注意到我。这种被全世界路过的心情，你们懂吗？' };
}

/* ---------------- 每日头条 ---------------- */

/**
 * 每日荒诞头条（日结算播报用）。
 * @param {{day:number, grade?:string, landed?:number, reputation?:number, cash?:number}} info
 */
export function dailyHeadline(info) {
    const day = (info && info.day) || 1;
    const landed = (info && info.landed) || 0;
    const headlines = [
        `《空管奇谈》第 ${day} 日：本场昨日放行 ${landed} 架航班，零离谱事件，疑似周末综合症蔓延`,
        `本场第 ${day} 日晨会：领班强调「航班不会自己排队」，点名昨日值班员复诵三遍才能清醒`,
        `第 ${day} 日快讯：本场管制员咖啡消耗量再创新高，供应商已开通 VIP 通道`,
        `第 ${day} 日头条：昨日雷达屏疑现海鸥倒影，专家称系「生态视察」，已连续 ${day} 天准时出现`,
        `第 ${day} 日号外：本场航班排队秩序过好，被邻区怀疑安装了隐形交警`
    ];
    return headlines[(day - 1) % headlines.length];
}

/* ---------------- 场间吐槽 ticker ---------------- */

const FLAVOR_LINES = [
    '那只海鸥又回来视察跑道了，这是本周第七次。',
    '雷达屏角落有只蚊子在匀速巡航，暂不构成干扰。',
    '咖啡机第二次发出临终呼啸，维修工在打盹。',
    '隔壁领班又在给绿植讲间隔标准，绿植没有复诵。',
    '地勤对讲机里传来隐约的咀嚼声，用途不明。',
    '某航班申请「绕场一圈给丈母娘看看」，已婉拒。',
    '停机坪的鹅今天选择视察塔台而非飞机，形势略缓和。',
    '有人把口香糖粘在进程单托盘上，正在淡化处理。'
];

const FLAVOR_INTERVAL_SEC = 45;

let flavorRng = makeRng(20260101);
let lastFlavorAt = -Infinity;

/** 重置 ticker 计时（开班次时调用） */
export function resetZanyFlavor() {
    lastFlavorAt = -Infinity;
    flavorRng = makeRng((state.management && state.management.day ? state.management.day : 1) * 7907 + 13);
}

/* 开班重置 ticker（模块装载即接线，与 game/events.js 同一模式） */
bus.on(EV.SESSION_STARTED, resetZanyFlavor);

/** 日结算播报荒诞头条（经营层事件驱动，只写通话记录不改数值） */
bus.on(EV.DAY_SETTLED, (payload) => {
    const info = payload || {};
    const day = info.day || (state.management ? state.management.day : 1);
    const headline = dailyHeadline({
        day,
        landed: info.summary ? (info.summary.todayLanded || 0) : 0,
        reputation: state.management ? state.management.reputation : 0
    });
    addComm('atc', `📰 晨间号外：${headline}`);
});

/** 每模拟秒最多播报一条场间吐槽（仅播放中；纯调味） */
bus.on(EV.CLOCK_TICK, () => {
    if (!state.isPlaying) return;
    if (state.time - lastFlavorAt < FLAVOR_INTERVAL_SEC) return;
    lastFlavorAt = state.time;
    addComm('acc', `【场间】${FLAVOR_LINES[Math.floor(flavorRng() * FLAVOR_LINES.length)]}`);
});
