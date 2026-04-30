(function () {
'use strict';

const { nodeRadius: NODE_RADIUS, edgeLabelSeparation: EDGE_LABEL_SEPARATION,
        nodeFriction: NODE_FRICTION, canvasFieldDist: CANVAS_FIELD_DIST,
        centeringStrength: CENTERING_STRENGTH, nodeDist: NODE_DIST,
        tension: TENSION, nodeRepulsion: NODE_REPULSION,
        nodeThickness: NODE_THICKNESS, edgeThickness: EDGE_THICKNESS } = window.GraphCoreConfig;

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isPointProjOutsideLine(a, b, p) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (!ab2) return true;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / ab2;
  return t < 0 || t > 1;
}

function isDark() {
  const doc = document.documentElement;
  const body = document.body;
  const theme = doc.dataset.theme || body.dataset.theme;
  if (theme === 'light') return false;
  if (theme === 'dark') return true;
  if (body.classList.contains('dark-mode') || body.classList.contains('theme-dark') || body.classList.contains('judge-dark')) return true;
  return theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getIdealCurvature(index) {
  let radius = Math.floor((index + 1) / 2);
  if (index % 2 === 1) radius *= -1;
  return radius;
}

function getCurveControlPoints(u, v, radius) {
  let px = u.y - v.y, py = v.x - u.x;
  const shouldFlip = radius < 0;
  px *= 0.5 * (shouldFlip ? -1 : 1) * Math.abs(radius);
  py *= 0.5 * (shouldFlip ? -1 : 1) * Math.abs(radius);
  return { p0c: { x: u.x + px, y: u.y + py }, p1c: { x: v.x + px, y: v.y + py } };
}

function getBezierPoint(u, c1, c2, v, t) {
  const tc = 1 - t;
  return {
    x: tc*tc*tc*u.x + 3*tc*tc*t*c1.x + 3*tc*t*t*c2.x + t*t*t*v.x,
    y: tc*tc*tc*u.y + 3*tc*tc*t*c1.y + 3*tc*t*t*c2.y + t*t*t*v.y,
  };
}

function getBezierTangent(u, c1, c2, v, t) {
  const tc = 1 - t;
  return {
    x: 3*tc*tc*(c1.x-u.x) + 6*tc*t*(c2.x-c1.x) + 3*t*t*(v.x-c2.x),
    y: 3*tc*tc*(c1.y-u.y) + 6*tc*t*(c2.y-c1.y) + 3*t*t*(v.y-c2.y),
  };
}

function getUpperNormal(tangent) {
  const length = Math.max(Math.hypot(tangent.x, tangent.y), 1e-6);
  const nA = { x: -tangent.y / length, y: tangent.x / length };
  const nB = { x: tangent.y / length, y: -tangent.x / length };
  return nA.y < nB.y ? nA : nB;
}

function findBezierBoundaryT(u, c1, c2, v, center, radius, nearEnd) {
  let lo = nearEnd ? 0.5 : 0.0, hi = nearEnd ? 1.0 : 0.5;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) / 2;
    const pt = getBezierPoint(u, c1, c2, v, m);
    const inside = Math.hypot(pt.x - center.x, pt.y - center.y) < radius;
    if (nearEnd) { if (inside) hi = m; else lo = m; }
    else { if (inside) lo = m; else hi = m; }
  }
  return (lo + hi) / 2;
}

