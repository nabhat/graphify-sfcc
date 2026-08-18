// Generates a standalone HTML visualisation of the sfcc-graph using vis-network (CDN).
// Heavy lifting (physics, rendering, interaction) runs efficiently in the browser.

import fs from 'node:fs';
import path from 'pathe';
import { exec } from 'node:child_process';
import { importGraph } from './graph/graph.js';
import { getRoot, cacheDir } from './resolve/repo.js';

const CACHE_DIR = cacheDir();
const CACHE_FILE = path.join(CACHE_DIR, 'graph.json');

// ---- visual constants -------------------------------------------------------

const KIND_COLOR: Record<string, { bg: string; border: string }> = {
    module:       { bg: '#3A7BD5', border: '#2962C9' },
    template:     { bg: '#27AE60', border: '#1E8449' },
    route:        { bg: '#E67E22', border: '#CA6F1E' },
    hook:         { bg: '#8E44AD', border: '#76359B' },
    pref:         { bg: '#D4AC0D', border: '#B7950B' },
    external:     { bg: '#707B7C', border: '#5D6D7E' },
    global:       { bg: '#E74C3C', border: '#CB4335' },
    form:         { bg: '#1ABC9C', border: '#17A589' },
    apiClass:     { bg: '#E91E63', border: '#C2185B' },
    job:          { bg: '#795548', border: '#6D4C41' },
    service:      { bg: '#00BCD4', border: '#0097A7' },
    customObject: { bg: '#FF5722', border: '#E64A19' },
};

const EDGE_COLOR: Record<string, string> = {
    superModule:      'rgba(52,152,219,0.85)',
    extendsRoute:     'rgba(52,152,219,0.7)',
    rendersTemplate:  'rgba(39,174,96,0.8)',
    includesTemplate: 'rgba(39,174,96,0.5)',
    remoteIncludes:   'rgba(230,126,34,0.8)',
    linksToRoute:     'rgba(230,126,34,0.55)',
    callsHook:        'rgba(142,68,173,0.8)',
    prependRoute:     'rgba(93,173,226,0.8)',
    appendRoute:      'rgba(93,173,226,0.65)',
    replaceRoute:     'rgba(231,76,60,0.9)',
    addRoute:         'rgba(241,148,51,0.7)',
    readsPref:        'rgba(212,172,13,0.75)',
    definesPref:      'rgba(212,172,13,0.45)',
    usesGlobal:       'rgba(231,76,60,0.6)',
    usesForm:         'rgba(26,188,156,0.7)',
    callsApi:         'rgba(233,30,99,0.7)',
    requires:         'rgba(120,120,140,0.18)',
};

// Requires and definesPref edges hidden by default to prevent visual clutter
const HIDDEN_BY_DEFAULT = new Set(['requires', 'definesPref']);

// Kinds and edge kinds to strip in pruned mode.
const PRUNE_NODE_KINDS  = new Set(['external']);
const PRUNE_EDGE_KINDS  = new Set(['requires', 'definesPref']);

/** Remove external nodes, noise edges, and any nodes that become isolated afterwards. */
function prune(
    nodes: object[],
    edges: object[]
): { nodes: object[]; edges: object[] } {
    const keepIds = new Set((nodes as any[]).filter(n => !PRUNE_NODE_KINDS.has(n.kind)).map(n => n.id));
    const keptEdges = (edges as any[]).filter(e =>
        !PRUNE_EDGE_KINDS.has(e.kind) && keepIds.has(e.from) && keepIds.has(e.to)
    );
    const connected = new Set<string>();
    keptEdges.forEach(e => { connected.add(e.from); connected.add(e.to); });
    const keptNodes = (nodes as any[]).filter(n => keepIds.has(n.id) && connected.has(n.id));
    return { nodes: keptNodes, edges: keptEdges };
}

export interface VisualizeOptions {
    output?: string;
    open?: boolean;
    pruned?: boolean;
}

