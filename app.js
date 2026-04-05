(function () {
    'use strict';

    const canvas = document.getElementById('radar-canvas');
    const ctx = canvas.getContext('2d');

    let canvasWidth, canvasHeight;
    let centerX, centerY;

    let viewOffsetX = 0;
    let viewOffsetY = 0;
    let viewScale = 1;

    function resizeCanvas() {
        const container = document.getElementById('radar-container');
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * devicePixelRatio;
        canvas.height = rect.height * devicePixelRatio;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(devicePixelRatio, devicePixelRatio);
        canvasWidth = rect.width;
        canvasHeight = rect.height;
        centerX = canvasWidth / 2;
        centerY = canvasHeight / 2;
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const state = {
        routePoints: [],
        routes: [],
        aircraft: [],
        connections: [],
        distanceLines: [],
        time: 0,
        timeSpeed: 1,
        isPlaying: false,
        currentTool: 'select',
        selectedItem: null,
        editingPointId: null,
        editingRouteId: null,
        editingAircraftId: null,
        commMessages: [],
        routeConnectPoints: [],
        routeConnectMode: false,
        isDraggingFromPalette: false,
        paletteDragType: null,
        paletteDragSubType: null,
        baseTime: 0,
        basePositions: {},
        pointNameCounter: 1,
        draggingLabelAc: null,
        labelOffsets: {},
        targetSelectMode: null,
        tempTargetPoint: null,
        pendingNextWaypointSelection: null,  // 等待用户选择下一航路点的飞机信息
        isPausedForWaypointSelection: false  // 是否因选择航路点而暂停
    };

    let lastTime = performance.now();
    let tempMeasureLine = null;
    let draggingPoint = null;
    let dragPointOffsetX = 0;
    let dragPointOffsetY = 0;
    let draggingAc = null;
    let dragAcOffsetX = 0;
    let dragAcOffsetY = 0;
    let labelFollowMouse = null;

    function getPixelsPerKm() { return Math.min(canvasWidth, canvasHeight) / 500 * viewScale; }
    function kmToPx(km) { return km * getPixelsPerKm(); }
    function pxToKm(px) { return px / getPixelsPerKm(); }
    function pxToKmFixed(px) { return px / (Math.min(canvasWidth, canvasHeight) / 500); }

    function toWorldX(screenX) {
        return (screenX - canvasWidth / 2 - viewOffsetX) / viewScale + centerX;
    }
    function toWorldY(screenY) {
        return (screenY - canvasHeight / 2 - viewOffsetY) / viewScale + centerY;
    }
    function toScreenX(worldX) {
        return (worldX - centerX) * viewScale + canvasWidth / 2 + viewOffsetX;
    }
    function toScreenY(worldY) {
        return (worldY - centerY) * viewScale + canvasHeight / 2 + viewOffsetY;
    }

    function isEditMode() { return !state.isPlaying; }

    function updateEditModeUI() {
        const playIndicator = document.getElementById('play-indicator');
        const addBtns = document.querySelectorAll('.add-btn, .edit-btn, .route-btn, .settings-btn, #tool-delete');
        const paletteItems = document.querySelectorAll('.draggable-item');

        if (state.isPlaying) {
            playIndicator.classList.remove('hidden');
            addBtns.forEach(btn => {
                btn.classList.add('edit-disabled');
                btn.style.pointerEvents = 'none';
            });
            paletteItems.forEach(item => {
                item.classList.add('edit-disabled');
                item.style.pointerEvents = 'none';
            });
        } else {
            playIndicator.classList.add('hidden');
            addBtns.forEach(btn => {
                btn.classList.remove('edit-disabled');
                btn.style.pointerEvents = '';
            });
            paletteItems.forEach(item => {
                item.classList.remove('edit-disabled');
                item.style.pointerEvents = '';
            });
        }
    }

    function saveBasePositions() {
        state.basePositions = {};
        state.aircraft.forEach(ac => {
            state.basePositions[ac.id] = {
                x: ac.displayX !== undefined ? ac.displayX : ac.x,
                y: ac.displayY !== undefined ? ac.displayY : ac.y,
                heading: ac.heading || 90,
                routeDistance: ac.routeDistance || 0,
                navMode: ac.navMode || 'heading',
                targetX: ac.targetX,
                targetY: ac.targetY,
                nextWaypointIdx: ac.nextWaypointIdx
            };
        });
        state.baseTime = state.time;
    }

    function calculateAircraftPositionAtTime(ac, targetTime) {
        const acStartTime = ac.startTime || 0;

        if (targetTime < acStartTime) {
            return { visible: false, x: ac.x, y: ac.y, heading: ac.heading || 90 };
        }

        const speedKmPerSec = ((ac.speed || state.defaults.speed) * 0.00051444) * 1.852;
        const pixelsPerKm = getPixelsPerKm();

        if (ac.navMode === 'free' && ac.targetX !== undefined && ac.targetY !== undefined) {
            const startX = ac.x;
            const startY = ac.y;
            const timeFromStart = targetTime - acStartTime;
            const distPx = speedKmPerSec * timeFromStart * pixelsPerKm;

            const dx = ac.targetX - startX;
            const dy = ac.targetY - startY;
            const totalDist = Math.sqrt(dx * dx + dy * dy);
            const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
            if (heading < 0) heading += 360;

            if (distPx >= totalDist && totalDist > 0) {
                return { visible: true, x: ac.targetX, y: ac.targetY, heading: heading };
            }

            const ratio = totalDist > 0 ? distPx / totalDist : 0;
            return {
                visible: true,
                x: startX + dx * ratio,
                y: startY + dy * ratio,
                heading: heading
            };
        }

        if (!ac.routeId) {
            const heading = ac.heading || 90;
            const startX = ac.x;
            const startY = ac.y;
            const timeFromStart = targetTime - acStartTime;
            const headRad = (heading - 90) * Math.PI / 180;
            const distPx = speedKmPerSec * timeFromStart * pixelsPerKm;
            return {
                visible: true,
                x: startX + Math.cos(headRad) * distPx,
                y: startY - Math.sin(headRad) * distPx,
                heading: heading
            };
        }

        const route = state.routes.find(r => r.id === ac.routeId);
        if (!route || route.points.length < 2) {
            return { visible: true, x: ac.x, y: ac.y, heading: ac.heading || 90 };
        }

        let totalLen = 0, segLengths = [];
        for (let i = 1; i < route.points.length; i++) {
            const dx = route.points[i].x - route.points[i - 1].x;
            const dy = route.points[i].y - route.points[i - 1].y;
            const len = Math.sqrt(dx * dx + dy * dy);
            segLengths.push(len);
            totalLen += len;
        }
        if (totalLen === 0) {
            return { visible: true, x: route.points[0].x, y: route.points[0].y, heading: ac.heading || 90 };
        }

        const timeFromStart = targetTime - acStartTime;
        const distanceMoved = speedKmPerSec * timeFromStart * pixelsPerKm;

        let startX = ac.x;
        let startY = ac.y;

        let targetIdx = ac.nextWaypointIdx !== undefined ? ac.nextWaypointIdx : -1;
        if (targetIdx < 0 || targetIdx >= route.points.length) {
            let minDist = Infinity;
            for (let i = 0; i < route.points.length; i++) {
                const dx = route.points[i].x - startX, dy = route.points[i].y - startY;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDist) { minDist = d; targetIdx = i; }
            }
        }

        let remainingDist = distanceMoved;
        let currentX = startX, currentY = startY;
        let currentIdx = -1;  // 当前所在航路点索引（-1表示不在任何航路点上）
        let nextIdx = targetIdx;  // 下一个要飞往的航路点索引
        let cameFromIdx = -1;  // 记录从哪个点飞来的

        while (remainingDist > 0.001 && nextIdx >= 0 && nextIdx < route.points.length) {
            const targetPt = route.points[nextIdx];
            const dx = targetPt.x - currentX, dy = targetPt.y - currentY;
            const distToTarget = Math.sqrt(dx * dx + dy * dy);

            // 如果剩余距离不足以到达目标点，则在当前路段上插值
            if (remainingDist <= distToTarget) {
                const ratio = distToTarget > 0 ? remainingDist / distToTarget : 0;
                const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
                return {
                    visible: true,
                    x: currentX + dx * ratio,
                    y: currentY + dy * ratio,
                    heading: heading < 0 ? heading + 360 : heading
                };
            }

            // 到达目标航路点
            remainingDist -= distToTarget;
            currentX = targetPt.x;
            currentY = targetPt.y;

            // 确定来向：如果currentIdx为-1（起始位置），根据飞机所在航段和目标点关系推断来向
            if (currentIdx === -1) {
                // 找到飞机所在的当前航段
                let currentSegmentIdx = -1;
                let minDistToSegment = Infinity;

                for (let i = 0; i < route.points.length - 1; i++) {
                    const dist = pointToSegmentDist(startX, startY, route.points[i], route.points[i + 1]);
                    if (dist < minDistToSegment) {
                        minDistToSegment = dist;
                        currentSegmentIdx = i;
                    }
                }

                // 根据当前航段和目标点判断来向
                // 如果目标点在当前航段的"前方"（索引大于航段终点），说明是从前序方向飞来的
                // 如果目标点在当前航段的"后方"（索引小于航段起点），说明是从后序方向飞来的
                if (currentSegmentIdx >= 0 && currentSegmentIdx < route.points.length - 1) {
                    const segStartIdx = currentSegmentIdx;
                    const segEndIdx = currentSegmentIdx + 1;

                    if (targetIdx > segEndIdx) {
                        // 目标在航段前方（更大索引），飞机是从segStart方向飞来的
                        cameFromIdx = segStartIdx;
                    } else if (targetIdx < segStartIdx) {
                        // 目标在航段后方（更小索引），飞机是从segEnd方向飞来的
                        cameFromIdx = segEndIdx;
                    } else {
                        // 目标在当前航段上或附近，根据几何位置判断
                        if (targetIdx === segEndIdx) {
                            // 目标是航段终点，飞机是从segStart方向飞来的
                            cameFromIdx = segStartIdx;
                        } else if (targetIdx === segStartIdx) {
                            // 目标是航段起点，飞机是从segEnd方向飞来的
                            cameFromIdx = segEndIdx;
                        } else {
                            // 目标在航段中间，用距离判断
                            const prevPt = route.points[targetIdx - 1];
                            const postPt = route.points[targetIdx + 1];
                            const distToPrev = Math.sqrt((startX - prevPt.x) ** 2 + (startY - prevPt.y) ** 2);
                            const distToPost = Math.sqrt((startX - postPt.x) ** 2 + (startY - postPt.y) ** 2);
                            cameFromIdx = distToPost < distToPrev ? targetIdx + 1 : targetIdx - 1;
                        }
                    }
                } else if (route.points.length > 1) {
                    // 在某个点附近，用距离判断
                    const prevPt = route.points[Math.max(0, targetIdx - 1)];
                    const postPt = route.points[Math.min(route.points.length - 1, targetIdx + 1)];
                    const distToPrev = Math.sqrt((startX - prevPt.x) ** 2 + (startY - prevPt.y) ** 2);
                    const distToPost = Math.sqrt((startX - postPt.x) ** 2 + (startY - postPt.y) ** 2);
                    cameFromIdx = distToPost < distToPrev ? targetIdx + 1 : targetIdx - 1;
                }
            } else {
                cameFromIdx = currentIdx;
            }
            currentIdx = nextIdx;

            // 确定下一个航路点
            const prevIdx = currentIdx - 1;
            const postIdx = currentIdx + 1;

            // 核心逻辑：根据来向决定去向，不折返
            // cameFromIdx表示飞机是从哪个节点飞来的
            // currentIdx表示当前到达的节点索引
            // 例如：从P3飞往P4，则cameFromIdx=2, currentIdx=3

            // 判断是否是第一个节点或最后一个节点
            const isFirstNode = currentIdx === 0;
            const isLastNode = currentIdx === route.points.length - 1;

            // 如果到达最后一个节点且是从前序方向飞来，继续沿延长线飞
            if (isLastNode && cameFromIdx < currentIdx) {
                nextIdx = -1; // 继续沿延长线，不折返
            }
            // 如果到达第一个节点且是从后序方向飞来，继续沿延长线飞
            else if (isFirstNode && cameFromIdx > currentIdx) {
                nextIdx = -1; // 继续沿延长线，不折返
            }
            // 普通情况：根据来向决定下一节点
            else if (cameFromIdx > currentIdx) {
                // 从后序方向飞来，继续飞往前序点
                if (prevIdx >= 0) {
                    nextIdx = prevIdx;
                } else {
                    nextIdx = -1;
                }
            } else if (cameFromIdx < currentIdx) {
                // 从前序方向飞来，继续飞向后序点
                if (postIdx < route.points.length) {
                    nextIdx = postIdx;
                } else {
                    nextIdx = -1;
                }
            } else {
                // 无法确定来向
                if (postIdx < route.points.length) {
                    nextIdx = postIdx;
                } else if (prevIdx >= 0) {
                    nextIdx = prevIdx;
                } else {
                    nextIdx = -1;
                }
            }

            // 如果没有下一航路点，继续沿当前航向飞行（不折返）
            if (nextIdx < 0 || nextIdx >= route.points.length || nextIdx === currentIdx) {
                let heading;
                let moveDx = 0, moveDy = 0;
                if (cameFromIdx >= 0 && cameFromIdx < route.points.length) {
                    const pFrom = route.points[cameFromIdx];
                    const dx = currentX - pFrom.x;
                    const dy = currentY - pFrom.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 0.001) {
                        moveDx = dx / dist;
                        moveDy = dy / dist;
                        heading = Math.atan2(dx, -dy) * 180 / Math.PI;
                    } else {
                        heading = ac.heading || 90;
                        const headRad = (heading - 90) * Math.PI / 180;
                        moveDx = Math.cos(headRad);
                        moveDy = -Math.sin(headRad);
                    }
                } else {
                    heading = ac.heading || 90;
                    const headRad = (heading - 90) * Math.PI / 180;
                    moveDx = Math.cos(headRad);
                    moveDy = -Math.sin(headRad);
                }
                if (heading < 0) heading += 360;
                return { visible: true, x: currentX + moveDx * remainingDist, y: currentY + moveDy * remainingDist, heading };
            }
        }

        // 如果还有剩余距离没处理完（航线遍历完毕但还有距离），继续沿当前航向飞行
        if (remainingDist > 0.001) {
            let heading;
            let moveDx = 0, moveDy = 0;
            if (cameFromIdx >= 0 && cameFromIdx < route.points.length) {
                const pFrom = route.points[cameFromIdx];
                const dx = currentX - pFrom.x;
                const dy = currentY - pFrom.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0.001) {
                    moveDx = dx / dist;
                    moveDy = dy / dist;
                    heading = Math.atan2(dx, -dy) * 180 / Math.PI;
                } else {
                    heading = ac.heading || 90;
                    const headRad = (heading - 90) * Math.PI / 180;
                    moveDx = Math.cos(headRad);
                    moveDy = -Math.sin(headRad);
                }
            } else {
                heading = ac.heading || 90;
                const headRad = (heading - 90) * Math.PI / 180;
                moveDx = Math.cos(headRad);
                moveDy = -Math.sin(headRad);
            }
            if (heading < 0) heading += 360;
            return { visible: true, x: currentX + moveDx * remainingDist, y: currentY + moveDy * remainingDist, heading };
        }

        const targetPt = route.points[nextIdx] || route.points[0];
        const dx = targetPt.x - currentX, dy = targetPt.y - currentY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ratio = dist > 0 ? Math.min(1, distanceMoved / dist) : 0;
        const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
        return { visible: true, x: currentX + dx * ratio, y: currentY + dy * ratio, heading: heading < 0 ? heading + 360 : heading };
    }

    function updateAircraftPositionsForTime(targetTime) {
        state.aircraft.forEach(ac => {
            const pos = calculateAircraftPositionAtTime(ac, targetTime);
            ac.displayX = pos.x;
            ac.displayY = pos.y;
            ac.displayHeading = pos.heading;
            ac._visible = pos.visible;
        });
    }

    function drawRadar() {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        ctx.save();
        ctx.translate(canvasWidth / 2 + viewOffsetX, canvasHeight / 2 + viewOffsetY);
        ctx.scale(viewScale, viewScale);
        ctx.translate(-centerX, -centerY);

        drawMapBackground();
        drawGrid();
        drawRouteSegments();
        drawRoutePoints();
        drawConnections();
        drawDistanceLines();
        drawAircraftWarnings();
        drawAircraft();
        drawFreeNavTargets();
        drawMeasuringPreview();
        drawConnectionPreview();

        ctx.restore();

        drawModeIndicator();
    }

    function drawMapBackground() {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-10000, -10000, 20000, 20000);
    }

    function drawGrid() {
        const pixelsPerKm = getPixelsPerKm();
        ctx.strokeStyle = 'rgba(180,190,200,0.2)';
        ctx.lineWidth = 0.5;
        for (let x = -10000; x < 10000; x += pixelsPerKm * 10) {
            ctx.beginPath(); ctx.moveTo(x, -10000); ctx.lineTo(x, 10000); ctx.stroke();
        }
        for (let y = -10000; y < 10000; y += pixelsPerKm * 10) {
            ctx.beginPath(); ctx.moveTo(-10000, y); ctx.lineTo(10000, y); ctx.stroke();
        }
    }

    const POINT_COLORS = {
        normal: '#2563eb',
        intersection: '#9333ea',
        vor: '#dc2626',
        navaid: '#16a34a',
        reporting: '#ea580c'
    };
    const POINT_LABELS = {
        normal: '',
        intersection: '✕',
        vor: '◎',
        navaid: '△',
        reporting: '◇'
    };

    function drawRouteSegments() {
        state.routes.forEach(route => {
            if (route.points.length < 2) return;
            ctx.save();
            ctx.strokeStyle = route.color || '#2563eb';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(route.points[0].x, route.points[0].y);
            for (let i = 1; i < route.points.length; i++) ctx.lineTo(route.points[i].x, route.points[i].y);
            ctx.stroke();

            ctx.shadowColor = route.color || '#2563eb';
            ctx.shadowBlur = 3;
            ctx.strokeStyle = (route.color || '#2563eb') + '22';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(route.points[0].x, route.points[0].y);
            for (let i = 1; i < route.points.length; i++) ctx.lineTo(route.points[i].x, route.points[i].y);
            ctx.stroke();
            ctx.shadowBlur = 0;

            for (let i = 1; i < route.points.length; i++) {
                const p1 = route.points[i - 1], p2 = route.points[i];
                const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const segLenKm = pxToKmFixed(Math.sqrt(dx * dx + dy * dy));
                const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
                const headingNorm = heading < 0 ? heading + 360 : heading;
                ctx.fillStyle = 'rgba(60,90,130,0.5)';
                ctx.font = '8px Consolas';
                ctx.fillText(`${Math.round(segLenKm)}km ${Math.round(headingNorm)}°`, midX + 4, midY - 4);
            }

            if (state.selectedItem && state.selectedItem.type === 'route' && state.selectedItem.id === route.id) {
                ctx.strokeStyle = '#ff6600';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(route.points[0].x, route.points[0].y);
                for (let i = 1; i < route.points.length; i++) ctx.lineTo(route.points[i].x, route.points[i].y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
        });
    }

    function drawRoutePoints() {
        state.routePoints.forEach(pt => {
            const color = POINT_COLORS[pt.type] || POINT_COLORS.normal;
            const isSelected = state.selectedItem && state.selectedItem.type === 'point' && state.selectedItem.id === pt.id;
            const isConnectMode = state.routeConnectMode && state.routeConnectPoints.includes(pt.id);

            ctx.save();
            if (isSelected) {
                ctx.shadowColor = '#ff6600';
                ctx.shadowBlur = 10;
            }

            ctx.fillStyle = isConnectMode ? '#16a34a' : color;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            const r = isSelected ? 8 : 6;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            if (pt.type !== 'normal') {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 8px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(POINT_LABELS[pt.type] || '', pt.x, pt.y);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
            }

            ctx.fillStyle = color;
            ctx.font = 'bold 9px Consolas';
            ctx.fillText(pt.name || `P${pt.id}`, pt.x + 8, pt.y - 6);

            if (isSelected) {
                ctx.strokeStyle = '#ff6600';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 11, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
        });
    }

    function drawAircraft() {
        state.aircraft.forEach(ac => {
            const acStartTime = ac.startTime || 0;
            if (state.time < acStartTime) return;
            if (ac._visible === false) return;

            const x = ac.displayX !== undefined ? ac.displayX : ac.x;
            const y = ac.displayY !== undefined ? ac.displayY : ac.y;
            const heading = ac.displayHeading !== undefined ? ac.displayHeading : (ac.heading || 90);
            const headRad = (heading - 90) * Math.PI / 180;
            const isWarning = isAircraftInConflictAt(x, y, ac.id);
            const isSelected = state.selectedItem && state.selectedItem.type === 'aircraft' && state.selectedItem.id === ac.id;

            const trailLengthKm = 5;
            const trailPixels = kmToPx(trailLengthKm);
            const speedKmPerSec = ((ac.speed || 480) * 0.00051444) * 1.852;
            const trailPoints = Math.min(20, Math.max(5, Math.round(trailPixels / (speedKmPerSec * 0.5 * getPixelsPerKm()))));

            if (ac.trail && ac.trail.length > 1) {
                ctx.save();
                ctx.strokeStyle = isSelected ? 'rgba(0,100,0,0.4)' : 'rgba(100,120,180,0.3)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 4]);
                ctx.lineCap = 'round';
                ctx.beginPath();

                const startIdx = Math.max(0, ac.trail.length - trailPoints);
                ctx.moveTo(ac.trail[startIdx].x, ac.trail[startIdx].y);
                for (let i = startIdx + 1; i < ac.trail.length; i++) {
                    ctx.lineTo(ac.trail[i].x, ac.trail[i].y);
                }
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(headRad);

            if (isWarning) {
                ctx.shadowColor = '#ff0000';
                ctx.shadowBlur = 14;
            } else if (isSelected) {
                ctx.shadowColor = '#006400';
                ctx.shadowBlur = 10;
            } else {
                ctx.shadowColor = '#00000022';
                ctx.shadowBlur = 3;
            }

            ctx.fillStyle = isWarning ? '#ff2222' : (isSelected ? '#006400' : '#1a1a2e');
            ctx.strokeStyle = isWarning ? '#ff6666' : (isSelected ? '#228b22' : '#334155');
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(14, 0);
            ctx.lineTo(-8, -7);
            ctx.lineTo(-4, 0);
            ctx.lineTo(-8, 7);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isWarning ? '#ffaaaa' : '#94a3b8';
            ctx.beginPath();
            ctx.arc(-2, 0, 2.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            ctx.save();
            const labelColor = isWarning ? '#ff3333' : (isSelected ? '#006400' : '#16a34a');
            const bgColor = isWarning ? 'rgba(255,0,0,0.15)' : (isSelected ? 'rgba(0,100,0,0.12)' : 'rgba(255,255,255,0.85)');
            const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
            const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;

            const labelX = x + labelOffsetX;
            const labelY = y + labelOffsetY;

            ctx.font = `bold ${10 / viewScale}px Consolas`;
            const line1 = ac.flightNo || `AC${ac.id}`;
            const line2 = `${ac.altitude}m ${ac.speed}kt`;
            const line3 = ac.acType || '';
            const line4 = ac.destination ? `→ ${ac.destination}` : '';
            const lw1 = ctx.measureText(line1).width / viewScale;
            const lw2 = ctx.measureText(line2).width / viewScale;
            const lw3 = ctx.measureText(line3).width / viewScale;
            const lw4 = ctx.measureText(line4).width / viewScale;
            const boxW = Math.max(lw1, lw2, lw3, lw4) + 8 / viewScale;
            const boxH = (line4 ? 54 : 44) / viewScale;

            const corners = [
                { x: labelX, y: labelY },
                { x: labelX + boxW, y: labelY },
                { x: labelX, y: labelY + boxH },
                { x: labelX + boxW, y: labelY + boxH }
            ];
            let nearestCorner = corners[0];
            let minDist = Infinity;
            for (const c of corners) {
                const d = Math.sqrt((c.x - x) ** 2 + (c.y - y) ** 2);
                if (d < minDist) { minDist = d; nearestCorner = c; }
            }

            ctx.strokeStyle = isSelected ? '#00640088' : 'rgba(100,120,180,0.4)';
            ctx.lineWidth = 0.5 / viewScale;
            ctx.setLineDash([2 / viewScale, 2 / viewScale]);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(nearestCorner.x, nearestCorner.y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = bgColor;
            ctx.fillRect(labelX, labelY, boxW, boxH);
            ctx.strokeStyle = isWarning ? '#ff6666' : (isSelected ? '#228b22' : '#64748b');
            ctx.lineWidth = 0.5 / viewScale;
            ctx.strokeRect(labelX, labelY, boxW, boxH);

            ctx.fillStyle = labelColor;
            ctx.fillText(line1, labelX + 3 / viewScale, labelY + 12 / viewScale);
            ctx.font = `${8 / viewScale}px Consolas`;
            ctx.fillStyle = isWarning ? '#ff6666' : (isSelected ? '#228b22' : '#64748b');
            ctx.fillText(line2, labelX + 3 / viewScale, labelY + 24 / viewScale);
            ctx.fillText(line3, labelX + 3 / viewScale, labelY + 36 / viewScale);
            if (line4) ctx.fillText(line4, labelX + 3 / viewScale, labelY + 48 / viewScale);

            if (isSelected) {
                ctx.strokeStyle = '#006400';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 2]);
                ctx.beginPath();
                ctx.arc(x, y, 18, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
        });
    }

    function isAircraftInConflictAt(x, y, altitude, acId) {
        const thresholdPx = kmToPx(state.defaults.minSeparationNm);
        const altThreshold = 300;
        for (const other of state.aircraft) {
            if (other.id === acId) continue;
            if (state.time < (other.startTime || 0)) continue;
            if (Math.abs(other.altitude - altitude) > altThreshold) continue;
            const ox = other.displayX !== undefined ? other.displayX : other.x;
            const oy = other.displayY !== undefined ? other.displayY : other.y;
            const dx = ox - x, dy = oy - y;
            if (Math.sqrt(dx * dx + dy * dy) < thresholdPx) return true;
        }
        return false;
    }

    function isAircraftInConflict(ac) {
        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;
        return isAircraftInConflictAt(x, y, ac.altitude, ac.id);
    }

    function drawAircraftWarnings() {
        const thresholdPx = kmToPx(state.defaults.minSeparationNm);
        const altThreshold = 300;
        for (let i = 0; i < state.aircraft.length; i++) {
            for (let j = i + 1; j < state.aircraft.length; j++) {
                const a = state.aircraft[i], b = state.aircraft[j];
                if (state.time < (a.startTime || 0) || state.time < (b.startTime || 0)) continue;
                if (Math.abs(a.altitude - b.altitude) > altThreshold) continue;

                const ax = a.displayX !== undefined ? a.displayX : a.x;
                const ay = a.displayY !== undefined ? a.displayY : a.y;
                const bx = b.displayX !== undefined ? b.displayX : b.x;
                const by = b.displayY !== undefined ? b.displayY : b.y;

                const dx = bx - ax, dy = by - ay;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < thresholdPx) {
                    const alpha = Math.max(0.1, 0.5 - dist / thresholdPx * 0.4);
                    ctx.save();
                    ctx.strokeStyle = `rgba(255,50,50,${alpha})`;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(ax, ay);
                    ctx.lineTo(bx, by);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    const midX = (ax + bx) / 2, midY = (ay + by) / 2;
                    ctx.fillStyle = `rgba(220,40,40,${alpha + 0.2})`;
                    ctx.font = 'bold 9px Consolas';
                    ctx.fillText('⚠', midX + 2, midY - 3);
                    ctx.restore();
                }
            }
        }
    }

    function animate(currentTime) {
        const dt = (currentTime - lastTime) / 1000;
        lastTime = currentTime;
        if (state.isPlaying) {
            state.time += dt * state.timeSpeed;
            if (state.time > state.defaults.timeMax) state.time = 0;
            updateTimeDisplay();
            updateAircraftPositionsForTime(state.time);
            updateTrails(dt);
            updateProgressList();
        }
        drawRadar();
        requestAnimationFrame(animate);
    }

    function updateTrails(dt) {
        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;
            if (!ac.trail) ac.trail = [];

            const x = ac.displayX !== undefined ? ac.displayX : ac.x;
            const y = ac.displayY !== undefined ? ac.displayY : ac.y;

            if (ac.trail.length === 0 ||
                Math.sqrt((x - ac.trail[ac.trail.length - 1].x) ** 2 + (y - ac.trail[ac.trail.length - 1].y) ** 2) > 2) {
                ac.trail.push({ x, y });
            }

            const maxTrail = 30;
            if (ac.trail.length > maxTrail) ac.trail.shift();
        });
    }

    function updateTimeDisplay() {
        const h = Math.floor(state.time / 3600).toString().padStart(2, '0');
        const m = Math.floor((state.time % 3600) / 60).toString().padStart(2, '0');
        const s = Math.floor(state.time % 60).toString().padStart(2, '0');
        document.getElementById('time-display').textContent = `${h}:${m}:${s}`;
        const slider = document.getElementById('time-slider');
        slider.max = state.defaults.timeMax;
        slider.value = state.time;
    }

    function getWaypointInfoForAircraft(ac) {
        if (!ac.routeId) return null;
        const route = state.routes.find(r => r.id === ac.routeId);
        if (!route || route.points.length < 2) return null;

        let totalLen = 0, segLengths = [];
        for (let i = 1; i < route.points.length; i++) {
            const dx = route.points[i].x - route.points[i - 1].x;
            const dy = route.points[i].y - route.points[i - 1].y;
            segLengths.push(Math.sqrt(dx * dx + dy * dy));
            totalLen += segLengths[segLengths.length - 1];
        }

        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;

        let minDist = Infinity, nearestIdx = 0;
        for (let i = 0; i < route.points.length; i++) {
            const dx = route.points[i].x - x, dy = route.points[i].y - y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) { minDist = d; nearestIdx = i; }
        }

        const pt = route.points[nearestIdx];
        const ptName = pt.name || `P${pt.id}`;
        const distKm = pxToKm(minDist);

        return {
            nextPointName: ptName,
            nextPointIdx: nearestIdx + 1,
            totalPoints: route.points.length,
            distance: Math.round(distKm)
        };
    }

    function updateProgressList() {
        const container = document.getElementById('progress-list');
        const containerOverlay = document.getElementById('progress-list-overlay');
        container.innerHTML = '';
        if (containerOverlay) containerOverlay.innerHTML = '';

        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;

            const div = document.createElement('div');
            div.className = 'progress-item';
            const route = ac.routeId ? state.routes.find(r => r.id === ac.routeId) : null;
            const navMode = ac.navMode || (ac.routeId ? 'route' : 'heading');
            let modeText = '';
            if (navMode === 'free' && ac.targetX !== undefined) {
                const x = ac.displayX !== undefined ? ac.displayX : ac.x;
                const y = ac.displayY !== undefined ? ac.displayY : ac.y;
                const distPx = Math.sqrt((ac.targetX - x) ** 2 + (ac.targetY - y) ** 2);
                modeText = ` | 🎯直飞(${pxToKmFixed(distPx).toFixed(1)}km)`;
            } else if (navMode === 'route') {
                const routeName = route ? route.name : '';
                modeText = ` | 🔗${routeName}`;
            } else {
                modeText = ` | 🧭航向${Math.round(ac.heading || 0)}°`;
            }
            const isSelected = state.selectedItem && state.selectedItem.type === 'aircraft' && state.selectedItem.id === ac.id;

            let waypointInfo = '';
            if (navMode === 'route' && route) {
                const wpInfo = getWaypointInfoForAircraft(ac);
                if (wpInfo) {
                    waypointInfo = ` | ${wpInfo.nextPointName}(${wpInfo.distance}km)`;
                }
            }

            div.innerHTML = `
                <div class="flight-no" style="color:${isSelected ? '#006400' : '#1e40af'}">${ac.flightNo}${isSelected ? ' ✓' : ''}</div>
                <div class="info">${ac.departure} → ${ac.destination} | ${ac.altitude}m | ${ac.speed}kt${modeText}${waypointInfo}</div>
            `;
            if (isSelected) {
                div.style.borderLeftColor = '#006400';
                div.style.background = '#f0fff0';
            }
            div.style.cursor = 'pointer';
            div.addEventListener('click', () => {
                state.selectedItem = { type: 'aircraft', id: ac.id };
                updateModeIndicator();
                if (!state.isPlaying) {
                    openAircraftDialog(ac.id);
                }
                updateProgressList();
            });
            container.appendChild(div);

            if (containerOverlay) {
                const div2 = div.cloneNode(true);
                div2.addEventListener('click', () => {
                    state.selectedItem = { type: 'aircraft', id: ac.id };
                    updateModeIndicator();
                    if (!state.isPlaying) {
                        openAircraftDialog(ac.id);
                    }
                    updateProgressList();
                });
                containerOverlay.appendChild(div2);
            }
        });
    }

    function updateCommTargetSelect() {
        const select = document.getElementById('comm-target');
        select.innerHTML = '<option value="atc">管制员广播</option>';
        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;
            const opt = document.createElement('option');
            opt.value = ac.id;
            opt.textContent = ac.flightNo;
            select.appendChild(opt);
        });
    }

    function addComm(sender, text) {
        const now = new Date(0);
        now.setSeconds(state.time);
        const timeStr = now.toTimeString().slice(0, 8);
        state.commMessages.push({ sender, text, time: timeStr });
        const container = document.getElementById('comm-messages');
        const div = document.createElement('div');
        div.className = `comm-msg ${sender}`;
        div.innerHTML = `<span class="comm-time">${timeStr}</span><span class="comm-label">${sender === 'atc' ? '[管制]' : `[${sender}]:`}</span> ${text}`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function updateModeIndicator() {
        const indicator = document.getElementById('mode-indicator');
        const hint = document.getElementById('connection-hint');
        if (state.routeConnectMode) {
            indicator.textContent = `模式：连接航路点 (${state.routeConnectPoints.length})`;
            indicator.style.background = '#e3f2fd';
            indicator.style.borderColor = '#64b5f6';
            indicator.style.color = '#1565c0';
            hint.classList.remove('hidden');
            hint.innerHTML = `点击航路点添加，已选: <span>${state.routeConnectPoints.map(id => state.routePoints.find(p => p.id === id)?.name || id).join(' → ')}</span>`;
        } else if (state.selectedItem) {
            if (state.selectedItem.type === 'aircraft') {
                const ac = state.aircraft.find(a => a.id === state.selectedItem.id);
                indicator.textContent = `已选飞机: ${ac?.flightNo || state.selectedItem.id}`;
                indicator.style.background = state.isPlaying ? '#dcfce7' : '#fff3e0';
                indicator.style.borderColor = state.isPlaying ? '#86efac' : '#ffb74d';
                indicator.style.color = state.isPlaying ? '#166534' : '#e65100';
            } else if (state.selectedItem.type === 'point') {
                const pt = state.routePoints.find(p => p.id === state.selectedItem.id);
                indicator.textContent = `已选航路点: ${pt?.name || state.selectedItem.id}`;
                indicator.style.background = '#fff3e0';
                indicator.style.borderColor = '#ffb74d';
                indicator.style.color = '#e65100';
            } else if (state.selectedItem.type === 'route') {
                const route = state.routes.find(r => r.id === state.selectedItem.id);
                indicator.textContent = `已选航线: ${route?.name || state.selectedItem.id}`;
                indicator.style.background = '#fff3e0';
                indicator.style.borderColor = '#ffb74d';
                indicator.style.color = '#e65100';
            }
            hint.classList.add('hidden');
        } else {
            indicator.textContent = '模式：选择 | 滚轮缩放 | ASWD移动';
            indicator.style.background = '#ffffff';
            indicator.style.borderColor = '#e2e8f0';
            indicator.style.color = '#475569';
            hint.classList.add('hidden');
        }
    }

    function drawConnectionPreview() {
        if (!state.routeConnectMode || state.routeConnectPoints.length === 0) return;
        ctx.save();
        ctx.strokeStyle = '#16a34a88';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        let first = true;
        state.routeConnectPoints.forEach(ptId => {
            const pt = state.routePoints.find(p => p.id === ptId);
            if (pt) {
                if (first) { ctx.moveTo(pt.x, pt.y); first = false; }
                else ctx.lineTo(pt.x, pt.y);
            }
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    function drawConnections() {
        state.connections.forEach(conn => {
            const ac1 = state.aircraft.find(a => a.id === conn.from);
            const ac2 = state.aircraft.find(a => a.id === conn.to);
            if (!ac1 || !ac2) return;
            if (state.time < (ac1.startTime || 0) || state.time < (ac2.startTime || 0)) return;

            const x1 = ac1.displayX !== undefined ? ac1.displayX : ac1.x;
            const y1 = ac1.displayY !== undefined ? ac1.displayY : ac1.y;
            const x2 = ac2.displayX !== undefined ? ac2.displayX : ac2.x;
            const y2 = ac2.displayY !== undefined ? ac2.displayY : ac2.y;

            ctx.strokeStyle = 'rgba(234,179,8,0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.setLineDash([]);
            const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
            const distKm = pxToKm(Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)).toFixed(1);
            ctx.fillStyle = 'rgba(234,179,8,0.8)';
            ctx.font = 'bold 9px Consolas';
            ctx.fillText(distKm + 'km', midX + 3, midY - 3);
        });
    }

    function drawDistanceLines() {
        state.distanceLines.forEach(line => {
            ctx.strokeStyle = 'rgba(239,68,68,0.6)';
            ctx.lineWidth = 1 / viewScale;
            ctx.setLineDash([5 / viewScale, 3 / viewScale]);
            ctx.beginPath();
            ctx.moveTo(line.x1, line.y1);
            ctx.lineTo(line.x2, line.y2);
            ctx.stroke();
            ctx.setLineDash([]);
            const midX = (line.x1 + line.x2) / 2, midY = (line.y1 + line.y2) / 2;
            const distPx = Math.sqrt((line.x2 - line.x1) ** 2 + (line.y2 - line.y1) ** 2);
            const distKm = pxToKmFixed(distPx).toFixed(1);
            ctx.fillStyle = 'rgba(239,68,68,0.9)';
            ctx.font = `bold ${10 / viewScale}px Consolas`;
            ctx.fillText(distKm + 'km', midX + 4 / viewScale, midY - 4 / viewScale);
        });
    }

    function drawMeasuringPreview() {
        if (!tempMeasureLine) return;

        ctx.strokeStyle = 'rgba(239,68,68,0.3)';
        ctx.lineWidth = 1 / viewScale;
        ctx.setLineDash([3 / viewScale, 3 / viewScale]);
        ctx.beginPath();
        ctx.moveTo(tempMeasureLine.x1, tempMeasureLine.y1);
        ctx.lineTo(tempMeasureLine.x2, tempMeasureLine.y2);
        ctx.stroke();
        ctx.setLineDash([]);

        const dx = tempMeasureLine.x2 - tempMeasureLine.x1;
        const dy = tempMeasureLine.y2 - tempMeasureLine.y1;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        const distKm = pxToKmFixed(distPx);
        const distNm = distKm / 1.852;
        const bearing = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;

        const midX = (tempMeasureLine.x1 + tempMeasureLine.x2) / 2;
        const midY = (tempMeasureLine.y1 + tempMeasureLine.y2) / 2;

        ctx.font = `${9 / viewScale}px Consolas`;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 0.5 / viewScale;
        const text = `${distNm.toFixed(1)}nm ${bearing.toFixed(0)}°`;
        const tw = ctx.measureText(text).width;
        ctx.fillRect(midX - tw / 2 - 2 / viewScale, midY - 10 / viewScale, tw + 4 / viewScale, 12 / viewScale);
        ctx.strokeRect(midX - tw / 2 - 2 / viewScale, midY - 10 / viewScale, tw + 4 / viewScale, 12 / viewScale);
        ctx.fillStyle = '#333';
        ctx.fillText(text, midX - tw / 2, midY);
    }

    function drawFreeNavTargets() {
        state.aircraft.forEach(ac => {
            if (ac.navMode !== 'free' || ac.targetX === undefined || ac.targetY === undefined) return;

            const x = ac.displayX !== undefined ? ac.displayX : ac.x;
            const y = ac.displayY !== undefined ? ac.displayY : ac.y;

            ctx.strokeStyle = '#0369a1';
            ctx.lineWidth = 1 / viewScale;
            ctx.setLineDash([4 / viewScale, 4 / viewScale]);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(ac.targetX, ac.targetY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = 'rgba(3,105,161,0.15)';
            ctx.beginPath();
            ctx.arc(ac.targetX, ac.targetY, 8 / viewScale, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#0369a1';
            ctx.lineWidth = 1.5 / viewScale;
            ctx.beginPath();
            ctx.arc(ac.targetX, ac.targetY, 8 / viewScale, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = '#0369a1';
            ctx.beginPath();
            ctx.arc(ac.targetX, ac.targetY, 2 / viewScale, 0, Math.PI * 2);
            ctx.fill();

            const distPx = Math.sqrt((ac.targetX - x) ** 2 + (ac.targetY - y) ** 2);
            const distKm = pxToKmFixed(distPx);
            const midX = (x + ac.targetX) / 2;
            const midY = (y + ac.targetY) / 2;

            ctx.font = `${8 / viewScale}px Consolas`;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.strokeStyle = 'rgba(3,105,161,0.7)';
            ctx.lineWidth = 0.4 / viewScale;
            const text = `${distKm.toFixed(1)}km`;
            const tw = ctx.measureText(text).width;
            ctx.fillRect(midX - tw / 2 - 2 / viewScale, midY - 10 / viewScale, tw + 4 / viewScale, 11 / viewScale);
            ctx.strokeRect(midX - tw / 2 - 2 / viewScale, midY - 10 / viewScale, tw + 4 / viewScale, 11 / viewScale);
            ctx.fillStyle = '#0369a1';
            ctx.fillText(text, midX - tw / 2, midY);
        });

        if (state.targetSelectMode && state.tempTargetPoint) {
            const ac = state.aircraft.find(a => a.id === state.targetSelectMode);
            if (ac) {
                const x = ac.displayX !== undefined ? ac.displayX : ac.x;
                const y = ac.displayY !== undefined ? ac.displayY : ac.y;

                ctx.strokeStyle = 'rgba(3,105,161,0.5)';
                ctx.lineWidth = 1 / viewScale;
                ctx.setLineDash([3 / viewScale, 3 / viewScale]);
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(state.tempTargetPoint.x, state.tempTargetPoint.y);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = 'rgba(3,105,161,0.3)';
                ctx.beginPath();
                ctx.arc(state.tempTargetPoint.x, state.tempTargetPoint.y, 10 / viewScale, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#0369a1';
                ctx.lineWidth = 1.5 / viewScale;
                ctx.stroke();
            }
        }
    }

    function drawModeIndicator() {}

    function pointOnRoute(mx, my, route) {
        let minDist = Infinity;
        for (let i = 1; i < route.points.length; i++) {
            const d = pointToSegmentDist(mx, my, route.points[i - 1], route.points[i]);
            if (d < minDist) minDist = d;
        }
        return minDist;
    }

    function pointToSegmentDist(px, py, p1, p2) {
        const A = px - p1.x, B = py - p1.y, C = p2.x - p1.x, D = p2.y - p1.y;
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        if (lenSq === 0) return Math.sqrt(A * A + B * B);
        let param = Math.max(0, Math.min(1, dot / lenSq));
        return Math.sqrt((px - (p1.x + param * C)) ** 2 + (py - (p1.y + param * D)) ** 2);
    }

    function getPositionOnRoute(px, py, route) {
        let minDist = Infinity;
        let bestParam = 0;
        let bestSegIdx = 0;
        let minX = px, minY = py;

        for (let i = 1; i < route.points.length; i++) {
            const p1 = route.points[i - 1];
            const p2 = route.points[i];
            const A = px - p1.x, B = py - p1.y;
            const C = p2.x - p1.x, D = p2.y - p1.y;
            const lenSq = C * C + D * D;
            if (lenSq === 0) continue;
            let param = Math.max(0, Math.min(1, (A * C + B * D) / lenSq));
            const ix = p1.x + param * C;
            const iy = p1.y + param * D;
            const dist = Math.sqrt((px - ix) ** 2 + (py - iy) ** 2);
            if (dist < minDist) {
                minDist = dist;
                bestParam = param;
                bestSegIdx = i - 1;
                minX = ix;
                minY = iy;
            }
        }

        let totalDist = 0;
        for (let i = 1; i <= bestSegIdx; i++) {
            const dx = route.points[i].x - route.points[i - 1].x;
            const dy = route.points[i].y - route.points[i - 1].y;
            totalDist += Math.sqrt(dx * dx + dy * dy);
        }
        const segDx = route.points[bestSegIdx + 1].x - route.points[bestSegIdx].x;
        const segDy = route.points[bestSegIdx + 1].y - route.points[bestSegIdx].y;
        const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
        totalDist += bestParam * segLen;

        return { dist: totalDist, x: minX, y: minY, segIdx: bestSegIdx, param: bestParam };
    }

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.2, Math.min(5, viewScale * delta));

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const worldX = toWorldX(mouseX);
        const worldY = toWorldY(mouseY);

        viewScale = newScale;

        viewOffsetX = mouseX - canvasWidth / 2 - (worldX - centerX) * viewScale;
        viewOffsetY = mouseY - canvasHeight / 2 - (worldY - centerY) * viewScale;
    }, { passive: false });

    const keysPressed = {};
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        keysPressed[e.key.toLowerCase()] = true;

        if (e.key === 'Escape') {
            document.querySelectorAll('.dialog:not(.hidden)').forEach(d => d.classList.add('hidden'));
            if (state.routeConnectMode) {
                state.routeConnectMode = false;
                state.routeConnectPoints = [];
                document.getElementById('add-route-btn').classList.remove('active');
            }
            state.selectedItem = null;
            labelFollowMouse = null;
            updateModeIndicator();
            updateProgressList();
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && isEditMode()) {
            document.getElementById('tool-delete').click();
        }
        if (e.key === ' ') {
            e.preventDefault();
            document.getElementById('play-pause-btn').click();
        }
    });

    document.addEventListener('keyup', e => {
        keysPressed[e.key.toLowerCase()] = false;
    });

    function handleKeyboardMovement() {
        const step = 20;
        if (keysPressed['w'] || keysPressed['arrowup']) viewOffsetY += step;
        if (keysPressed['s'] || keysPressed['arrowdown']) viewOffsetY -= step;
        if (keysPressed['a'] || keysPressed['arrowleft']) viewOffsetX += step;
        if (keysPressed['d'] || keysPressed['arrowright']) viewOffsetX -= step;
    }

    setInterval(handleKeyboardMovement, 16);

    canvas.addEventListener('mousemove', e => {
        const coords = getCanvasCoords(e);
        state.mousePos = coords;

        if (state.targetSelectMode) {
            state.tempTargetPoint = { x: toWorldX(coords.x), y: toWorldY(coords.y) };
        }

        if (draggingPoint && isEditMode()) {
            draggingPoint.x = toWorldX(coords.x);
            draggingPoint.y = toWorldY(coords.y);
            updatePointDialogPosition();
        }
        if (draggingAc && isEditMode()) {
            draggingAc.x = toWorldX(coords.x);
            draggingAc.y = toWorldY(coords.y);
            draggingAc.displayX = draggingAc.x;
            draggingAc.displayY = draggingAc.y;
        }
        if (state.draggingLabelAc) {
            const ac = state.draggingLabelAc;
            const acX = toWorldX(coords.x);
            const acY = toWorldY(coords.y);
            ac.labelOffsetX = acX - ac.x;
            ac.labelOffsetY = acY - ac.y;
        }
        if (labelFollowMouse) {
            const ac = labelFollowMouse;
            const acX = ac.displayX !== undefined ? ac.displayX : ac.x;
            const acY = ac.displayY !== undefined ? ac.displayY : ac.y;
            const mouseWorldX = toWorldX(coords.x);
            const mouseWorldY = toWorldY(coords.y);

            const maxOffsetPx = 80;
            const maxOffsetWorld = maxOffsetPx / viewScale;

            const angle = Math.atan2(mouseWorldY - acY, mouseWorldX - acX);
            const angleStep = 30 * Math.PI / 180;
            const snappedAngle = Math.round(angle / angleStep) * angleStep;

            const dx = mouseWorldX - acX;
            const dy = mouseWorldY - acY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const clampedDist = Math.min(dist, maxOffsetWorld);

            ac.labelOffsetX = Math.cos(snappedAngle) * clampedDist;
            ac.labelOffsetY = Math.sin(snappedAngle) * clampedDist;
        }
        if (tempMeasureLine) {
            tempMeasureLine.x2 = toWorldX(coords.x);
            tempMeasureLine.y2 = toWorldY(coords.y);
        }
    });

    canvas.addEventListener('mouseleave', () => { state.mousePos = null; });

    canvas.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (labelFollowMouse) {
            labelFollowMouse = null;
        }
    });

    canvas.addEventListener('mousedown', e => {
        if (e.button !== 0) return;

        if (state.targetSelectMode) {
            const coords = getCanvasCoords(e);
            const mx = toWorldX(coords.x);
            const my = toWorldY(coords.y);
            const ac = state.aircraft.find(a => a.id === state.targetSelectMode);
            if (ac) {
                ac.targetX = mx;
                ac.targetY = my;
                ac.navMode = 'free';
                document.getElementById('target-x').value = Math.round(mx);
                document.getElementById('target-y').value = Math.round(my);
                updateTargetInfo(ac);
            }
            state.targetSelectMode = null;
            state.tempTargetPoint = null;
            document.getElementById('select-target-btn').style.background = '';
            document.getElementById('select-target-btn').style.color = '';
            updateModeIndicator();
            return;
        }

        const coords = getCanvasCoords(e);
        const mx = toWorldX(coords.x);
        const my = toWorldY(coords.y);

        if (!isEditMode()) {
            let hitAc = null;
            state.aircraft.forEach(ac => {
                if (state.time < (ac.startTime || 0)) return;
                const x = ac.displayX !== undefined ? ac.displayX : ac.x;
                const y = ac.displayY !== undefined ? ac.displayY : ac.y;
                if (Math.sqrt((mx - x) ** 2 + (my - y) ** 2) < 22) hitAc = ac;
            });
            if (hitAc) {
                state.selectedItem = { type: 'aircraft', id: hitAc.id };
                updateModeIndicator();
                updateProgressList();
            } else {
                state.selectedItem = null;
                updateModeIndicator();
                updateProgressList();
            }
            return;
        }

        if (state.routeConnectMode) {
            state.routePoints.forEach(pt => {
                if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 12) {
                    if (!state.routeConnectPoints.includes(pt.id)) {
                        state.routeConnectPoints.push(pt.id);
                        updateModeIndicator();
                    }
                }
            });
            return;
        }

        let hitPt = null;
        state.routePoints.forEach(pt => {
            if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 10) hitPt = pt;
        });
        if (hitPt) {
            state.selectedItem = { type: 'point', id: hitPt.id };
            draggingPoint = hitPt;
            dragPointOffsetX = mx - hitPt.x;
            dragPointOffsetY = my - hitPt.y;
            updateModeIndicator();
            return;
        }

        let hitAc = null;
        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;
            const x = ac.displayX !== undefined ? ac.displayX : ac.x;
            const y = ac.displayY !== undefined ? ac.displayY : ac.y;
            if (Math.sqrt((mx - x) ** 2 + (my - y) ** 2) < 22) hitAc = ac;
        });
        if (hitAc) {
            state.selectedItem = { type: 'aircraft', id: hitAc.id };
            draggingAc = hitAc;
            dragAcOffsetX = mx - (hitAc.displayX !== undefined ? hitAc.displayX : hitAc.x);
            dragAcOffsetY = my - (hitAc.displayY !== undefined ? hitAc.displayY : hitAc.y);
            updateModeIndicator();
            updateProgressList();
            return;
        }

        let hitLabel = null;
        state.aircraft.forEach(ac => {
            const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
            const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;
            const labelWorldX = ac.x + labelOffsetX;
            const labelWorldY = ac.y + labelOffsetY;
            const labelScreenX = toScreenX(labelWorldX);
            const labelScreenY = toScreenY(labelWorldY);
            const boxW = 80, boxH = 54;
            if (coords.x >= labelScreenX && coords.x <= labelScreenX + boxW &&
                coords.y >= labelScreenY && coords.y <= labelScreenY + boxH) {
                hitLabel = ac;
            }
        });
        if (hitLabel) {
            state.selectedItem = { type: 'aircraft', id: hitLabel.id };
            state.draggingLabelAc = hitLabel;
            labelFollowMouse = null;
            updateModeIndicator();
            updateProgressList();
            return;
        }

        let hitRoute = null;
        state.routes.forEach(route => {
            if (pointOnRoute(mx, my, route) < 12) hitRoute = route;
        });
        if (hitRoute) {
            state.selectedItem = { type: 'route', id: hitRoute.id };
            labelFollowMouse = null;
            updateModeIndicator();
            return;
        }

        state.selectedItem = null;
        labelFollowMouse = null;
        updateModeIndicator();
        updateProgressList();
    });

    canvas.addEventListener('mouseup', e => {
        if (state.draggingLabelAc) {
            state.draggingLabelAc = null;
        }
        if (draggingAc) {
            if (!isEditMode()) {
                draggingAc = null;
                return;
            }
            const coords = getCanvasCoords(e);
            const mx = toWorldX(coords.x);
            const my = toWorldY(coords.y);
            let nearestRoute = null, minD = Infinity;
            state.routes.forEach(route => {
                const d = pointOnRoute(mx, my, route);
                if (d < minD) { minD = d; nearestRoute = route; }
            });
            if (nearestRoute && minD < 30) {
                const posOnRoute = getPositionOnRoute(mx, my, nearestRoute);
                draggingAc.routeId = nearestRoute.id;
                draggingAc.routeDistance = posOnRoute.dist;
                draggingAc.x = posOnRoute.x;
                draggingAc.y = posOnRoute.y;
                draggingAc.displayX = posOnRoute.x;
                draggingAc.displayY = posOnRoute.y;

                const segIdx = posOnRoute.segIdx;
                const p1 = nearestRoute.points[segIdx];
                const p2 = nearestRoute.points[segIdx + 1] || p1;
                draggingAc.heading = Math.atan2(p2.x - p1.x, -(p2.y - p1.y)) * 180 / Math.PI;
                if (draggingAc.heading < 0) draggingAc.heading += 360;
                draggingAc.trail = [];
                addComm('atc', `${draggingAc.flightNo} 已关联航线 ${nearestRoute.name}`);
            } else {
                draggingAc.routeId = null;
            }
            draggingAc = null;
        }
        draggingPoint = null;
    });

    canvas.addEventListener('dblclick', e => {
        const coords = getCanvasCoords(e);
        const mx = toWorldX(coords.x);
        const my = toWorldY(coords.y);

        let hitAc = null;
        state.aircraft.forEach(ac => {
            if (Math.sqrt((mx - ac.x) ** 2 + (my - ac.y) ** 2) < 18) hitAc = ac;
        });

        if (!hitAc) {
            state.aircraft.forEach(ac => {
                if (state.time < (ac.startTime || 0)) return;
                const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
                const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;
                const labelScreenX = toScreenX(ac.x + labelOffsetX);
                const labelScreenY = toScreenY(ac.y + labelOffsetY);
                const boxW = 80, boxH = 54;
                if (coords.x >= labelScreenX && coords.x <= labelScreenX + boxW &&
                    coords.y >= labelScreenY && coords.y <= labelScreenY + boxH) {
                    hitAc = ac;
                }
            });
        }

        if (hitAc) {
            state.selectedItem = { type: 'aircraft', id: hitAc.id };
            updateModeIndicator();
            updateProgressList();
            openAircraftDialog(hitAc.id);
            return;
        }

        if (isEditMode()) {
            let hitPt = null;
            state.routePoints.forEach(pt => {
                if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 10) hitPt = pt;
            });
            if (hitPt) {
                state.selectedItem = { type: 'point', id: hitPt.id };
                openPointDialog(hitPt.id);
                return;
            }

            let hitRoute = null;
            state.routes.forEach(route => {
                if (pointOnRoute(mx, my, route) < 8) hitRoute = route;
            });
            if (hitRoute) {
                state.selectedItem = { type: 'route', id: hitRoute.id };
                openRouteDialog(hitRoute.id);
            }
        }
    });

    canvas.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!isEditMode()) return;
        const coords = getCanvasCoords(e);
        const mx = toWorldX(coords.x);
        const my = toWorldY(coords.y);
        state.aircraft.forEach(ac => {
            if (Math.sqrt((mx - ac.x) ** 2 + (my - ac.y) ** 2) < 18) {
                state.selectedItem = { type: 'aircraft', id: ac.id };
                updateModeIndicator();
                updateProgressList();
                openAircraftDialog(ac.id);
            }
        });
        if (!state.selectedItem || state.selectedItem.type !== 'aircraft') {
            state.routePoints.forEach(pt => {
                if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 10) {
                    state.selectedItem = { type: 'point', id: pt.id };
                    openPointDialog(pt.id);
                }
            });
        }
    });

    const radarContainer = document.getElementById('radar-container');

    radarContainer.addEventListener('dragover', e => {
        e.preventDefault();
        if (!isEditMode()) return;
        e.dataTransfer.dropEffect = 'copy';
        radarContainer.classList.add('drag-over');
    });

    radarContainer.addEventListener('dragleave', e => {
        radarContainer.classList.remove('drag-over');
    });

    radarContainer.addEventListener('drop', e => {
        e.preventDefault();
        radarContainer.classList.remove('drag-over');
        if (!isEditMode()) return;

        const type = e.dataTransfer.getData('text/type');
        const subType = e.dataTransfer.getData('text/subtype');
        const rect = canvas.getBoundingClientRect();
        const x = toWorldX(e.clientX - rect.left);
        const y = toWorldY(e.clientY - rect.top);

        if (type === 'point') {
            const newPt = {
                id: Date.now(),
                name: `P${state.pointNameCounter++}`,
                x: x,
                y: y,
                type: subType || 'normal'
            };
            state.routePoints.push(newPt);
            addPointPanelItem(newPt);
            addComm('atc', `航路点 ${newPt.name} 已创建`);
        } else if (type === 'aircraft') {
            const newAc = {
                id: Date.now(),
                x: x,
                y: y,
                displayX: x,
                displayY: y,
                flightNo: `CA${Math.floor(Math.random() * 9000) + 1000}`,
                squawk: state.defaults.squawk,
                departure: 'ZBAA',
                destination: 'ZSSS',
                acType: state.defaults.acType,
                altitude: state.defaults.altitude,
                speed: state.defaults.speed,
                heading: 90,
                routeId: null,
                routeDistance: 0,
                startTime: state.time,
                trail: [],
                labelOffsetX: 18,
                labelOffsetY: -14
            };
            state.aircraft.push(newAc);
            addAircraftPanelItem(newAc);
            updateCommTargetSelect();
            addComm('pilot', `${newAc.flightNo} 呼叫，高度${newAc.altitude}m，速度${newAc.speed}kt`);
            addComm('atc', `${newAc.flightNo} 雷达识别，自由飞行`);
            state.selectedItem = { type: 'aircraft', id: newAc.id };
            updateModeIndicator();
            updateProgressList();
        }
    });

    document.querySelectorAll('.draggable-item').forEach(item => {
        item.addEventListener('dragstart', e => {
            if (!isEditMode()) {
                e.preventDefault();
                return;
            }
            const type = item.dataset.type;
            const subType = item.dataset.pointType || '';

            e.dataTransfer.setData('text/type', type);
            e.dataTransfer.setData('text/subtype', subType);
            e.dataTransfer.effectAllowed = 'copy';

            state.isDraggingFromPalette = true;
            state.paletteDragType = type;
            state.paletteDragSubType = subType;
        });

        item.addEventListener('dragend', e => {
            state.isDraggingFromPalette = false;
            state.paletteDragType = null;
            state.paletteDragSubType = null;
        });
    });

    document.getElementById('add-point-btn').addEventListener('click', () => {
        if (!isEditMode()) return;
        const newPt = {
            id: Date.now(),
            name: `P${state.pointNameCounter++}`,
            x: centerX + (Math.random() - 0.5) * 200,
            y: centerY + (Math.random() - 0.5) * 200,
            type: 'normal'
        };
        state.routePoints.push(newPt);
        addPointPanelItem(newPt);
        addComm('atc', `航路点 ${newPt.name} 已创建`);
    });

    document.getElementById('edit-point-btn').addEventListener('click', () => {
        if (!isEditMode()) return;
        if (state.selectedItem && state.selectedItem.type === 'point') {
            openPointDialog(state.selectedItem.id);
        } else if (state.routePoints.length > 0) {
            state.selectedItem = { type: 'point', id: state.routePoints[0].id };
            updateModeIndicator();
            openPointDialog(state.selectedItem.id);
        }
    });

    document.getElementById('add-route-btn').addEventListener('click', () => {
        if (!isEditMode()) return;
        if (state.routeConnectMode) {
            if (state.routeConnectPoints.length >= 2) {
                const route = {
                    id: Date.now(),
                    name: `航线${state.routes.length + 1}`,
                    points: state.routeConnectPoints.map(id => state.routePoints.find(p => p.id === id)),
                    color: '#2563eb'
                };
                state.routes.push(route);
                addRoutePanelItem(route);
                addComm('atc', `航线 ${route.name} 已建立，共 ${route.points.length} 个航路点`);
            }
            state.routeConnectMode = false;
            state.routeConnectPoints = [];
            document.getElementById('add-route-btn').classList.remove('active');
            updateModeIndicator();
        } else {
            state.routeConnectMode = true;
            state.routeConnectPoints = [];
            document.getElementById('add-route-btn').classList.add('active');
            updateModeIndicator();
        }
    });

    document.getElementById('add-aircraft-btn').addEventListener('click', () => {
        if (!isEditMode()) return;
        const newAc = {
            id: Date.now(),
            x: centerX + (Math.random() - 0.5) * 150,
            y: centerY + (Math.random() - 0.5) * 150,
            displayX: centerX + (Math.random() - 0.5) * 150,
            displayY: centerY + (Math.random() - 0.5) * 150,
            flightNo: `CA${Math.floor(Math.random() * 9000) + 1000}`,
            squawk: state.defaults.squawk,
            departure: 'ZBAA',
            destination: 'ZSSS',
            acType: state.defaults.acType,
            altitude: state.defaults.altitude,
            speed: state.defaults.speed,
            heading: 90,
            routeId: null,
            routeDistance: 0,
            startTime: state.time,
            trail: [],
            labelOffsetX: 18,
            labelOffsetY: -14
        };
        state.aircraft.push(newAc);
        addAircraftPanelItem(newAc);
        updateCommTargetSelect();
        addComm('pilot', `${newAc.flightNo} 呼叫，高度${newAc.altitude}m，速度${newAc.speed}kt`);
        addComm('atc', `${newAc.flightNo} 雷达识别，自由飞行`);
        state.selectedItem = { type: 'aircraft', id: newAc.id };
        updateModeIndicator();
        updateProgressList();
    });

    function openPointDialog(ptId) {
        if (!isEditMode()) return;
        state.editingPointId = ptId;
        const pt = state.routePoints.find(p => p.id === ptId);
        if (!pt) return;
        document.getElementById('point-edit-dialog').classList.remove('hidden');
        document.getElementById('point-name').value = pt.name || '';
        document.getElementById('point-type').value = pt.type || 'normal';
        document.getElementById('point-x-display').textContent = Math.round(pt.x);
        document.getElementById('point-y-display').textContent = Math.round(pt.y);
    }

    function updatePointDialogPosition() {
        if (!state.editingPointId) return;
        const pt = state.routePoints.find(p => p.id === state.editingPointId);
        if (pt) {
            document.getElementById('point-x-display').textContent = Math.round(pt.x);
            document.getElementById('point-y-display').textContent = Math.round(pt.y);
        }
    }

    document.getElementById('save-point').addEventListener('click', () => {
        if (!state.editingPointId) return;
        const pt = state.routePoints.find(p => p.id === state.editingPointId);
        if (!pt) return;
        pt.name = document.getElementById('point-name').value.trim() || pt.name;
        pt.type = document.getElementById('point-type').value;
        document.getElementById('point-edit-dialog').classList.add('hidden');
        updatePointPanelList();
        updateRoutePanelList();
    });

    document.getElementById('delete-point-btn').addEventListener('click', () => {
        if (!state.editingPointId) return;
        const pt = state.routePoints.find(p => p.id === state.editingPointId);
        state.routePoints = state.routePoints.filter(p => p.id !== state.editingPointId);
        state.routes = state.routes.filter(r => !r.points.some(p => p.id === state.editingPointId));
        state.selectedItem = null;
        document.getElementById('point-edit-dialog').classList.add('hidden');
        updatePointPanelList();
        updateRoutePanelList();
        updateModeIndicator();
        if (pt) addComm('atc', `航路点 ${pt.name} 已删除`);
    });

    function openRouteDialog(routeId) {
        if (!isEditMode()) return;
        state.editingRouteId = routeId;
        const route = state.routes.find(r => r.id === routeId);
        if (!route) return;
        document.getElementById('route-edit-dialog').classList.remove('hidden');
        document.getElementById('route-name').value = route.name || '';
        document.getElementById('route-color').value = route.color || '#2563eb';
        document.getElementById('route-points-display').value = route.points.map(p => p.name || `P${p.id}`).join(' → ');
    }

    document.getElementById('save-route').addEventListener('click', () => {
        if (!state.editingRouteId) return;
        const route = state.routes.find(r => r.id === state.editingRouteId);
        if (!route) return;
        route.name = document.getElementById('route-name').value.trim() || route.name;
        route.color = document.getElementById('route-color').value;
        document.getElementById('route-edit-dialog').classList.add('hidden');
        updateRoutePanelList();
    });

    document.getElementById('delete-route-btn').addEventListener('click', () => {
        if (!state.editingRouteId) return;
        state.routes = state.routes.filter(r => r.id !== state.editingRouteId);
        state.aircraft.forEach(ac => {
            if (ac.routeId === state.editingRouteId) {
                ac.routeId = null;
                addComm('atc', `${ac.flightNo} 航线已删除，改为自由飞行`);
            }
        });
        state.selectedItem = null;
        document.getElementById('route-edit-dialog').classList.add('hidden');
        updateRoutePanelList();
        updateModeIndicator();
    });

    function buildNextWaypointSelect(acId) {
        const select = document.getElementById('ac-next-waypoint');
        const previewDiv = document.getElementById('route-path-preview');
        if (!select) return;

        const ac = state.aircraft.find(a => a.id === acId);
        select.innerHTML = '<option value="">-- 选择下一航路点 --</option>';

        if (!ac || !ac.routeId) {
            if (previewDiv) previewDiv.innerHTML = '';
            return;
        }

        const route = state.routes.find(r => r.id === ac.routeId);
        if (!route || route.points.length < 2) {
            if (previewDiv) previewDiv.innerHTML = '';
            return;
        }

        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;

        let segIdx = 0, minSegDist = Infinity;
        for (let i = 1; i < route.points.length; i++) {
            const d = pointToSegmentDist(x, y, route.points[i - 1], route.points[i]);
            if (d < minSegDist) { minSegDist = d; segIdx = i - 1; }
        }

        const p1 = route.points[segIdx];
        const p2 = route.points[segIdx + 1];
        const prevIdx = segIdx > 0 ? segIdx - 1 : -1;
        const nextIdx = segIdx < route.points.length - 2 ? segIdx + 2 : -1;

        if (nextIdx >= 0) {
            const pt = route.points[nextIdx];
            const opt = document.createElement('option');
            opt.value = nextIdx;
            const ptName = pt.name || `P${pt.id}`;
            const distPx = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
            const distKm = pxToKmFixed(distPx).toFixed(1);
            opt.textContent = `→ ${ptName} (后序点, ${distKm}km)`;
            opt.style.fontWeight = 'bold';
            select.appendChild(opt);
        }

        if (prevIdx >= 0) {
            const pt = route.points[prevIdx];
            const opt = document.createElement('option');
            opt.value = prevIdx;
            const ptName = pt.name || `P${pt.id}`;
            const distPx = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
            const distKm = pxToKmFixed(distPx).toFixed(1);
            opt.textContent = `← ${ptName} (前序点, ${distKm}km)`;
            opt.style.fontWeight = 'bold';
            select.appendChild(opt);
        }

        const p1Name = p1.name || `P${p1.id}`;
        const p2Name = p2.name || `P${p2.id}`;
        const p1Dist = Math.sqrt((p1.x - x) ** 2 + (p1.y - y) ** 2);
        const p2Dist = Math.sqrt((p2.x - x) ** 2 + (p2.y - y) ** 2);

        {
            const opt = document.createElement('option');
            opt.value = segIdx;
            opt.textContent = `${p1Name} (当前段起点, ${pxToKmFixed(p1Dist).toFixed(1)}km)`;
            select.appendChild(opt);
        }

        {
            const opt = document.createElement('option');
            opt.value = segIdx + 1;
            opt.textContent = `${p2Name} (当前段终点, ${pxToKmFixed(p2Dist).toFixed(1)}km)`;
            select.appendChild(opt);
        }

        if ((nextIdx >= 0 || prevIdx >= 0) && route.points.length > 3) {
            const sepOpt = document.createElement('option');
            sepOpt.disabled = true;
            sepOpt.textContent = '─── 直飞到任意航路点 ───';
            select.appendChild(sepOpt);
        }

        route.points.forEach((pt, idx) => {
            if (idx === segIdx || idx === segIdx + 1 || idx === nextIdx || idx === prevIdx) return;
            const opt = document.createElement('option');
            opt.value = idx;
            const ptName = pt.name || `P${pt.id}`;
            const distPx = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
            const distKm = pxToKmFixed(distPx).toFixed(1);
            opt.textContent = `• ${ptName} (${distKm}km)`;
            select.appendChild(opt);
        });

        const currentVal = ac.nextWaypointIdx !== undefined ? ac.nextWaypointIdx : '';
        if (currentVal !== '' && currentVal !== segIdx && currentVal !== segIdx + 1) {
            select.value = currentVal;
        }

        updateRoutePathPreview(ac);
    }

    function updateRoutePathPreview(ac) {
        const previewDiv = document.getElementById('route-path-preview');
        if (!previewDiv || !ac || !ac.routeId) return;

        const route = state.routes.find(r => r.id === ac.routeId);
        if (!route) return;

        const nextIdx = parseInt(document.getElementById('ac-next-waypoint')?.value);
        if (isNaN(nextIdx)) {
            previewDiv.innerHTML = '<span style="color:#94a3b8;">请选择下一航路点以确定飞行方向</span>';
            return;
        }

        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;

        let segIdx = 0, minSegDist = Infinity;
        for (let i = 1; i < route.points.length; i++) {
            const d = pointToSegmentDist(x, y, route.points[i - 1], route.points[i]);
            if (d < minSegDist) { minSegDist = d; segIdx = i - 1; }
        }

        const nextPt = route.points[nextIdx];
        const distPx = Math.sqrt((nextPt.x - x) ** 2 + (nextPt.y - y) ** 2);
        const distKm = pxToKmFixed(distPx).toFixed(1);

        // 根据当前位置与目标航路点的关系，确定后续路径
        let remainingPoints = [];
        let nextNeighborIdx = -1;

        if (nextIdx === segIdx) {
            // 目标是前序点，到达后将继续飞往更前面的点
            nextNeighborIdx = nextIdx - 1;
            if (nextNeighborIdx >= 0) {
                remainingPoints = route.points.slice(0, nextNeighborIdx + 1).reverse().map(p => p.name || `P${p.id}`);
            }
        } else if (nextIdx === segIdx + 1) {
            // 目标是后序点，到达后将继续飞往更后面的点
            nextNeighborIdx = nextIdx + 1;
            if (nextNeighborIdx < route.points.length) {
                remainingPoints = route.points.slice(nextNeighborIdx).map(p => p.name || `P${p.id}`);
            }
        } else if (nextIdx > segIdx + 1) {
            // 直飞后方的点，到达后将继续飞往其后序点
            nextNeighborIdx = nextIdx + 1;
            if (nextNeighborIdx < route.points.length) {
                remainingPoints = route.points.slice(nextNeighborIdx).map(p => p.name || `P${p.id}`);
            }
        } else {
            // 直飞前方的点，到达后将继续飞往其前序点
            nextNeighborIdx = nextIdx - 1;
            if (nextNeighborIdx >= 0) {
                remainingPoints = route.points.slice(0, nextNeighborIdx + 1).reverse().map(p => p.name || `P${p.id}`);
            }
        }

        const nextNeighborName = nextNeighborIdx >= 0 && nextNeighborIdx < route.points.length
            ? (route.points[nextNeighborIdx].name || `P${route.points[nextNeighborIdx].id}`)
            : null;

        previewDiv.innerHTML = `
            <div style="color:#2563eb;">
                飞往: ${nextPt.name || `P${nextPt.id}`} | 距离: ${distKm}km
                ${nextNeighborName ? ` | 后续: ${nextNeighborName}` : ''}
            </div>
            <div style="color:#94a3b8;margin-top:2px;">
                路线: 当前位置 → ${nextPt.name || `P${nextPt.id}`}
                ${remainingPoints.length ? ' → ' + remainingPoints.join(' → ') : ' → (继续飞行)'}
            </div>
        `;
    }

    function updateWaypointSelectOptions(acId) {
        const group = document.getElementById('waypoint-select-group');
        if (!group) return;

        const ac = state.aircraft.find(a => a.id === acId);

        if (!ac || !ac.routeId) {
            group.style.display = 'none';
            return;
        }

        group.style.display = 'block';
        buildNextWaypointSelect(acId);
    }

    document.getElementById('ac-next-waypoint')?.addEventListener('change', function() {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (ac) {
            ac.nextWaypointIdx = this.value !== '' ? parseInt(this.value) : undefined;
            updateRoutePathPreview(ac);
        }
    });

    function getPositionAndTimeForWaypoint(ac, waypointIdx) {
        if (!ac.routeId) return null;
        const route = state.routes.find(r => r.id === ac.routeId);
        if (!route || waypointIdx < 0 || waypointIdx >= route.points.length) return null;

        const pt = route.points[waypointIdx];
        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;

        const dx = pt.x - x, dy = pt.y - y;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        const distKm = pxToKm(distPx);
        const speedKmPerSec = ((ac.speed || state.defaults.speed) * 0.00051444) * 1.852;
        const timeSec = distKm / speedKmPerSec;

        return {
            x: pt.x, y: pt.y,
            timeToReach: Math.round(timeSec),
            distance: Math.round(distKm)
        };
    }

    function openAircraftDialog(acId) {
        if (!isEditMode()) return;
        state.editingAircraftId = acId;
        const ac = state.aircraft.find(a => a.id === acId);
        if (!ac) return;
        document.getElementById('aircraft-edit-dialog').classList.remove('hidden');
        document.getElementById('ac-flight-no').value = ac.flightNo || '';
        document.getElementById('ac-squawk').value = ac.squawk || '';
        document.getElementById('ac-departure').value = ac.departure || '';
        document.getElementById('ac-destination').value = ac.destination || '';
        document.getElementById('ac-type').value = ac.acType || 'B738';
        document.getElementById('ac-altitude').value = ac.altitude || 10600;
        document.getElementById('ac-speed').value = ac.speed || '';
        document.getElementById('ac-heading').value = Math.round(ac.heading) || '';

        const navMode = ac.navMode || (ac.routeId ? 'route' : 'heading');
        document.getElementById('ac-nav-mode').value = navMode;
        updateNavModeUI(navMode);

        if (ac.targetX !== undefined && ac.targetY !== undefined) {
            document.getElementById('target-x').value = Math.round(ac.targetX);
            document.getElementById('target-y').value = Math.round(ac.targetY);
            updateTargetInfo(ac);
        }

        updateRouteSelectOptions();
        document.getElementById('ac-route').value = ac.routeId || '';
        updateWaypointSelectOptions(acId);
        updateWaypointInfo(ac);

        // 初始化"到达目标点后询问下一航路点"复选框
        const askNextWpCheckbox = document.getElementById('ac-ask-next-waypoint');
        if (askNextWpCheckbox) {
            askNextWpCheckbox.checked = ac.askNextWaypoint || false;
        }

        // 显示开始时间
        const startTimeDisplay = document.getElementById('ac-start-time-display');
        if (startTimeDisplay) {
            const startTime = ac.startTime || 0;
            const hours = Math.floor(startTime / 3600);
            const minutes = Math.floor((startTime % 3600) / 60);
            const seconds = Math.floor(startTime % 60);
            startTimeDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    function updateNavModeUI(mode) {
        const freeNavGroup = document.getElementById('free-nav-group');
        const routeGroup = document.getElementById('waypoint-select-group');
        if (mode === 'free') {
            freeNavGroup.style.display = '';
            routeGroup.style.display = 'none';
        } else if (mode === 'route') {
            freeNavGroup.style.display = 'none';
            routeGroup.style.display = '';
        } else {
            freeNavGroup.style.display = 'none';
            routeGroup.style.display = 'none';
        }
    }

    function updateTargetInfo(ac) {
        const infoDiv = document.getElementById('target-info');
        if (!infoDiv || !ac) return;

        if (ac.targetX === undefined || ac.targetY === undefined) {
            infoDiv.innerHTML = '<span style="color:#94a3b8;">未设置目标点</span>';
            return;
        }

        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;
        const dx = ac.targetX - x;
        const dy = ac.targetY - y;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        const distKm = pxToKmFixed(distPx);
        const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
        const headingNorm = heading < 0 ? heading + 360 : heading;

        infoDiv.innerHTML = `<span style="color:#0369a1;">目标: (${Math.round(ac.targetX)}, ${Math.round(ac.targetY)}) | 距离: ${distKm.toFixed(1)}km | 航向: ${headingNorm.toFixed(0)}°</span>`;
    }

    function updateWaypointInfo(ac) {
        const infoDiv = document.getElementById('waypoint-info');
        if (!infoDiv) return;

        if (!ac || !ac.routeId) {
            infoDiv.innerHTML = '';
            return;
        }

        const route = state.routes.find(r => r.id === ac.routeId);
        if (!route) return;

        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;

        let minDist = Infinity, currentIdx = 0;
        for (let i = 0; i < route.points.length; i++) {
            const dx = route.points[i].x - x, dy = route.points[i].y - y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) { minDist = d; currentIdx = i; }
        }

        const info = getPositionAndTimeForWaypoint(ac, currentIdx);
        if (!info) {
            infoDiv.innerHTML = '';
            return;
        }

        const pt = route.points[currentIdx];
        const ptName = pt.name || `P${pt.id}`;

        if (info.timeToReach >= 0) {
            infoDiv.innerHTML = `<div style="font-size:11px;color:#16a34a;margin-top:4px;">
                <strong>当前: ${ptName}</strong> | 距离: ${info.distance}km | 到达: ${info.timeToReach}秒<br>
                <span style="color:#64748b;">速度: ${ac.speed}kt | 航向: ${Math.round(ac.heading || 90)}°</span>
            </div>`;
        } else {
            infoDiv.innerHTML = `<div style="font-size:11px;color:#ea580c;margin-top:4px;">
                <strong>${ptName}</strong> - 已通过 (距离: ${Math.abs(info.distance)}km)
            </div>`;
        }
    }

    // 显示下一航路点选择弹窗
    function showNextWaypointDialog(ac, currentWaypointIdx) {
        const route = state.routes.find(r => r.id === ac.routeId);
        if (!route || route.points.length < 2) return;

        const dialog = document.getElementById('next-waypoint-dialog');
        const select = document.getElementById('next-waypoint-select');
        const currentNameDiv = document.getElementById('current-waypoint-name');
        const previewDiv = document.getElementById('next-waypoint-preview');

        // 设置当前到达的航路点名称
        const currentPt = route.points[currentWaypointIdx];
        currentNameDiv.textContent = currentPt.name || `P${currentPt.id}`;

        // 清空并填充选择框
        select.innerHTML = '<option value="">-- 请选择 --</option>';

        // 添加所有可用的航路点
        route.points.forEach((pt, idx) => {
            if (idx === currentWaypointIdx) return; // 跳过当前点

            const opt = document.createElement('option');
            opt.value = idx;
            const ptName = pt.name || `P${pt.id}`;

            // 标记前序点和后序点
            let label = '';
            if (idx === currentWaypointIdx - 1) label = ' (前序点)';
            else if (idx === currentWaypointIdx + 1) label = ' (后序点)';

            // 计算距离
            const distPx = Math.sqrt((pt.x - currentPt.x) ** 2 + (pt.y - currentPt.y) ** 2);
            const distKm = pxToKmFixed(distPx).toFixed(1);

            opt.textContent = `${ptName}${label} - ${distKm}km`;
            select.appendChild(opt);
        });

        // 默认选中后序点（如果有）
        if (currentWaypointIdx + 1 < route.points.length) {
            select.value = currentWaypointIdx + 1;
        } else if (currentWaypointIdx - 1 >= 0) {
            select.value = currentWaypointIdx - 1;
        }

        // 更新预览
        updateNextWaypointPreview(ac, currentWaypointIdx, select.value);

        select.onchange = function() {
            updateNextWaypointPreview(ac, currentWaypointIdx, this.value);
        };

        // 保存待处理的飞机信息
        state.pendingNextWaypointSelection = {
            aircraftId: ac.id,
            currentWaypointIdx: currentWaypointIdx
        };

        // 显示弹窗并暂停播放
        dialog.classList.remove('hidden');
        if (state.isPlaying) {
            state.isPausedForWaypointSelection = true;
            togglePlayPause();
        }
    }

    // 更新下一航路点预览
    function updateNextWaypointPreview(ac, currentIdx, nextIdx) {
        const previewDiv = document.getElementById('next-waypoint-preview');
        const route = state.routes.find(r => r.id === ac.routeId);

        if (!nextIdx || !route) {
            previewDiv.innerHTML = '<span style="color:#94a3b8;">请选择下一航路点</span>';
            return;
        }

        const nextIdxNum = parseInt(nextIdx);
        const nextPt = route.points[nextIdxNum];
        const currentPt = route.points[currentIdx];
        const distPx = Math.sqrt((nextPt.x - currentPt.x) ** 2 + (nextPt.y - currentPt.y) ** 2);
        const distKm = pxToKmFixed(distPx).toFixed(1);

        let directionText = '';
        if (nextIdxNum < currentIdx) directionText = '← 向前序点飞行';
        else if (nextIdxNum > currentIdx) directionText = '→ 向后序点飞行';

        previewDiv.innerHTML = `
            <div><strong>下一目标:</strong> ${nextPt.name || `P${nextPt.id}`}</div>
            <div><strong>距离:</strong> ${distKm}km</div>
            <div style="color:#2563eb;">${directionText}</div>
        `;
    }

    // 确认下一航路点选择
    document.getElementById('confirm-next-waypoint')?.addEventListener('click', function() {
        const select = document.getElementById('next-waypoint-select');
        const nextIdx = parseInt(select.value);

        if (isNaN(nextIdx)) {
            alert('请选择下一航路点');
            return;
        }

        if (state.pendingNextWaypointSelection) {
            const ac = state.aircraft.find(a => a.id === state.pendingNextWaypointSelection.aircraftId);
            if (ac) {
                ac.nextWaypointIdx = nextIdx;
                // 保存基础位置，使导航从当前点开始
                saveBasePositions();
            }
            state.pendingNextWaypointSelection = null;
        }

        document.getElementById('next-waypoint-dialog').classList.add('hidden');

        // 如果之前是播放状态，恢复播放
        if (state.isPausedForWaypointSelection) {
            state.isPausedForWaypointSelection = false;
            togglePlayPause();
        }
    });

    // 关闭弹窗时恢复播放
    document.querySelectorAll('#next-waypoint-dialog .dialog-close').forEach(btn => {
        btn.addEventListener('click', function() {
            if (state.isPausedForWaypointSelection) {
                state.isPausedForWaypointSelection = false;
                state.pendingNextWaypointSelection = null;
                togglePlayPause();
            }
        });
    });

    document.getElementById('ac-route')?.addEventListener('change', function() {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (!ac) return;
        const routeId = this.value;
        if (routeId) {
            ac.routeId = parseInt(routeId);
            ac.routeDistance = 0;
        } else {
            ac.routeId = null;
        }
        updateWaypointSelectOptions(state.editingAircraftId);
        updateWaypointInfo(ac);
    });

    document.getElementById('ac-nav-mode')?.addEventListener('change', function() {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (!ac) return;
        ac.navMode = this.value;
        updateNavModeUI(this.value);
        if (this.value !== 'free') {
            ac.targetX = undefined;
            ac.targetY = undefined;
        }
    });

    document.getElementById('select-target-btn')?.addEventListener('click', function() {
        if (!state.editingAircraftId) return;
        state.targetSelectMode = state.editingAircraftId;
        this.style.background = '#0369a1';
        this.style.color = 'white';
        document.getElementById('mode-indicator').textContent = '🎯 点击地图选择目标点...';
        document.getElementById('mode-indicator').style.background = '#e0f2fe';
        document.getElementById('mode-indicator').style.borderColor = '#7dd3fc';
        document.getElementById('mode-indicator').style.color = '#0369a1';
    });

    document.getElementById('input-target-coords-btn')?.addEventListener('click', function() {
        const coordsInput = document.getElementById('target-coords-input');
        coordsInput.style.display = coordsInput.style.display === 'none' ? '' : 'none';
    });

    document.getElementById('confirm-target-btn')?.addEventListener('click', function() {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (!ac) return;
        const tx = parseFloat(document.getElementById('target-x').value);
        const ty = parseFloat(document.getElementById('target-y').value);
        if (!isNaN(tx) && !isNaN(ty)) {
            ac.targetX = tx;
            ac.targetY = ty;
            ac.navMode = 'free';
            updateTargetInfo(ac);
        }
    });

    document.getElementById('save-aircraft').addEventListener('click', () => {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (!ac) return;
        ac.flightNo = document.getElementById('ac-flight-no').value.trim() || ac.flightNo;
        ac.squawk = document.getElementById('ac-squawk').value.trim();
        ac.departure = document.getElementById('ac-departure').value.trim();
        ac.destination = document.getElementById('ac-destination').value.trim();
        ac.acType = document.getElementById('ac-type').value.trim();
        ac.altitude = parseInt(document.getElementById('ac-altitude').value) || ac.altitude;
        ac.speed = parseInt(document.getElementById('ac-speed').value) || ac.speed;
        ac.heading = parseFloat(document.getElementById('ac-heading').value) || ac.heading;
        ac.navMode = document.getElementById('ac-nav-mode').value || 'heading';

        const nextWpVal = document.getElementById('ac-next-waypoint')?.value;
        if (nextWpVal !== '' && nextWpVal !== undefined && nextWpVal !== null) {
            ac.nextWaypointIdx = parseInt(nextWpVal);
            // 不再使用direction属性，导航完全基于前序/后序节点关系
        }

        if (ac.navMode === 'free') {
            const tx = parseFloat(document.getElementById('target-x').value);
            const ty = parseFloat(document.getElementById('target-y').value);
            if (!isNaN(tx) && !isNaN(ty)) {
                ac.targetX = tx;
                ac.targetY = ty;
            }
            ac.routeId = null;
        }
        const routeId = document.getElementById('ac-route').value;
        if (routeId && ac.navMode !== 'free') {
            ac.routeId = parseInt(routeId);
            ac.routeDistance = 0;
        } else if (ac.navMode !== 'free') {
            ac.routeId = null;
        }

        // 保存"到达目标点后询问下一航路点"设置
        const askNextWpCheckbox = document.getElementById('ac-ask-next-waypoint');
        ac.askNextWaypoint = askNextWpCheckbox ? askNextWpCheckbox.checked : false;

        saveBasePositions();
        document.getElementById('aircraft-edit-dialog').classList.add('hidden');
        updateAircraftPanelList();
        updateProgressList();
        updateCommTargetSelect();
    });

    document.getElementById('delete-aircraft-btn').addEventListener('click', () => {
        if (!state.editingAircraftId) return;
        state.aircraft = state.aircraft.filter(a => a.id !== state.editingAircraftId);
        state.connections = state.connections.filter(c => c.from !== state.editingAircraftId && c.to !== state.editingAircraftId);
        state.selectedItem = null;
        document.getElementById('aircraft-edit-dialog').classList.add('hidden');
        updateAircraftPanelList();
        updateProgressList();
        updateCommTargetSelect();
        updateModeIndicator();
    });

    document.getElementById('comm-send-btn').addEventListener('click', sendComm);
    document.getElementById('comm-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') sendComm();
    });

    function sendComm() {
        const input = document.getElementById('comm-input');
        const text = input.value.trim();
        if (!text) return;
        const target = document.getElementById('comm-target').value;
        if (target === 'atc') {
            addComm('atc', text);
            processCommand(text);
        } else {
            const ac = state.aircraft.find(a => a.id === parseInt(target));
            if (ac) {
                addComm('atc', `→${ac.flightNo}: ${text}`);
                addComm(ac.flightNo, `收到指令：${text}`);
            }
        }
        input.value = '';
    }

    function processCommand(text) {
        const lower = text.toLowerCase();
        if (lower.includes('加速') || lower.includes('增加速度')) {
            state.aircraft.forEach(ac => { if (state.time >= (ac.startTime || 0)) ac.speed = Math.min(600, (ac.speed || 480) + 20); });
            addComm('atc', '所有飞机速度增加20kt');
        } else if (lower.includes('减速') || lower.includes('减小速度')) {
            state.aircraft.forEach(ac => { if (state.time >= (ac.startTime || 0)) ac.speed = Math.max(200, (ac.speed || 480) - 20); });
            addComm('atc', '所有飞机速度减少20kt');
        } else if (lower.includes('上升') || lower.includes('爬升')) {
            state.aircraft.forEach(ac => { if (state.time >= (ac.startTime || 0)) ac.altitude = Math.min(15000, (ac.altitude || 10600) + 600); });
            addComm('atc', '所有飞机上升600m');
        } else if (lower.includes('下降')) {
            state.aircraft.forEach(ac => { if (state.time >= (ac.startTime || 0)) ac.altitude = Math.max(3000, (ac.altitude || 10600) - 600); });
            addComm('atc', '所有飞机下降600m');
        }
    }

    function addPointPanelItem(pt) {
        const list = document.getElementById('route-points-list');
        const item = document.createElement('div');
        item.className = 'panel-item';
        item.dataset.pointId = pt.id;
        const color = POINT_COLORS[pt.type] || POINT_COLORS.normal;
        item.innerHTML = `
            <span style="width:10px;height:10px;background:${color};border-radius:50%;display:inline-block;border:2px solid white;box-shadow:0 0 2px ${color};"></span>
            <span style="flex:1;font-size:12px;color:#1e293b;font-weight:600;">${pt.name}</span>
        `;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            if (!isEditMode()) return;
            state.selectedItem = { type: 'point', id: pt.id };
            updateModeIndicator();
            openPointDialog(pt.id);
        });
        list.appendChild(item);
    }

    function updatePointPanelList() {
        const list = document.getElementById('route-points-list');
        list.innerHTML = '';
        state.routePoints.forEach(pt => addPointPanelItem(pt));
    }

    function addRoutePanelItem(route) {
        const list = document.getElementById('route-list');
        const item = document.createElement('div');
        item.className = 'panel-item';
        item.dataset.routeId = route.id;
        item.innerHTML = `
            <span style="width:16px;height:2px;background:${route.color};display:inline-block;border-radius:1px;"></span>
            <span style="flex:1;font-size:12px;color:#1e293b;font-weight:600;">${route.name}</span>
        `;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            if (!isEditMode()) return;
            state.selectedItem = { type: 'route', id: route.id };
            updateModeIndicator();
            openRouteDialog(route.id);
        });
        list.appendChild(item);
    }

    function updateRoutePanelList() {
        const list = document.getElementById('route-list');
        list.innerHTML = '';
        state.routes.forEach(route => addRoutePanelItem(route));
    }

    function addAircraftPanelItem(ac) {
        const list = document.getElementById('aircraft-list');
        const item = document.createElement('div');
        item.className = 'panel-item';
        item.dataset.aircraftId = ac.id;
        const isSelected = state.selectedItem && state.selectedItem.type === 'aircraft' && state.selectedItem.id === ac.id;
        item.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16"><polygon points="12,2 22,22 12,17 2,22" fill="${isSelected ? '#006400' : '#1a1a2e'}" stroke="${isSelected ? '#228b22' : '#64748b'}" stroke-width="1"/></svg>
            <span style="flex:1;font-size:12px;color:${isSelected ? '#006400' : '#1e293b'};font-weight:600;">${ac.flightNo}</span>
        `;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            if (!isEditMode()) return;
            state.selectedItem = { type: 'aircraft', id: ac.id };
            updateModeIndicator();
            updateProgressList();
            openAircraftDialog(ac.id);
        });
        list.appendChild(item);
    }

    function updateAircraftPanelList() {
        const list = document.getElementById('aircraft-list');
        list.innerHTML = '';
        state.aircraft.forEach(ac => addAircraftPanelItem(ac));
    }

    function updateRouteSelectOptions() {
        const select = document.getElementById('ac-route');
        select.innerHTML = '<option value="">无（自由飞行）</option>';
        state.routes.forEach(route => {
            const opt = document.createElement('option');
            opt.value = route.id;
            opt.textContent = route.name || `航线${route.id}`;
            select.appendChild(opt);
        });
    }

    document.getElementById('play-pause-btn').addEventListener('click', () => {
        state.isPlaying = !state.isPlaying;
        document.getElementById('play-pause-btn').textContent = state.isPlaying ? '⏸ 暂停' : '▶ 播放';

        if (state.isPlaying) {
            saveBasePositions();
            updateAircraftPositionsForTime(state.time);
            updateProgressList();
        } else {
            saveBasePositions();
        }

        updateEditModeUI();
        updateModeIndicator();

        if (!state.isPlaying) {
            document.querySelectorAll('.dialog:not(.hidden)').forEach(d => d.classList.add('hidden'));
        }
    });

    document.getElementById('time-slider').addEventListener('input', e => {
        const newTime = parseInt(e.target.value);
        state.time = newTime;
        updateTimeDisplay();
        updateAircraftPositionsForTime(newTime);
    });

    document.getElementById('speed-select').addEventListener('change', e => {
        state.timeSpeed = parseInt(e.target.value);
    });

    document.getElementById('tool-delete').addEventListener('click', () => {
        if (!isEditMode() || !state.selectedItem) return;
        const { type, id } = state.selectedItem;
        if (type === 'aircraft') {
            state.aircraft = state.aircraft.filter(a => a.id !== id);
            state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
            updateAircraftPanelList();
            updateProgressList();
            updateCommTargetSelect();
        } else if (type === 'point') {
            state.routePoints = state.routePoints.filter(p => p.id !== id);
            state.routes = state.routes.filter(r => !r.points.some(p => p.id === id));
            updatePointPanelList();
            updateRoutePanelList();
        } else if (type === 'route') {
            state.routes = state.routes.filter(r => r.id !== id);
            state.aircraft.forEach(ac => { if (ac.routeId === id) { ac.routeId = null; } });
            updateRoutePanelList();
            updateProgressList();
        }
        state.selectedItem = null;
        updateModeIndicator();
        updateProgressList();
    });

    document.getElementById('help-btn').addEventListener('click', () => {
        document.getElementById('help-dialog').classList.remove('hidden');
    });

    document.getElementById('settings-btn').addEventListener('click', () => {
        if (!isEditMode()) return;
        document.getElementById('settings-dialog').classList.remove('hidden');
        document.getElementById('def-altitude').value = state.defaults.altitude;
        document.getElementById('def-speed').value = state.defaults.speed;
        document.getElementById('def-ac-type').value = state.defaults.acType;
        document.getElementById('def-squawk').value = state.defaults.squawk;
        document.getElementById('def-grid-spacing').value = state.defaults.gridSpacing;
        document.getElementById('min-separation-nm').value = state.defaults.minSeparationNm;
        document.getElementById('time-max-mins').value = Math.round(state.defaults.timeMax / 60);
    });

    document.getElementById('save-settings').addEventListener('click', () => {
        state.defaults.altitude = parseInt(document.getElementById('def-altitude').value) || 10600;
        state.defaults.speed = parseInt(document.getElementById('def-speed').value) || 480;
        state.defaults.acType = document.getElementById('def-ac-type').value || 'B738';
        state.defaults.squawk = document.getElementById('def-squawk').value || '2000';
        state.defaults.gridSpacing = parseInt(document.getElementById('def-grid-spacing').value) || 50;
        state.defaults.minSeparationNm = parseInt(document.getElementById('min-separation-nm').value) || 15;
        state.defaults.timeMax = parseInt(document.getElementById('time-max-mins').value) * 60 || 2400;
        if (state.time > state.defaults.timeMax) state.time = 0;
        document.getElementById('settings-dialog').classList.add('hidden');
        updateTimeDisplay();
        addComm('atc', '默认参数已更新');
    });

    document.querySelectorAll('.dialog-close').forEach(btn => {
        btn.addEventListener('click', () => { btn.closest('.dialog').classList.add('hidden'); });
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.dialog:not(.hidden)').forEach(d => d.classList.add('hidden'));
            if (state.routeConnectMode) {
                state.routeConnectMode = false;
                state.routeConnectPoints = [];
                document.getElementById('add-route-btn').classList.remove('active');
            }
            state.selectedItem = null;
            updateModeIndicator();
            updateProgressList();
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && isEditMode()) {
            if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
                document.getElementById('tool-delete').click();
            }
        }
        if (e.key === ' ') {
            if (document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                document.getElementById('play-pause-btn').click();
            }
        }
    });

    state.defaults = {
        altitude: 10600, speed: 480, acType: 'B738', squawk: '2000',
        gridSpacing: 50, minSeparationNm: 15, timeMax: 2400
    };

    updateModeIndicator();
    updateTimeDisplay();
    updateEditModeUI();
    addComm('atc', '空管雷达模拟器已启动');
    addComm('atc', '滚轮缩放地图 | ASWD或方向键移动 | 点击播放开始模拟');

    requestAnimationFrame(animate);

})();