function drawLine(ctx, edgeCurvMap, u, v, idealR, edgeKey, nodePositions, color) {
  if (!edgeCurvMap.has(edgeKey)) edgeCurvMap.set(edgeKey, idealR);
  let radius = edgeCurvMap.get(edgeKey);
  const steps = 10, flexLimit = 1.5;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let controls = getCurveControlPoints(u, v, radius);
  const nodeContrib = new Map();
  let prevPoint = u;
  for (let i = 1; i <= steps; i++) {
    const point = getBezierPoint(u, controls.p0c, controls.p1c, v, i / steps);
    if (i >= 2 && i <= 9) {
      const midpoint = mid(prevPoint, point);
      const baseDir = { x: point.x - prevPoint.x, y: point.y - prevPoint.y };
      nodePositions.forEach(pos => {
        if (isPointProjOutsideLine(u, v, pos)) return;
        const local = { x: pos.x - prevPoint.x, y: pos.y - prevPoint.y };
        const sign = baseDir.x * local.y - baseDir.y * local.x > 0 ? 1 : -1;
        const distance = dist2D(pos, midpoint);
        const current = nodeContrib.get(pos);
        if (current === undefined || distance < Math.abs(current)) nodeContrib.set(pos, sign * distance);
      });
    }
    prevPoint = point;
  }
  nodeContrib.forEach(contrib => {
    let value = 100 / Math.pow(Math.abs(contrib), 1.9);
    value = clamp(value, -0.3, 0.3);
    radius += (contrib > 0 ? -1 : 1) * value;
  });
  radius -= (radius - idealR) / 10;
  radius = clamp(radius, idealR - flexLimit, idealR + flexLimit);
  edgeCurvMap.set(edgeKey, radius);
  controls = getCurveControlPoints(u, v, radius);
  ctx.lineWidth = EDGE_THICKNESS;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(u.x, u.y);
  ctx.bezierCurveTo(controls.p0c.x, controls.p0c.y, controls.p1c.x, controls.p1c.y, v.x, v.y);
  ctx.stroke();
  return { radius, controls };
}

function drawArrow(ctx, u, v, curveData, nodeRadius, color, reversed) {
  const c1 = curveData.controls.p0c, c2 = curveData.controls.p1c;
  const center = reversed ? u : v;
  const t = findBezierBoundaryT(u, c1, c2, v, center, nodeRadius, !reversed);
  const pt = getBezierPoint(u, c1, c2, v, t);
  const arrowLength = nodeRadius * 0.9, arrowHalfWidth = nodeRadius * 0.42;
  const tBase = findBezierBoundaryT(u, c1, c2, v, center, nodeRadius + arrowLength, !reversed);
  const ptBase = getBezierPoint(u, c1, c2, v, tBase);
  const dx = pt.x - ptBase.x, dy = pt.y - ptBase.y;
  const alen = Math.max(Math.hypot(dx, dy), 1e-6);
  const ax = dx / alen, ay = dy / alen;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pt.x, pt.y);
  ctx.lineTo(ptBase.x + (-ay) * arrowHalfWidth, ptBase.y + ax * arrowHalfWidth);
  ctx.lineTo(ptBase.x - (-ay) * arrowHalfWidth, ptBase.y - ax * arrowHalfWidth);
  ctx.closePath();
  ctx.fill();
}

function drawEdgeLabel(ctx, u, v, curveData, label, color) {
  const labelPoint = getBezierPoint(u, curveData.controls.p0c, curveData.controls.p1c, v, 0.5);
  const tangent = getBezierTangent(u, curveData.controls.p0c, curveData.controls.p1c, v, 0.5);
  const normal = getUpperNormal(tangent);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = '13px Menlo, Monaco, Consolas, monospace';
  ctx.fillStyle = color;
  ctx.fillText(label, labelPoint.x + normal.x * EDGE_LABEL_SEPARATION, labelPoint.y + normal.y * EDGE_LABEL_SEPARATION);
}

