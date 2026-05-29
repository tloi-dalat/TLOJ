(function () {
'use strict';

const { clamp, dist2D, isDark, NODE_RADIUS, renderEdges, renderNodes, updateGraphLayout, parseInput } = window.GraphCore;

const FPS = 60;

function GraphViewer(canvasEl) {
  this.canvas = canvasEl;
  this.ctx = canvasEl.getContext('2d');
  this.wrap = canvasEl.parentElement;

  this.nodes = [];
  this.nodeMap = new Map();
  this.edges = [];
  this.edgeLabels = new Map();
  this.edgeCurvMap = new Map();

  this.directed = false;

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

  const self = this;
  this.resizeCanvas();
  this.parseAndApply();
  this.bindEvents();
  this.startLoop();

  if (typeof ResizeObserver !== 'undefined') {
    this._ro = new ResizeObserver(function () { self.resizeCanvas(); });
    this._ro.observe(this.wrap);
  }
}

GraphViewer.prototype.parseAndApply = function () {
  try {
    const data = JSON.parse(atob(this.canvas.dataset.graphB64 || '') || '{}');
    this.directed = !!data.directed;
    const text = (data.edges || '').trim();
    if (!text) return;
    const parsed = parseInput(text);
    if (parsed.nodes.length) this.applyGraph(parsed);
  } catch (e) {}
};

GraphViewer.prototype.applyGraph = function (parsed) {
  const oldNodeMap = new Map(this.nodeMap);
  const self = this;

  this.nodes = parsed.nodes;
  this.edges = parsed.edges;
  this.edgeLabels = parsed.edgeLabels;

  this.nodeMap.clear();
  this.nodes.forEach(function (node) {
    if (oldNodeMap.has(node)) {
      self.nodeMap.set(node, oldNodeMap.get(node));
    } else {
      self.nodeMap.set(node, {
        pos: {
          x: self.canvasW / 4 + Math.random() * self.canvasW / 2,
          y: self.canvasH / 4 + Math.random() * self.canvasH / 2,
        },
      });
    }
  });

  this.edgeCurvMap.clear();
};

GraphViewer.prototype.render = function () {
  const ctx = this.ctx;
  const dpr = this.dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = isDark() ? '#181818' : '#ffffff';
  ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (this.dragNode) {
    const current = this.nodeMap.get(this.dragNode);
    current.pos.x = clamp(this.mousePos.x, NODE_RADIUS, this.canvasW - NODE_RADIUS);
    current.pos.y = clamp(this.mousePos.y, NODE_RADIUS, this.canvasH - NODE_RADIUS);
  }

  renderEdges(ctx, this);
  renderNodes(ctx, this);
  updateGraphLayout(this.nodes, this.nodeMap, this.edges, this.dragNode, this.canvasW, this.canvasH);
};

GraphViewer.prototype.resizeCanvas = function () {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, this.wrap.clientWidth);
  const height = Math.max(1, this.wrap.clientHeight);

  if (this.canvasW === width && this.canvasH === height && this.dpr === dpr) {
    return;
  }

  const wasDegenerate = this.canvasW < 10 || this.canvasH < 10;

  this.dpr = dpr;
  this.canvasW = width;
  this.canvasH = height;

  const bitmapW = Math.round(width * dpr);
  const bitmapH = Math.round(height * dpr);

  this.canvas.width = bitmapW;
  this.canvas.height = bitmapH;
  this.overlay.width = bitmapW;
  this.overlay.height = bitmapH;

  this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (wasDegenerate && this.nodes.length) {
    const self = this;
    this.nodes.forEach(function (node) {
      const data = self.nodeMap.get(node);
      data.pos.x = width / 4 + Math.random() * width / 2;
      data.pos.y = height / 4 + Math.random() * height / 2;
    });
  }
};

GraphViewer.prototype.getNodeAt = function (x, y) {
  for (let i = 0; i < this.nodes.length; i++) {
    const node = this.nodes[i];
    if (dist2D(this.nodeMap.get(node).pos, { x: x, y: y }) <= NODE_RADIUS) return node;
  }
  return null;
};

GraphViewer.prototype.bindEvents = function () {
  const self = this;
  const overlay = this.overlay;

  overlay.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    const node = self.getNodeAt(e.offsetX, e.offsetY);
    if (node) {
      self.dragNode = node;
      self.mousePos = { x: e.offsetX, y: e.offsetY };
      overlay.setPointerCapture(e.pointerId);
      overlay.style.cursor = 'grabbing';
    }
  });

  overlay.addEventListener('pointermove', function (e) {
    if (self.dragNode) {
      self.mousePos = { x: e.offsetX, y: e.offsetY };
      const current = self.nodeMap.get(self.dragNode);
      current.pos.x = clamp(e.offsetX, NODE_RADIUS, self.canvasW - NODE_RADIUS);
      current.pos.y = clamp(e.offsetY, NODE_RADIUS, self.canvasH - NODE_RADIUS);
    } else {
      overlay.style.cursor = self.getNodeAt(e.offsetX, e.offsetY) ? 'pointer' : 'default';
    }
  });

  overlay.addEventListener('pointerup', function () {
    self.dragNode = null;
    overlay.style.cursor = 'default';
  });

  overlay.addEventListener('pointerleave', function () {
    self.dragNode = null;
    overlay.style.cursor = 'default';
  });
};

GraphViewer.prototype.startLoop = function () {
  const self = this;
  if (this.animId) clearInterval(this.animId);
  this.animId = setInterval(function () {
    requestAnimationFrame(function () { self.render(); });
  }, 1000 / FPS);
};

GraphViewer.prototype.stopLoop = function () {
  if (this.animId) { clearInterval(this.animId); this.animId = null; }
};

function initGraphViewers(root) {
  root.querySelectorAll('.graph-viewer-canvas').forEach(function (el) {
    if (!el._graphViewer) el._graphViewer = new GraphViewer(el);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  initGraphViewers(document);

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

  if (typeof $ !== 'undefined') {
    $(document).on('martor:preview', function (e, $tab) {
      initGraphViewers($tab[0]);
    });
  }
});

}());
