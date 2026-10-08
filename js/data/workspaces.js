/** 现场俯视图的示意布局；席位是否开放、人员是否值守由经营快照决定。 */
export const WORKSPACES = Object.freeze({
    tower: {
        id: 'tower', name: '塔台现场', short: 'TWR', view: 'TWR',
        brief: '目视观察跑道与机坪，协调起飞、落地和地面活动。',
        seats: [
            { code: 'TWR', x: 220, y: 285 }, { code: 'GND', x: 410, y: 285 },
            { code: 'CD', x: 600, y: 285 }, { code: 'SUP', x: 790, y: 285 },
            { code: 'APP', x: 310, y: 428 }
        ]
    },
    approach: {
        id: 'approach', name: '进近现场', short: 'APP', view: 'APP',
        brief: '监视进离场流量，完成排序、引导与进近协调。',
        seats: [
            { code: 'APP', x: 210, y: 255 }, { code: 'APP-W', x: 400, y: 255 },
            { code: 'APP-E', x: 590, y: 255 }, { code: 'NTZ', x: 780, y: 255 },
            { code: 'APP-ARR', x: 330, y: 418 }, { code: 'APP-DEP', x: 650, y: 418 }
        ]
    },
    area: {
        id: 'area', name: '区域现场', short: 'ACC', view: 'ACC',
        brief: '处理航路飞行、高度层配备和相邻管制单位移交。',
        seats: [
            { code: 'ACC', x: 245, y: 255 }, { code: 'ACC-N', x: 500, y: 255 },
            { code: 'ACC-S', x: 755, y: 255 }, { code: 'ACC-RDR', x: 500, y: 423 }
        ]
    }
});

export const WORKSPACE_ORDER = ['tower', 'approach', 'area'];