function drawSelfLoop(ctx, nodePos, localIdx, total, label, color, isDirected) {
  const R = NODE_RADIUS;
  const spread = Math.PI / 6;
  const baseAngle = -Math.PI / 2 + (2 * Math.PI / total) * localIdx;
  const angle1 = baseAngle - spread, angle2 = baseAngle + spread;
  const p1 = { x: nodePos.x + R * Math.cos(angle1), y: nodePos.y + R * Math.sin(angle1) };
  const p2 = { x: nodePos.x + R * Math.cos(angle2), y: nodePos.y + R * Math.sin(angle2) };
  const ctrlDist = R * 2.8;
  const c1 = { x: nodePos.x + ctrlDist * Math.cos(angle1), y: nodePos.y + ctrlDist * Math.sin(angle1) };
  const c2 = { x: nodePos.x + ctrlDist * Math.cos(angle2), y: nodePos.y + ctrlDist * Math.sin(angle2) };
  ctx.lineWidth = EDGE_THICKNESS;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
  ctx.stroke();
  if (isDirected) {
    const dx = p2.x - c2.x, dy = p2.y - c2.y;
    const len = Math.max(Math.hypot(dx, dy), 1e-6);
    const ax = dx / len, ay = dy / len;
    const arrowLength = R * 0.9, arrowHalfWidth = R * 0.42;
    const ptBase = { x: p2.x - ax * arrowLength, y: p2.y - ay * arrowLength };
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(ptBase.x + (-ay) * arrowHalfWidth, ptBase.y + ax * arrowHalfWidth);
    ctx.lineTo(ptBase.x - (-ay) * arrowHalfWidth, ptBase.y - ax * arrowHalfWidth);
    ctx.closePath();
    ctx.fill();
  }
  if (label !== null) {
    const mid = getBezierPoint(p1, c1, c2, p2, 0.5);
    const outX = mid.x - nodePos.x, outY = mid.y - nodePos.y;
    const outLen = Math.max(Math.hypot(outX, outY), 1e-6);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = '13px Menlo, Monaco, Consolas, monospace';
    ctx.fillStyle = color;
    ctx.fillText(label, mid.x + (outX / outLen) * EDGE_LABEL_SEPARATION, mid.y + (outY / outLen) * EDGE_LABEL_SEPARATION);
  }
}

// state = { nodes, nodeMap, edges, edgeLabels, edgeCurvMap, directed }
function renderEdges(ctx, state) {
  const { nodes, nodeMap, edges, edgeLabels, edgeCurvMap, directed } = state;
  const edgeColor = isDark() ? '#e0e0e0' : '#231f20';
  const activeKeys = new Set();
  const selfLoopTotal = new Map(), selfLoopCurrent = new Map();

  edges.forEach(edge => {
    const parts = edge.split(' ');
    if (parts[0] === parts[1]) selfLoopTotal.set(parts[0], (selfLoopTotal.get(parts[0]) || 0) + 1);
  });

  edges.forEach(edge => {
    const parts = edge.split(' ');
    const from = parts[0], to = parts[1];
    const edgeIndex = parseInt(parts[2], 10);
    const reverse = from > to;
    const edgeBase = from + ' ' + to;
    const reverseEdge = to + ' ' + from + ' ' + edgeIndex;
    const idealR = getIdealCurvature(edgeIndex);
    const edgeKey = edgeBase + ' ' + edgeIndex;

    if (from === to) {
      activeKeys.add(edgeKey);
      const localIdx = selfLoopCurrent.get(from) || 0;
      selfLoopCurrent.set(from, localIdx + 1);
      drawSelfLoop(ctx, nodeMap.get(from).pos, localIdx, selfLoopTotal.get(from), edgeLabels.has(edge) ? edgeLabels.get(edge) : null, edgeColor, directed);
      return;
    }

    let start = nodeMap.get(from).pos, end = nodeMap.get(to).pos;
    if (reverse) { const temp = start; start = end; end = temp; }
    const otherNodes = [];
    nodes.forEach(node => { if (node !== from && node !== to) otherNodes.push(nodeMap.get(node).pos); });
    activeKeys.add(edgeKey);
    const curveData = drawLine(ctx, edgeCurvMap, start, end, idealR, edgeKey, otherNodes, edgeColor);
    if (directed) drawArrow(ctx, start, end, curveData, NODE_RADIUS, edgeColor, reverse);
    if (edgeLabels.has(edge)) {
      if (!edgeLabels.has(reverseEdge) || edge <= reverseEdge) {
        drawEdgeLabel(ctx, start, end, curveData, edgeLabels.get(edge), edgeColor);
      }
    }
  });

  Array.from(edgeCurvMap.keys()).forEach(key => { if (!activeKeys.has(key)) edgeCurvMap.delete(key); });
}

// state = { nodes, nodeMap }
function renderNodes(ctx, state) {
  const { nodes, nodeMap } = state;
  const dark = isDark();
  const stroke = dark ? '#e0e0e0' : '#231f20';
  const fill = dark ? '#181818' : '#ffffff';
  const textColor = dark ? '#e0e0e0' : '#231f20';
  nodes.forEach(node => {
    const pos = nodeMap.get(node).pos;
    ctx.lineWidth = NODE_THICKNESS;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, NODE_RADIUS - 0.75, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 13px "Segoe UI", "Lucida Grande", Arial, sans-serif';
    ctx.fillStyle = textColor;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(node, pos.x, pos.y + 0.5);
  });
}

