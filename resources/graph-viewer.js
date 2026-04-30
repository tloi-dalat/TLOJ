(function () {
'use strict';

const { clamp, dist2D, isDark, NODE_RADIUS, renderEdges, renderNodes, updateVelocities, parseInput, buildLayers } = window.GraphCore;

const FPS = 60;

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
      const data = JSON.parse(atob(this.canvas.dataset.graphB64 || '') || '{}');
      this.directed = !!data.directed;
      this.tree = !!data.tree;
      const text = (data.edges || '').trim();
      if (!text) return;
      const parsed = parseInput(text);
      if (parsed.nodes.length) this.applyGraph(parsed);
    } catch (e) {}
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
    this.layerMap = this.tree ? buildLayers(this.nodes, this.adj) : null;
  }

  render() {
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
    updateVelocities(this);
  }

  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, this.wrap.clientWidth);
    const height = Math.max(1, this.wrap.clientHeight);

    if (this.canvasW === width && this.canvasH === height && this.dpr === dpr) {
      return;
    }

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