export function visualize(opts: VisualizeOptions = {}): string {
    if (!fs.existsSync(CACHE_FILE)) {
        throw new Error('No cached graph found. Run `graphify-sfcc build` first.');
    }

    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const graph = importGraph(raw.graph);

    // compute degree for node sizing
    const degree = new Map<string, number>();
    graph.forEachNode((n) => degree.set(n, 0));
    graph.forEachDirectedEdge((_e, _a, s, t) => {
        degree.set(s, (degree.get(s) || 0) + 1);
        degree.set(t, (degree.get(t) || 0) + 1);
    });

    const allKinds = new Set<string>();
    const allCartridges = new Set<string>();

    // build vis-network nodes
    const visNodes: object[] = [];
    graph.forEachNode((n, a) => {
        const kind = String(a.kind || 'external');
        const cartridge = String(a.cartridge || '');
        const deg = degree.get(n) || 0;
        const size = Math.max(4, Math.min(22, 4 + deg * 0.35));
        const col = KIND_COLOR[kind] || KIND_COLOR.external;
        const shortLabel = String(a.label || n).split('/').pop() || n;
        const fullLabel = String(a.label || n);
        allKinds.add(kind);
        if (cartridge) allCartridges.add(cartridge);

        // Hide labels by default on minor nodes to prevent text overlap clutter
        const showLabelByDefault = deg >= 8 || kind === 'route';

        visNodes.push({
            id: n,
            label: showLabelByDefault ? shortLabel : '',
            rawLabel: shortLabel,
            title: fullLabel,
            color: { background: col.bg, border: col.border, highlight: { background: '#FFF176', border: col.border } },
            size,
            font: {
                color: '#f0f6fc',
                size: 11,
                strokeWidth: 3,
                strokeColor: '#0d1117'
            },
            kind,
            cartridge,
            fullLabel,
            origin: String(a.origin || ''),
            deg,
            showLabelByDefault
        });
    });

    // build vis-network edges
    const visEdges: object[] = [];
    graph.forEachDirectedEdge((e, a, s, t) => {
        const kind = String(a.kind || '');
        const hidden = HIDDEN_BY_DEFAULT.has(kind);
        const col = EDGE_COLOR[kind] || 'rgba(180,180,200,0.2)';
        const isBold = ['superModule', 'extendsRoute', 'rendersTemplate', 'callsHook', 'remoteIncludes', 'replaceRoute'].includes(kind);
        visEdges.push({
            id: e,
            from: s,
            to: t,
            color: { color: col, opacity: hidden ? 0 : 1 },
            width: isBold ? 2 : 1,
            hidden,
            kind,
            title: kind + (a.line ? ` :${a.line}` : '') + ` [${a.confidence || 'EXTRACTED'}]`,
            arrows: { to: { enabled: true, scaleFactor: 0.35 } }
        });
    });

    const kindList = [...allKinds].sort((a, b) => a.localeCompare(b));
    const cartridgeList = [...allCartridges].sort((a, b) => a.localeCompare(b));

    const finalNodes = opts.pruned ? prune(visNodes, visEdges).nodes : visNodes;
    const finalEdges = opts.pruned ? prune(visNodes, visEdges).edges : visEdges;

    if (opts.pruned) {
        (finalEdges as any[]).forEach(e => { e.hidden = false; e.color = { ...e.color, opacity: 1 }; });
    }

    const defaultName = opts.pruned ? 'sfcc-graph-viz-pruned.html' : 'sfcc-graph-viz.html';
    const outPath = opts.output ? path.resolve(opts.output) : path.join(getRoot(), defaultName);

    fs.writeFileSync(outPath, buildHtml({
        visNodes: finalNodes,
        visEdges: finalEdges,
        kindList: opts.pruned
            ? [...new Set((finalNodes as any[]).map(n => n.kind))].sort((a, b) => a.localeCompare(b))
            : kindList,
        cartridgeList,
        nodeCount: finalNodes.length,
        edgeCount: finalEdges.length,
        totalNodeCount: graph.order,
        totalEdgeCount: graph.size,
        builtAt: raw.builtAt ? new Date(raw.builtAt).toLocaleString() : 'unknown',
        root: getRoot(),
        pruned: !!opts.pruned,
    }));

    if (opts.open) {
        let cmd = 'xdg-open';
        if (process.platform === 'win32') {
            cmd = 'start ""';
        } else if (process.platform === 'darwin') {
            cmd = 'open';
        }
        exec(`${cmd} "${outPath}"`);
    }

    return outPath;
}

// ---- HTML builder -----------------------------------------------------------