// state = { nodes, nodeMap, canvasW, canvasH, adjSet, layerMap }
// config = { nodeDist, tension, nodeRepulsion } — optional, falls back to defaults
function updateVelocities(state, config) {
  const { nodes, nodeMap, canvasW, canvasH, adjSet, layerMap } = state;
  const nodeDist = (config && config.nodeDist != null) ? config.nodeDist : NODE_DIST;
  const tension = (config && config.tension != null) ? config.tension : TENSION;
  const nodeRepulsion = (config && config.nodeRepulsion != null) ? config.nodeRepulsion : NODE_REPULSION;

  let centerOfMass = { x: canvasW / 2, y: canvasH / 2 };
  if (nodes.length) {
    centerOfMass = nodes.reduce((acc, node) => {
      const pos = nodeMap.get(node).pos;
      acc.x += pos.x; acc.y += pos.y; return acc;
    }, { x: 0, y: 0 });
    centerOfMass.x /= nodes.length;
    centerOfMass.y /= nodes.length;
  }
  const centerDx = canvasW / 2 - centerOfMass.x;
  const centerDy = canvasH / 2 - centerOfMass.y;

  nodes.forEach(u => {
    const uNode = nodeMap.get(u);
    const uPos = uNode.pos;

    nodes.forEach(v => {
      if (v === u) return;
      const vPos = nodeMap.get(v).pos;
      const distance = Math.max(dist2D(uPos, vPos), 10);
      let acceleration = 150000 / (2 * Math.pow(distance, 4.5 - nodeRepulsion));
      const isEdge = adjSet.get(u).has(v) || adjSet.get(v).has(u);
      if (isEdge) {
        acceleration = Math.pow(Math.abs(distance - nodeDist), tension) / 100000;
        if (distance >= nodeDist) acceleration *= -1;
      }
      const ax = vPos.x - uPos.x, ay = vPos.y - uPos.y;
      uNode.vel = {
        x: clamp((uNode.vel.x - acceleration * ax) * (1 - NODE_FRICTION), -100, 100),
        y: clamp((uNode.vel.y - acceleration * ay) * (1 - NODE_FRICTION), -100, 100),
      };
    });

    const borderXSign = canvasW / 2 - uPos.x >= 0 ? 1 : -1;
    const borderYSign = canvasH / 2 - uPos.y >= 0 ? 1 : -1;
    let borderAx = 0, borderAy = 0;
    if (Math.min(uPos.x, canvasW - uPos.x) <= CANVAS_FIELD_DIST)
      borderAx = Math.pow(canvasW / 2 - uPos.x, 2) * borderXSign / 500000;
    if (Math.min(uPos.y, canvasH - uPos.y) <= CANVAS_FIELD_DIST)
      borderAy = Math.pow(canvasH / 2 - uPos.y, 2) * borderYSign / 500000;

    uNode.vel = {
      x: clamp((uNode.vel.x + borderAx) * (1 - NODE_FRICTION), -100, 100),
      y: clamp((uNode.vel.y + borderAy) * (1 - NODE_FRICTION), -100, 100),
    };
    uNode.vel = {
      x: clamp((uNode.vel.x + centerDx * CENTERING_STRENGTH) * (1 - NODE_FRICTION * 0.2), -100, 100),
      y: clamp((uNode.vel.y + centerDy * CENTERING_STRENGTH) * (1 - NODE_FRICTION * 0.2), -100, 100),
    };

    if (layerMap && layerMap.has(u)) {
      const [depth, maxDepth] = layerMap.get(u);
      let layerHeight = (nodeDist * 4) / 5;
      if (maxDepth * layerHeight >= canvasH - 2 * CANVAS_FIELD_DIST) {
        layerHeight = (canvasH - 2 * CANVAS_FIELD_DIST) / maxDepth;
      }
      const yTarget = CANVAS_FIELD_DIST + (depth - 0.5) * layerHeight;
      let ay = Math.pow(Math.abs(uPos.y - yTarget), 1.75) / 100;
      if (uPos.y > yTarget) ay *= -1;
      uNode.vel.y = clamp((uNode.vel.y + ay) * (1 - NODE_FRICTION), -100, 100);
    }

    uNode.pos = { x: uPos.x + uNode.vel.x, y: uPos.y + uNode.vel.y };
  });

  nodes.forEach(node => {
    const current = nodeMap.get(node);
    current.pos.x = clamp(current.pos.x, NODE_RADIUS, canvasW - NODE_RADIUS);
    current.pos.y = clamp(current.pos.y, NODE_RADIUS, canvasH - NODE_RADIUS);
  });
}

