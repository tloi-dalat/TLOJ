(function () {
'use strict';

const NODE_FRICTION = 0.05;
const CANVAS_FIELD_DIST = 50;
const FPS = 60;
const NODE_RADIUS = 16;
const EDGE_LABEL_SEPARATION = 14;
const CENTERING_STRENGTH = 0.00085;
const NODE_DIST = 112;
const TENSION = 1.6;
const NODE_REPULSION = 0.0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isPointProjOutsideLine(a, b, p) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
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

class GraphViewer {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.wrap = canvasEl.parentElement;

    this.nodes = [];
    this.nodeMap = new Map();
    this.adj = new Map();
    this.adjSet = new Map();
    this.edges = [];
    this.edgeLabels = new Map();
    this.edgeCurvMap = new Map();
    this.edgeToPos = new Map();
    this.layerMap = null;

    this.directed = false;
    this.tree = false;

    this.canvasW = 0;
    this.canvasH = 0;
    this.dpr = window.devicePixelRatio || 1;

    this.dragNode = null;
    this.mousePos = { x: 0, y: 0 };
    this.animId = null;

    this.wrap.style.border = 'none';
    this.wrap.style.borderRadius = '0';

    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    this.wrap.appendChild(this.overlay);

    this.resizeCanvas();
    this.parseAndApply();
    this.bindEvents();
    this.startLoop();

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resizeCanvas());
      this._ro.observe(this.wrap);
    }
  }

  parseAndApply() {
    try {
      const data = JSON.parse(atob(this.canvas.dataset.graphB64) || '{}');
      this.directed = !!data.directed;
      this.tree = !!data.tree;
      const text = (data.edges || '').trim();
      if (!text) return;
      const parsed = this.parseInput(text);
      if (parsed.nodes.length) this.applyGraph(parsed);
    } catch (e) {
      // silently ignore parse errors
    }
  }

  parseInput(text) {
    const lines = text.trim().split('\n')
      .map(line => line.trim().split(/\s+/).filter(Boolean))
      .filter(parts => parts.length > 0);

    const newNodes = [];
    const newAdj = new Map();
    const newEdges = [];
    const newLabels = new Map();
    const baseEdgeCount = new Map();

    function addNode(node) {
      if (!newAdj.has(node)) {
        newNodes.push(node);
        newAdj.set(node, []);
      }
    }

    lines.forEach(parts => {
      if (parts.length === 1) {
        addNode(parts[0]);
        return;
      }
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
        addNode(u);
        addNode(v);
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

  applyGraph(parsed) {
    const oldNodeMap = new Map(this.nodeMap);
    this.nodes = parsed.nodes;
    this.adj = parsed.adj;
    this.edges = parsed.edges;
    this.edgeLabels = parsed.edgeLabels;
    this.edgeToPos = parsed.edgeToPos;

    this.nodeMap.clear();
    this.nodes.forEach(node => {
      if (oldNodeMap.has(node)) {
        this.nodeMap.set(node, oldNodeMap.get(node));
      } else {
        this.nodeMap.set(node, {
          pos: {
            x: this.canvasW / 4 + Math.random() * this.canvasW / 2,
            y: this.canvasH / 4 + Math.random() * this.canvasH / 2,
          },
          vel: { x: 0, y: 0 },
        });
      }
    });

    this.adjSet.clear();
    this.nodes.forEach(node => this.adjSet.set(node, new Set(this.adj.get(node) || [])));
    this.edgeCurvMap.clear();
    this.layerMap = this.tree ? this.buildLayers() : null;
  }

  buildLayers() {
    const combined = new Map();
    this.nodes.forEach(node => combined.set(node, []));
    this.adj.forEach((neighbors, u) => {
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
      (combined.get(node) || []).forEach(next => {
        if (!seen.has(next)) max = Math.max(max, findMax(next, depth + 1));
      });
      return max;
    }

    function assign(node, depth, maxDepth) {
      seen.add(node);
      layers.set(node, [depth, maxDepth]);
      (combined.get(node) || []).forEach(next => {
        if (!seen.has(next)) assign(next, depth + 1, maxDepth);
      });
    }

    this.nodes.forEach(node => {
      if (!layers.has(node)) {
        seen.clear();
        const maxDepth = findMax(node, 1);
        seen.clear();
        assign(node, 1, maxDepth);
      }
    });

    return layers;
  }

  updateVelocities() {
    const canvasW = this.canvasW, canvasH = this.canvasH;
    let centerOfMass = { x: canvasW / 2, y: canvasH / 2 };
    if (this.nodes.length) {
      centerOfMass = this.nodes.reduce((acc, node) => {
        const pos = this.nodeMap.get(node).pos;
        acc.x += pos.x; acc.y += pos.y; return acc;
      }, { x: 0, y: 0 });
      centerOfMass.x /= this.nodes.length;
      centerOfMass.y /= this.nodes.length;
    }
    const centerDx = canvasW / 2 - centerOfMass.x;
    const centerDy = canvasH / 2 - centerOfMass.y;

    this.nodes.forEach(u => {
      const uNode = this.nodeMap.get(u);
      const uPos = uNode.pos;

      this.nodes.forEach(v => {
        if (v === u) return;
        const vPos = this.nodeMap.get(v).pos;
        const distance = Math.max(dist2D(uPos, vPos), 10);
        let acceleration = 150000 / (2 * Math.pow(distance, 4.5 - NODE_REPULSION));
        const isEdge = this.adjSet.get(u).has(v) || this.adjSet.get(v).has(u);
        if (isEdge) {
          acceleration = Math.pow(Math.abs(distance - NODE_DIST), TENSION) / 100000;
          if (distance >= NODE_DIST) acceleration *= -1;
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

      if (this.layerMap && this.layerMap.has(u)) {
        const [depth, maxDepth] = this.layerMap.get(u);
        let layerHeight = (NODE_DIST * 4) / 5;
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

    this.nodes.forEach(node => {
      const current = this.nodeMap.get(node);
      current.pos.x = clamp(current.pos.x, NODE_RADIUS, canvasW - NODE_RADIUS);
      current.pos.y = clamp(current.pos.y, NODE_RADIUS, canvasH - NODE_RADIUS);
    });
  }

  getCurveControlPoints(u, v, radius) {
    let px = u.y - v.y, py = v.x - u.x;
    const shouldFlip = radius < 0;
    px *= 0.5 * (shouldFlip ? -1 : 1) * Math.abs(radius);
    py *= 0.5 * (shouldFlip ? -1 : 1) * Math.abs(radius);
    return { p0c: { x: u.x + px, y: u.y + py }, p1c: { x: v.x + px, y: v.y + py } };
  }

  getBezierPoint(u, c1, c2, v, t) {
    const tc = 1 - t;
    return {
      x: tc*tc*tc*u.x + 3*tc*tc*t*c1.x + 3*tc*t*t*c2.x + t*t*t*v.x,
      y: tc*tc*tc*u.y + 3*tc*tc*t*c1.y + 3*tc*t*t*c2.y + t*t*t*v.y,
    };
  }

  getBezierTangent(u, c1, c2, v, t) {
    const tc = 1 - t;
    return {
      x: 3*tc*tc*(c1.x-u.x) + 6*tc*t*(c2.x-c1.x) + 3*t*t*(v.x-c2.x),
      y: 3*tc*tc*(c1.y-u.y) + 6*tc*t*(c2.y-c1.y) + 3*t*t*(v.y-c2.y),
    };
  }

  getUpperNormal(tangent) {
    const length = Math.max(Math.hypot(tangent.x, tangent.y), 1e-6);
    const nA = { x: -tangent.y / length, y: tangent.x / length };
    const nB = { x: tangent.y / length, y: -tangent.x / length };
    return nA.y < nB.y ? nA : nB;
  }

  drawLine(u, v, idealR, edgeKey, nodePositions, color) {
    const ctx = this.ctx;
    if (!this.edgeCurvMap.has(edgeKey)) this.edgeCurvMap.set(edgeKey, idealR);
    let radius = this.edgeCurvMap.get(edgeKey);
    const steps = 10, flexLimit = 1.5;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    let controls = this.getCurveControlPoints(u, v, radius);
    const nodeContrib = new Map();
    let prevPoint = u;

    for (let i = 1; i <= steps; i++) {
      const point = this.getBezierPoint(u, controls.p0c, controls.p1c, v, i / steps);
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
    this.edgeCurvMap.set(edgeKey, radius);
    controls = this.getCurveControlPoints(u, v, radius);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(u.x, u.y);
    ctx.bezierCurveTo(controls.p0c.x, controls.p0c.y, controls.p1c.x, controls.p1c.y, v.x, v.y);
    ctx.stroke();

    return { radius, controls };
  }

  findBezierBoundaryT(u, c1, c2, v, center, radius, nearEnd) {
    let lo = nearEnd ? 0.5 : 0.0, hi = nearEnd ? 1.0 : 0.5;
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2;
      const pt = this.getBezierPoint(u, c1, c2, v, m);
      const inside = Math.hypot(pt.x - center.x, pt.y - center.y) < radius;
      if (nearEnd) { if (inside) hi = m; else lo = m; }
      else { if (inside) lo = m; else hi = m; }
    }
    return (lo + hi) / 2;
  }

  drawArrow(u, v, curveData, nodeRadius, color, reversed) {
    const ctx = this.ctx;
    const c1 = curveData.controls.p0c, c2 = curveData.controls.p1c;
    const center = reversed ? u : v;
    const t = this.findBezierBoundaryT(u, c1, c2, v, center, nodeRadius, !reversed);
    const pt = this.getBezierPoint(u, c1, c2, v, t);
    const arrowLength = nodeRadius * 0.9, arrowHalfWidth = nodeRadius * 0.42;
    const tBase = this.findBezierBoundaryT(u, c1, c2, v, center, nodeRadius + arrowLength, !reversed);
    const ptBase = this.getBezierPoint(u, c1, c2, v, tBase);
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

  drawEdgeLabel(u, v, curveData, label, color) {
    const ctx = this.ctx;
    const labelPoint = this.getBezierPoint(u, curveData.controls.p0c, curveData.controls.p1c, v, 0.5);
    const tangent = this.getBezierTangent(u, curveData.controls.p0c, curveData.controls.p1c, v, 0.5);
    const normal = this.getUpperNormal(tangent);
    const labelX = labelPoint.x + normal.x * EDGE_LABEL_SEPARATION;
    const labelY = labelPoint.y + normal.y * EDGE_LABEL_SEPARATION;
    ctx.lineWidth = 1.5;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = '13px Menlo, Monaco, Consolas, monospace';
    ctx.fillStyle = color;
    ctx.fillText(label, labelX, labelY);
  }

  drawSelfLoop(nodePos, localIdx, total, label, color, isDirected) {
    const ctx = this.ctx;
    const R = NODE_RADIUS;
    const spread = Math.PI / 6;
    const baseAngle = -Math.PI / 2 + (2 * Math.PI / total) * localIdx;
    const angle1 = baseAngle - spread, angle2 = baseAngle + spread;
    const p1 = { x: nodePos.x + R * Math.cos(angle1), y: nodePos.y + R * Math.sin(angle1) };
    const p2 = { x: nodePos.x + R * Math.cos(angle2), y: nodePos.y + R * Math.sin(angle2) };
    const ctrlDist = R * 2.8;
    const c1 = { x: nodePos.x + ctrlDist * Math.cos(angle1), y: nodePos.y + ctrlDist * Math.sin(angle1) };
    const c2 = { x: nodePos.x + ctrlDist * Math.cos(angle2), y: nodePos.y + ctrlDist * Math.sin(angle2) };
    ctx.lineWidth = 1.5;
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
      const mid = this.getBezierPoint(p1, c1, c2, p2, 0.5);
      const outX = mid.x - nodePos.x, outY = mid.y - nodePos.y;
      const outLen = Math.max(Math.hypot(outX, outY), 1e-6);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.font = '13px Menlo, Monaco, Consolas, monospace';
      ctx.fillStyle = color;
      ctx.fillText(label, mid.x + (outX / outLen) * EDGE_LABEL_SEPARATION, mid.y + (outY / outLen) * EDGE_LABEL_SEPARATION);
    }
  }

  renderEdges(dark) {
    const edgeColor = dark ? '#e0e0e0' : '#231f20';
    const activeKeys = new Set();
    const selfLoopTotal = new Map(), selfLoopCurrent = new Map();

    this.edges.forEach(edge => {
      const parts = edge.split(' ');
      if (parts[0] === parts[1]) selfLoopTotal.set(parts[0], (selfLoopTotal.get(parts[0]) || 0) + 1);
    });

    this.edges.forEach(edge => {
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
        this.drawSelfLoop(this.nodeMap.get(from).pos, localIdx, selfLoopTotal.get(from), this.edgeLabels.has(edge) ? this.edgeLabels.get(edge) : null, edgeColor, this.directed);
        return;
      }

      let start = this.nodeMap.get(from).pos, end = this.nodeMap.get(to).pos;
      if (reverse) { const temp = start; start = end; end = temp; }

      const otherNodes = [];
      this.nodes.forEach(node => { if (node !== from && node !== to) otherNodes.push(this.nodeMap.get(node).pos); });

      activeKeys.add(edgeKey);
      const curveData = this.drawLine(start, end, idealR, edgeKey, otherNodes, edgeColor);

      if (this.directed) this.drawArrow(start, end, curveData, NODE_RADIUS, edgeColor, reverse);

      if (this.edgeLabels.has(edge)) {
        if (!this.edgeLabels.has(reverseEdge) || edge <= reverseEdge) {
          this.drawEdgeLabel(start, end, curveData, this.edgeLabels.get(edge), edgeColor);
        }
      }
    });

    Array.from(this.edgeCurvMap.keys()).forEach(key => { if (!activeKeys.has(key)) this.edgeCurvMap.delete(key); });
  }

  renderNodes(dark) {
    const ctx = this.ctx;
    const stroke = dark ? '#e0e0e0' : '#231f20';
    const fill = dark ? '#181818' : '#ffffff';
    const textColor = dark ? '#e0e0e0' : '#231f20';

    this.nodes.forEach(node => {
      const pos = this.nodeMap.get(node).pos;
      ctx.lineWidth = 1.5;
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

  render() {
    const dark = isDark();
    const ctx = this.ctx;
    const dpr = this.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = dark ? '#181818' : '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.dragNode) {
      const current = this.nodeMap.get(this.dragNode);
      current.pos.x = clamp(this.mousePos.x, NODE_RADIUS, this.canvasW - NODE_RADIUS);
      current.pos.y = clamp(this.mousePos.y, NODE_RADIUS, this.canvasH - NODE_RADIUS);
    }

    this.renderEdges(dark);
    this.renderNodes(dark);
    this.updateVelocities();
  }

  resizeCanvas() {
    this.dpr = window.devicePixelRatio || 1;
    const width = this.wrap.clientWidth;
    const height = this.wrap.clientHeight;

    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.overlay.width = Math.round(width * this.dpr);
    this.overlay.height = Math.round(height * this.dpr);

    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.overlay.style.width = width + 'px';
    this.overlay.style.height = height + 'px';

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.canvasW = width;
    this.canvasH = height;
  }

  getNodeAt(x, y) {
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (dist2D(this.nodeMap.get(node).pos, { x, y }) <= NODE_RADIUS) return node;
    }
    return null;
  }

  bindEvents() {
    const overlay = this.overlay;

    overlay.addEventListener('pointerdown', e => {
      e.preventDefault();
      const node = this.getNodeAt(e.offsetX, e.offsetY);
      if (node) {
        this.dragNode = node;
        this.mousePos = { x: e.offsetX, y: e.offsetY };
        this.nodeMap.get(node).vel = { x: 0, y: 0 };
        overlay.setPointerCapture(e.pointerId);
        overlay.style.cursor = 'grabbing';
      }
    });

    overlay.addEventListener('pointermove', e => {
      if (this.dragNode) {
        this.mousePos = { x: e.offsetX, y: e.offsetY };
        const current = this.nodeMap.get(this.dragNode);
        current.vel = { x: 0, y: 0 };
        current.pos.x = clamp(e.offsetX, NODE_RADIUS, this.canvasW - NODE_RADIUS);
        current.pos.y = clamp(e.offsetY, NODE_RADIUS, this.canvasH - NODE_RADIUS);
      } else {
        overlay.style.cursor = this.getNodeAt(e.offsetX, e.offsetY) ? 'pointer' : 'default';
      }
    });

    overlay.addEventListener('pointerup', () => {
      this.dragNode = null;
      overlay.style.cursor = 'default';
    });

    overlay.addEventListener('pointerleave', () => {
      this.dragNode = null;
      overlay.style.cursor = 'default';
    });
  }

  startLoop() {
    if (this.animId) clearInterval(this.animId);
    this.animId = setInterval(() => requestAnimationFrame(() => this.render()), 1000 / FPS);
  }

  stopLoop() {
    if (this.animId) { clearInterval(this.animId); this.animId = null; }
  }
}

function initGraphViewers(root) {
  root.querySelectorAll('.graph-viewer-canvas').forEach(function (el) {
    if (!el._graphViewer) {
      el._graphViewer = new GraphViewer(el);
    }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  initGraphViewers(document);

  // MutationObserver for dynamically injected content
  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.classList.contains('graph-viewer-canvas')) {
          if (!node._graphViewer) node._graphViewer = new GraphViewer(node);
        } else {
          initGraphViewers(node);
        }
      });
    });
  }).observe(document.body, { childList: true, subtree: true });

  // Martor preview hook (more reliable for the problem editor preview pane)
  if (typeof $ !== 'undefined') {
    $(document).on('martor:preview', function (e, $tab) {
      initGraphViewers($tab[0]);
    });
  }
});

}());