interface HtmlOptions {
    visNodes: object[];
    visEdges: object[];
    kindList: string[];
    cartridgeList: string[];
    nodeCount: number;
    edgeCount: number;
    totalNodeCount?: number;
    totalEdgeCount?: number;
    builtAt: string;
    root: string;
    pruned?: boolean;
}

function buildHtml(o: HtmlOptions): string {
    const kindCheckboxes = o.kindList.map(k => {
        const col = (KIND_COLOR[k] || KIND_COLOR.external).bg;
        return `<label class="filter-row"><input type="checkbox" class="kind-cb" data-kind="${k}" checked>
          <span class="dot" style="background:${col}"></span>${k}</label>`;
    }).join('\n');

    const cartCheckboxes = o.cartridgeList.map(c =>
        `<label class="filter-row"><input type="checkbox" class="cart-cb" data-cart="${c}" checked>
          <span style="font-family:monospace;font-size:11px">${c}</span></label>`
    ).join('\n');

    const legend = Object.entries(KIND_COLOR).map(([k, c]) =>
        `<span class="legend-item"><span class="dot" style="background:${c.bg}"></span>${k}</span>`
    ).join('');

    const edgeKinds = Object.keys(EDGE_COLOR).map(k => {
        const hidden = HIDDEN_BY_DEFAULT.has(k);
        return `<label class="filter-row"><input type="checkbox" class="edge-cb" data-kind="${k}" ${hidden ? '' : 'checked'}>
          <span style="display:inline-block;width:22px;height:3px;background:${EDGE_COLOR[k]};vertical-align:middle;margin-right:4px"></span>${k}</label>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>graphify-sfcc${o.pruned ? ' (pruned)' : ''} — ${o.root.split(/[\\/]/).pop()}</title>
<script src="https://cdn.jsdelivr.net/npm/vis-network@9.1.9/dist/vis-network.min.js"></script>
<link href="https://cdn.jsdelivr.net/npm/vis-network@9.1.9/dist/dist/vis-network.min.css" rel="stylesheet"/>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { display: flex; height: 100vh; background: #0d1117; color: #c9d1d9; font: 12px/1.5 -apple-system, system-ui, sans-serif; overflow: hidden; }
  #sidebar { width: 270px; min-width: 270px; background: #161b22; border-right: 1px solid #30363d; display: flex; flex-direction: column; overflow: hidden; }
  #sidebar-header { padding: 12px 14px 8px; border-bottom: 1px solid #30363d; flex-shrink: 0; }
  #sidebar-header h1 { font-size: 15px; font-weight: 700; color: #58a6ff; margin-bottom: 2px; }
  #sidebar-header .meta { font-size: 11px; color: #8b949e; }
  #tabs { display: flex; border-bottom: 1px solid #30363d; flex-shrink: 0; }
  .tab { flex: 1; padding: 7px 4px; text-align: center; cursor: pointer; font-size: 11px; color: #8b949e; border-bottom: 2px solid transparent; user-select: none; }
  .tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
  #tab-content { flex: 1; overflow-y: auto; padding: 10px 12px; }
  #search { width: 100%; padding: 6px 9px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 12px; margin-bottom: 8px; outline: none; }
  #search:focus { border-color: #58a6ff; }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #8b949e; margin: 10px 0 6px; }
  .filter-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; cursor: pointer; font-size: 11.5px; }
  .filter-row input { cursor: pointer; accent-color: #58a6ff; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  #detail { background: #0d1117; border-top: 1px solid #30363d; padding: 10px 12px; font-size: 11.5px; min-height: 90px; flex-shrink: 0; }
  #detail h4 { color: #58a6ff; margin-bottom: 6px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #detail .row { display: flex; gap: 6px; margin-bottom: 2px; }
  #detail .key { color: #8b949e; flex-shrink: 0; width: 68px; }
  #detail .val { color: #c9d1d9; word-break: break-all; }
  #main { flex: 1; position: relative; }
  #graph { width: 100%; height: 100%; }
  #toolbar { position: absolute; top: 12px; right: 14px; display: flex; gap: 6px; z-index: 10; flex-wrap: wrap; }
  .btn { padding: 5px 11px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 11px; cursor: pointer; user-select: none; transition: background 0.15s; }
  .btn:hover { background: #30363d; color: #58a6ff; }
  .btn.active { background: #1f6feb; color: #ffffff; border-color: #388bfd; }
  #loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(13,17,23,0.85); z-index: 20; gap: 12px; font-size: 13px; color: #8b949e; }
  .spinner { width: 32px; height: 32px; border: 3px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .legend-wrap { display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; }
  ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: #161b22; } ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
  #found-count { font-size: 11px; color: #8b949e; margin-bottom: 8px; min-height: 16px; }
</style>
</head>
<body>

<div id="sidebar">
  <div id="sidebar-header">
    <h1>graphify-sfcc${o.pruned ? ' <span style="font-size:10px;background:#238636;color:#fff;padding:1px 6px;border-radius:10px;vertical-align:middle;font-weight:600">PRUNED</span>' : ''}</h1>
    <div class="meta">${o.nodeCount} nodes · ${o.edgeCount} edges · ${o.builtAt}</div>
    ${o.pruned ? `<div class="meta" style="margin-top:3px;color:#8b949e">Externals, requires &amp; definesPref removed</div>` : ''}
  </div>
  <div id="tabs">
    <div class="tab active" data-tab="filters" onclick="switchTab('filters',this)">Filters</div>
    <div class="tab" data-tab="edges" onclick="switchTab('edges',this)">Edges</div>
    <div class="tab" data-tab="legend" onclick="switchTab('legend',this)">Legend</div>
  </div>
  <div id="tab-content">
    <div id="tab-filters">
      <input id="search" type="text" placeholder="Search nodes (e.g. Home, Checkout)…" oninput="onSearch(this.value)">
      <div id="found-count"></div>
      <div class="section-title">Node Kind</div>
      ${kindCheckboxes}
      <div class="section-title">Cartridge</div>
      ${cartCheckboxes}
    </div>
    <div id="tab-edges" style="display:none">
      <div class="section-title">Edge Kind (toggle visibility)</div>
      ${edgeKinds}
    </div>
    <div id="tab-legend" style="display:none">
      <div class="section-title">Node types</div>
      <div class="legend-wrap">${legend}</div>
    </div>
  </div>
  <div id="detail">
    <div style="color:#8b949e;font-size:11px">Click or hover a node to inspect its links.</div>
  </div>
</div>

<div id="main">
  <div id="loading">
    <div class="spinner"></div>
    <span>Optimizing graph layout…</span>
  </div>
  <div id="graph"></div>
  <div id="toolbar">
    <div id="btn-labels" class="btn active" onclick="toggleLabelMode()">Labels: Smart</div>
    <div class="btn" onclick="resetFocus()">Reset Focus</div>
    <div class="btn" onclick="network.fit({animation:{duration:400}})">Fit View</div>
    <div id="btn-physics" class="btn active" onclick="togglePhysics()">Physics: On</div>
  </div>
</div>

<script>
const ALL_NODES = ${JSON.stringify(o.visNodes)};
const ALL_EDGES = ${JSON.stringify(o.visEdges)};

let nodesDs, edgesDs, network;
let physicsOn = true;
let labelMode = 'smart'; // 'smart' | 'all' | 'none'
let highlightedNodeId = null;

// ---- init ------------------------------------------------------------------
window.addEventListener('load', function() {
  nodesDs = new vis.DataSet(ALL_NODES);
  edgesDs = new vis.DataSet(ALL_EDGES);

  const isLargeGraph = ALL_NODES.length > 350;
  const isHugeGraph = ALL_NODES.length > 1000;

  const container = document.getElementById('graph');
  network = new vis.Network(container, { nodes: nodesDs, edges: edgesDs }, {
    physics: {
      enabled: true,
      solver: isLargeGraph ? 'forceAtlas2Based' : 'barnesHut',
      forceAtlas2Based: {
        gravitationalConstant: -35,
        centralGravity: 0.015,
        springLength: 80,
        springConstant: 0.08,
        damping: 0.4
      },
      barnesHut: {
        gravitationalConstant: -2200,
        springConstant: 0.04,
        springLength: 90,
        damping: 0.2
      },
      stabilization: {
        enabled: true,
        iterations: isHugeGraph ? 60 : (isLargeGraph ? 100 : 180),
        updateInterval: 15
      }
    },
    edges: {
      // Use straight lines for large graphs for 10x canvas rendering speedup
      smooth: isLargeGraph ? false : { enabled: true, type: 'continuous', roundness: 0.2 },
      arrows: { to: { enabled: true, scaleFactor: 0.35 } },
      selectionWidth: 3
    },
    nodes: {
      shape: 'dot',
      borderWidth: 1.5,
      shadow: { enabled: false },
      font: { color: '#f0f6fc', size: 11, strokeWidth: 3, strokeColor: '#0d1117' }
    },
    interaction: {
      hover: true,
      tooltipDelay: 100,
      hideEdgesOnDrag: true,
      hideEdgesOnZoom: isLargeGraph,
      navigationButtons: false,
      keyboard: { enabled: true }
    },
    layout: { improvedLayout: false }
  });

  network.on('stabilizationProgress', function(p) {
    const pct = Math.round(p.iterations / p.total * 100);
    document.querySelector('#loading span').textContent = 'Stabilizing layout… ' + pct + '%';
  });

  network.on('stabilizationIterationsDone', function() {
    document.getElementById('loading').style.display = 'none';
    network.setOptions({ physics: { enabled: false } });
    physicsOn = false;
    document.getElementById('btn-physics').classList.remove('active');
    document.getElementById('btn-physics').textContent = 'Physics: Off';
  });

  network.on('click', onNodeClick);
  network.on('hoverNode', function(e) {
    container.style.cursor = 'pointer';
    highlightNeighborhood(e.node);
  });
  network.on('blurNode', function() {
    container.style.cursor = 'default';
    if (!highlightedNodeId) {
      resetNeighborhood();
    }
  });
});

// ---- neighborhood highlighting & label management -------------------------
function highlightNeighborhood(nodeId) {
  const connectedNodes = new Set(network.getConnectedNodes(nodeId));
  connectedNodes.add(nodeId);

  const connectedEdges = new Set(network.getConnectedEdges(nodeId));

  nodesDs.forEach(n => {
    const isConnected = connectedNodes.has(n.id);
    let targetLabel = '';

    if (labelMode === 'all') {
      targetLabel = n.rawLabel;
    } else if (labelMode === 'none') {
      targetLabel = '';
    } else { // 'smart' mode
      targetLabel = isConnected ? n.rawLabel : (n.showLabelByDefault ? n.rawLabel : '');
    }

    nodesDs.update({
      id: n.id,
      label: targetLabel,
      opacity: isConnected ? 1 : 0.12
    });
  });

  edgesDs.forEach(e => {
    if (e.hidden) return;
    const isConnected = connectedEdges.has(e.id);
    edgesDs.update({
      id: e.id,
      color: {
        color: e.color && e.color.color ? e.color.color : e.color,
        opacity: isConnected ? 1 : 0.05
      }
    });
  });

  updateDetailPanel(nodeId);
}

function resetNeighborhood() {
  highlightedNodeId = null;
  nodesDs.forEach(n => {
    let targetLabel = '';
    if (labelMode === 'all') targetLabel = n.rawLabel;
    else if (labelMode === 'none') targetLabel = '';
    else targetLabel = n.showLabelByDefault ? n.rawLabel : '';

    nodesDs.update({ id: n.id, label: targetLabel, opacity: 1 });
  });

  edgesDs.forEach(e => {
    if (e.hidden) return;
    edgesDs.update({
      id: e.id,
      color: { color: e.color && e.color.color ? e.color.color : e.color, opacity: 1 }
    });
  });
}

function resetFocus() {
  resetNeighborhood();
  network.fit({ animation: { duration: 400 } });
  document.getElementById('detail').innerHTML = '<div style="color:#8b949e;font-size:11px">Click or hover a node to inspect its links.</div>';
}

// ---- node click & detail ---------------------------------------------------
function onNodeClick(params) {
  if (!params.nodes.length) {
    resetFocus();
    return;
  }
  highlightedNodeId = params.nodes[0];
  highlightNeighborhood(highlightedNodeId);
  network.focus(highlightedNodeId, { scale: 1.2, animation: { duration: 350 } });
}

function updateDetailPanel(id) {
  const n = nodesDs.get(id);
  if (!n) return;
  const inEdges = ALL_EDGES.filter(e => e.to === id && !e.hidden);
  const outEdges = ALL_EDGES.filter(e => e.from === id && !e.hidden);
  const d = document.getElementById('detail');
  d.innerHTML = '<h4 title="' + esc(n.fullLabel) + '">' + esc(n.fullLabel.split('/').pop()) + '</h4>'
    + row('kind', n.kind)
    + row('cartridge', n.cartridge || '—')
    + row('degree', n.deg)
    + row('in-edges', inEdges.length + (inEdges.length ? ' (' + [...new Set(inEdges.map(e=>e.kind))].join(', ') + ')' : ''))
    + row('out-edges', outEdges.length + (outEdges.length ? ' (' + [...new Set(outEdges.map(e=>e.kind))].join(', ') + ')' : ''));
}

function row(k, v) {
  return '<div class="row"><span class="key">' + k + '</span><span class="val">' + esc(String(v)) + '</span></div>';
}
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ---- search -----------------------------------------------------------------
function onSearch(q) {
  const lq = q.trim().toLowerCase();
  const fc = document.getElementById('found-count');
  if (!lq) {
    resetNeighborhood();
    fc.textContent = '';
    return;
  }
  let found = 0;
  let firstMatchId = null;

  nodesDs.forEach(n => {
    const match = n.fullLabel.toLowerCase().includes(lq) || n.kind.includes(lq);
    if (match) {
      found++;
      if (!firstMatchId) firstMatchId = n.id;
    }
    nodesDs.update({
      id: n.id,
      label: match ? n.rawLabel : '',
      opacity: match ? 1 : 0.08,
      color: match ? { background:'#FFF176', border:'#F9A825', highlight:{background:'#FFF176',border:'#F9A825'} } : buildColor(n)
    });
  });

  fc.textContent = found ? found + ' match' + (found>1?'es':'') : 'No matches';
  if (firstMatchId && found === 1) {
    network.focus(firstMatchId, { scale: 1.3, animation: { duration: 300 } });
    updateDetailPanel(firstMatchId);
  }
}

function buildColor(n) {
  const colors = ${JSON.stringify(
        Object.fromEntries(Object.entries(KIND_COLOR).map(([k, v]) => [k, v]))
    )};
  const c = colors[n.kind] || colors.external;
  return { background: c.bg, border: c.border, highlight: { background:'#FFF176', border:c.border } };
}

// ---- kind / cartridge filters -----------------------------------------------
document.addEventListener('change', function(e) {
  const t = e.target;
  if (t.classList.contains('kind-cb')) applyNodeFilters();
  if (t.classList.contains('cart-cb')) applyNodeFilters();
  if (t.classList.contains('edge-cb')) applyEdgeFilter(t.dataset.kind, t.checked);
});

function applyNodeFilters() {
  const kinds = new Set([...document.querySelectorAll('.kind-cb:checked')].map(c=>c.dataset.kind));
  const carts = new Set([...document.querySelectorAll('.cart-cb:checked')].map(c=>c.dataset.cart));
  nodesDs.forEach(n => {
    const show = kinds.has(n.kind) && (n.cartridge === '' || carts.has(n.cartridge));
    nodesDs.update({ id: n.id, hidden: !show });
  });
}

function applyEdgeFilter(kind, visible) {
  edgesDs.forEach(e => {
    if (e.kind === kind) {
      edgesDs.update({
        id: e.id,
        hidden: !visible,
        color: { color: e.color && e.color.color ? e.color.color : e.color, opacity: visible ? 1 : 0 }
      });
    }
  });
}

// ---- toolbar actions -------------------------------------------------------
function toggleLabelMode() {
  const btn = document.getElementById('btn-labels');
  if (labelMode === 'smart') {
    labelMode = 'all';
    btn.textContent = 'Labels: All';
  } else if (labelMode === 'all') {
    labelMode = 'none';
    btn.textContent = 'Labels: None';
  } else {
    labelMode = 'smart';
    btn.textContent = 'Labels: Smart';
  }
  resetNeighborhood();
}

function togglePhysics() {
  physicsOn = !physicsOn;
  const btn = document.getElementById('btn-physics');
  if (physicsOn) {
    btn.classList.add('active');
    btn.textContent = 'Physics: On';
  } else {
    btn.classList.remove('active');
    btn.textContent = 'Physics: Off';
  }
  network.setOptions({ physics: { enabled: physicsOn } });
}

// ---- tabs -------------------------------------------------------------------
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['filters','edges','legend'].forEach(id => {
    document.getElementById('tab-' + id).style.display = id === name ? '' : 'none';
  });
}
</script>
</body>
</html>`;
}