function parseInput(text) {
  const lines = text.trim().split('\n')
    .map(line => line.trim().split(/\s+/).filter(Boolean))
    .filter(parts => parts.length > 0);

  const newNodes = [], newAdj = new Map(), newEdges = [], newLabels = new Map(), baseEdgeCount = new Map();

  function addNode(node) {
    if (!newAdj.has(node)) { newNodes.push(node); newAdj.set(node, []); }
  }

  lines.forEach(parts => {
    if (parts.length === 1) { addNode(parts[0]); return; }
    if (parts.length >= 2) {
      const u = parts[0], v = parts[1], w = parts[2] || null;
      if (u === v) {
        addNode(u);
        const selfBase = u + ' ' + u;
        const selfIndex = baseEdgeCount.has(selfBase) ? baseEdgeCount.get(selfBase) + 1 : 0;
        baseEdgeCount.set(selfBase, selfIndex);
        const selfKey = selfBase + ' ' + selfIndex;
        newEdges.push(selfKey);
        if (w !== null) newLabels.set(selfKey, w);
        return;
      }
      addNode(u); addNode(v);
      if (!newAdj.get(u).includes(v)) newAdj.get(u).push(v);
      const base = u <= v ? u + ' ' + v : v + ' ' + u;
      const nextIndex = baseEdgeCount.has(base) ? baseEdgeCount.get(base) + 1 : 0;
      baseEdgeCount.set(base, nextIndex);
      const edgeKey = u + ' ' + v + ' ' + nextIndex;
      newEdges.push(edgeKey);
      if (w !== null) newLabels.set(edgeKey, w);
    }
  });

  return { nodes: newNodes, adj: newAdj, edges: newEdges, edgeLabels: newLabels, edgeToPos: baseEdgeCount };
}

function buildLayers(nodesList, adjMap) {
  const combined = new Map();
  nodesList.forEach(node => combined.set(node, []));
  adjMap.forEach((neighbors, u) => {
    neighbors.forEach(v => {
      if (!combined.get(u).includes(v)) combined.get(u).push(v);
      if (!combined.has(v)) combined.set(v, []);
      if (!combined.get(v).includes(u)) combined.get(v).push(u);
    });
  });

  const layers = new Map();
  const seen = new Set();

  function findMax(node, depth) {
    seen.add(node);
    let max = depth;
    (combined.get(node) || []).forEach(next => { if (!seen.has(next)) max = Math.max(max, findMax(next, depth + 1)); });
    return max;
  }

  function assign(node, depth, maxDepth) {
    seen.add(node);
    layers.set(node, [depth, maxDepth]);
    (combined.get(node) || []).forEach(next => { if (!seen.has(next)) assign(next, depth + 1, maxDepth); });
  }

  nodesList.forEach(node => {
    if (!layers.has(node)) {
      seen.clear(); const maxDepth = findMax(node, 1);
      seen.clear(); assign(node, 1, maxDepth);
    }
  });

  return layers;
}

window.GraphCore = {
  NODE_RADIUS, EDGE_LABEL_SEPARATION, NODE_FRICTION, CANVAS_FIELD_DIST,
  CENTERING_STRENGTH, NODE_DIST, TENSION, NODE_REPULSION, NODE_THICKNESS, EDGE_THICKNESS,
  clamp, dist2D, isPointProjOutsideLine, isDark, getIdealCurvature,
  getCurveControlPoints, getBezierPoint, getBezierTangent, getUpperNormal, findBezierBoundaryT,
  drawLine, drawArrow, drawEdgeLabel, drawSelfLoop,
  renderEdges, renderNodes, updateVelocities,
  parseInput, buildLayers,
};

}());
