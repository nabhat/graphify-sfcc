// Orchestrates discovery + parsing into a graph, caches it, and exposes every query the tools need.

import fs from 'node:fs';
import path from 'pathe';
import { discoverCartridges, glob, readSource, relPath, resolveInRoot, getRoot, cacheDir } from '../resolve/repo.js';
import { CartridgeResolver } from '../resolve/cartridgePath.js';
import { Fragment, emptyFragment, mergeFragment, id } from '../types.js';
import { parseJsFile } from '../parsers/js.js';
import { parseIsmlFile } from '../parsers/isml.js';
import { parseHooksFile } from '../parsers/hooks.js';
import { parseCustomPrefs, parseMetaXml } from '../parsers/metadata.js';
import { parseFormFile } from '../parsers/forms.js';
import { SfccGraph, buildGraph, exportGraph, importGraph } from './graph.js';
import { bidirectional } from 'graphology-shortest-path';

/** The cache file for the current target repo (computed lazily — `cacheDir()` reads getRoot()). */
function cacheFile(): string {
    return path.join(cacheDir(), 'graph.json');
}

/**
 * Phase-2 hook-dispatch linking (post-build, needs the whole hooks.json graph). Each module carries
 * `hookDispatches` facts from the JS parser (HookMgr.callHook / SFRA hooksHelper call sites). Resolve
 * each hook name (literal, or dynamic prefix matched against every registered hook) to its script via
 * the `callsHook` edges, then to `script#fn` — and add a `callsSymbol` edge (via 'hook-dispatch',
 * confidence INFERRED) only when the script actually DEFINES that function.
 */
function resolveHookDispatches(graph: SfccGraph): void {
    const edges: { from: string; to: string; fn: string; line: number; hook: string }[] = [];
    graph.forEachNode((moduleId, a) => {
        if (a.kind !== 'module' || !Array.isArray(a.hookDispatches)) return;
        for (const d of a.hookDispatches as { hookName: string | null; prefix: string | null; fn: string; line: number }[]) {
            const hookIds: string[] = [];
            if (d.hookName) {
                const hid = id.hook(d.hookName);
                if (graph.hasNode(hid)) hookIds.push(hid);
            } else if (d.prefix) {
                graph.forEachNode((hnid, ha) => {
                    if (ha.kind === 'hook' && String(ha.label).startsWith(d.prefix as string)) hookIds.push(hnid);
                });
            }
            for (const hid of hookIds) {
                graph.forEachOutEdge(hid, (_e, ea, _s, target) => {
                    if (ea.kind !== 'callsHook' || graph.getNodeAttribute(target, 'kind') !== 'module') return;
                    const scriptRel = String(graph.getNodeAttribute(target, 'label'));
                    const symId = id.symbol(scriptRel, d.fn);
                    if (graph.hasNode(symId)) {
                        edges.push({ from: moduleId, to: symId, fn: d.fn, line: d.line, hook: String(graph.getNodeAttribute(hid, 'label')) });
                    }
                });
            }
        }
    });
    for (const e of edges) {
        const key = 'callsSymbol|hd|' + e.from + '->' + e.to + '|' + e.line + '|' + e.hook;
        if (graph.hasEdge(key)) continue;
        graph.addDirectedEdgeWithKey(key, e.from, e.to, {
            kind: 'callsSymbol',
            confidence: 'INFERRED',
            name: e.fn,
            line: e.line,
            via: 'hook-dispatch',
            hook: e.hook
        });
    }
}

function parseFiles(r: CartridgeResolver): { frag: Fragment; count: number } {

    const frag: Fragment = emptyFragment();
    let count = 0;

    for (const abs of glob(['**/cartridge/**/*.js'])) {
        count++;
        const src = readSource(abs);
        if (relPath(abs).endsWith('/configuration/preferences/customPreferences.js')) {
            mergeFragment(frag, parseCustomPrefs(abs, src));
        } else {
            mergeFragment(frag, parseJsFile(abs, src, r));
        }
    }
    for (const abs of glob(['**/cartridge/**/*.isml'])) {
        count++;
        mergeFragment(frag, parseIsmlFile(abs, readSource(abs), r));
    }
    for (const abs of glob(['**/hooks.json'])) {
        count++;
        mergeFragment(frag, parseHooksFile(abs, readSource(abs), r));
    }
    for (const abs of glob(['**/meta/*.xml'])) {
        count++;
        mergeFragment(frag, parseMetaXml(abs, readSource(abs)));
    }
    for (const abs of glob(['**/cartridge/forms/**/*.xml'])) {
        count++;
        mergeFragment(frag, parseFormFile(abs, readSource(abs)));
    }

    return { frag, count };
}

export class Index {

    resolver: CartridgeResolver;
    graph: SfccGraph;
    builtAt = 0;
    fileCount = 0;

    private constructor(resolver: CartridgeResolver, graph: SfccGraph) {
        this.resolver = resolver;
        this.graph = graph;
    }

    /** Load from cache if present (unless force), else build fresh. */
    static load(force = false): Index {
        const resolver = new CartridgeResolver(discoverCartridges());
        const CACHE_FILE = cacheFile();
        if (!force && fs.existsSync(CACHE_FILE)) {
            try {
                const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
                const idx = new Index(resolver, importGraph(raw.graph));
                idx.builtAt = raw.builtAt || 0;
                idx.fileCount = raw.fileCount || 0;
                return idx;
            } catch {
                /* corrupt cache — rebuild */
            }
        }
        return Index.build(resolver);
    }

    /** Parse everything and (re)build the graph, writing the cache. */
    static build(resolver?: CartridgeResolver): Index {
        const r = resolver || new CartridgeResolver(discoverCartridges());
        const { frag, count } = parseFiles(r);

        // superModule + overlay edges from the resolver (structural, not from source).
        for (const n of frag.nodes) {
            if (n.kind === 'module' && (n.attrs.usesSuperModule || n.attrs.isController)) {
                const abs = path.resolve(getRoot(), n.label);
                const sm = r.superModuleOf(abs);
                if (sm) {
                    frag.edges.push({ source: n.id, target: id.module(relPath(sm)), kind: 'superModule', attrs: {} });
                }
            }
        }

        const graph = buildGraph(frag);
        resolveHookDispatches(graph);
        const idx = new Index(r, graph);
        idx.builtAt = Date.now();
        idx.fileCount = count;
        try {
            const CACHE_FILE = cacheFile();
            fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
            fs.writeFileSync(CACHE_FILE, JSON.stringify({ graph: exportGraph(graph), builtAt: idx.builtAt, fileCount: count }));
        } catch {
            /* cache write is best-effort */
        }
        return idx;
    }

    // ---- helpers ----

    private label(nodeId: string): string {
        return this.graph.hasNode(nodeId) ? (this.graph.getNodeAttribute(nodeId, 'label') as string) : nodeId;
    }

    private requireNode(nodeId: string, human: string): void {
        if (!this.graph.hasNode(nodeId)) throw new Error(`Not in the graph: ${human}. Run build_index, or check the id.`);
    }

    // ---- queries ----

    stats(): Record<string, unknown> {
        const nodeKinds: Record<string, number> = {};
        const edgeKinds: Record<string, number> = {};
        this.graph.forEachNode((_n, a) => {
            const k = String(a.kind);
            nodeKinds[k] = (nodeKinds[k] || 0) + 1;
        });
        this.graph.forEachDirectedEdge((_e, a) => {
            const k = String(a.kind);
            edgeKinds[k] = (edgeKinds[k] || 0) + 1;
        });
        return {
            files: this.fileCount,
            nodes: this.graph.order,
            edges: this.graph.size,
            cartridgePath: this.resolver.pathOrder().join(':'),
            cartridgePathSource: this.resolver.pathSource,
            counts: { ...nodeKinds, ...edgeKinds }
        };
    }

    resolveModule(specifier: string, fromFile: string): object {
        const r = this.resolver.resolve(specifier, resolveInRoot(fromFile));
        return {
            specifier,
            fromFile,
            kind: r.kind,
            resolved: r.abs ? relPath(r.abs) : null,
            winnerCartridge: r.winnerCartridge || null,
            shadowedBy: r.shadows.map(relPath)
        };
    }

    whoOverrides(file: string): object {
        const chain = this.resolver.shadowChain(resolveInRoot(file));
        return {
            file,
            onPath: chain.map((c, i) => ({ cartridge: c.cartridge, file: relPath(c.abs), winner: i === 0 })),
            note: chain.length < 2 ? 'No override — this path exists in only one cartridge.' : undefined
        };
    }

    dependenciesOf(file: string): object {
        const nodeId = id.module(file);
        this.requireNode(nodeId, file);
        const deps: object[] = [];
        this.graph.forEachOutEdge(nodeId, (_e, a, _s, target) => {
            if (a.kind === 'requires') deps.push({ target: this.label(target), specifier: a.specifier, winner: a.winner || null });
        });
        return { file, requires: deps };
    }

    callersOf(file: string): object {
        const nodeId = id.module(file);
        this.requireNode(nodeId, file);
        const callers: Record<string, string[]> = {};
        this.graph.forEachInEdge(nodeId, (_e, a, source) => {
            const k = String(a.kind);
            if (!callers[k]) callers[k] = [];
            callers[k].push(this.label(source));
        });
        return { file, callers };
    }

    /** Top-level functions a module defines, each with its def line (jump straight to it, no full read). */
    definesSymbols(file: string): object {
        const nodeId = id.module(file);
        this.requireNode(nodeId, file);
        const symbols: object[] = [];
        this.graph.forEachOutEdge(nodeId, (_e, a, _s, target) => {
            if (a.kind === 'definesSymbol') symbols.push({ name: a.name, line: a.line, id: target });
        });
        symbols.sort((x, y) => ((x as { line: number }).line || 0) - ((y as { line: number }).line || 0));
        return { file, count: symbols.length, symbols };
    }

    /**
     * Call sites of a function, grouped by resolved target symbol. `query` is a bare name (returns
     * every same-named function as a DISTINCT group — cartridge-path disambiguated) or a qualified
     * "relPath#name" / full "symbol:" id (one group). Each site carries file:line + how it was bound.
     */
    symbolUsages(query: string): object {
        let targetIds: string[] = [];
        if (query.startsWith('symbol:')) {
            if (this.graph.hasNode(query)) targetIds = [query];
        } else if (query.includes('#')) {
            const hashIdx = query.indexOf('#');
            const nid = id.symbol(query.slice(0, hashIdx), query.slice(hashIdx + 1));
            if (this.graph.hasNode(nid)) targetIds = [nid];
        } else {
            this.graph.forEachNode((nid, a) => {
                if (a.kind === 'symbol' && a.name === query) targetIds.push(nid);
            });
        }
        if (!targetIds.length) {
            return { query, groupCount: 0, groups: [], note: 'No symbol matches. Try defines_symbols(file) or search_nodes; dw/* platform calls are not tracked.' };
        }
        const groups = targetIds.map((symId) => {
            const attrs = this.graph.getNodeAttributes(symId);
            const moduleRel = String(attrs.module);
            const modId = id.module(moduleRel);
            const cartridge = this.graph.hasNode(modId) ? this.graph.getNodeAttribute(modId, 'cartridge') : null;
            const sites: object[] = [];
            this.graph.forEachInEdge(symId, (_e, a, source) => {
                if (a.kind === 'callsSymbol') sites.push({ file: this.label(source), line: a.line, via: a.via });
            });
            sites.sort((x, y) => {
                const a = x as { file: string; line: number };
                const b = y as { file: string; line: number };
                return a.file === b.file ? (a.line || 0) - (b.line || 0) : a.file.localeCompare(b.file);
            });
            return { symbol: String(attrs.label), module: moduleRel, cartridge: cartridge || null, defLine: attrs.line, usageCount: sites.length, sites };
        });
        return { query, groupCount: groups.length, groups };
    }

    routeInfo(controllerAction: string): object {
        const nodeId = id.route(controllerAction);
        this.requireNode(nodeId, controllerAction);
        const producers: Record<string, string[]> = {};
        this.graph.forEachInEdge(nodeId, (_e, a, source) => {
            const k = String(a.kind);
            if (!producers[k]) producers[k] = [];
            producers[k].push(this.label(source));
        });
        return { route: controllerAction, producers };
    }

    hookHandler(hookName: string): object {
        const nodeId = id.hook(hookName);
        this.requireNode(nodeId, hookName);
        const scripts: object[] = [];
        this.graph.forEachOutEdge(nodeId, (_e, a, _s, target) => {
            if (a.kind === 'callsHook') scripts.push({ script: this.label(target), definedIn: a.definedIn, unresolved: !!a.unresolved });
        });
        return { hook: hookName, scripts };
    }

    templateGraph(template: string): object {
        const nodeId = id.template(template);
        this.requireNode(nodeId, template);
        const out: Record<string, string[]> = {};
        this.graph.forEachOutEdge(nodeId, (_e, a, _s, target) => {
            const k = String(a.kind);
            if (!out[k]) out[k] = [];
            out[k].push(this.label(target));
        });
        const includedBy: string[] = [];
        this.graph.forEachInEdge(nodeId, (_e, a, source) => {
            if (a.kind === 'includesTemplate') includedBy.push(this.label(source));
        });
        return { template, out, includedBy };
    }

    prefUsage(prefId: string): object {
        const nodeId = id.pref(prefId);
        this.requireNode(nodeId, prefId);
        const readers: string[] = [];
        let definedInMeta = false;
        let definedInCustomPrefs = false;
        this.graph.forEachInEdge(nodeId, (_e, a, source) => {
            if (a.kind === 'readsPref') readers.push(this.label(source));
            if (a.kind === 'definesPref') {
                if (a.via === 'metadata') definedInMeta = true;
                if (a.via === 'customPreferences') definedInCustomPrefs = true;
            }
        });
        const readInCode = readers.length > 0;
        return {
            pref: prefId,
            readInCode,
            definedInCustomPrefs,
            definedInMeta,
            readers,
            silentNullRisk: definedInCustomPrefs && !definedInMeta,
            orphan: definedInMeta && !definedInCustomPrefs && !readInCode
        };
    }

    usesGlobalByFile(file: string): object {
        const nodeId = this.graph.hasNode(id.module(file)) ? id.module(file) : id.template(file);
        this.requireNode(nodeId, file);
        const globals: object[] = [];
        this.graph.forEachOutEdge(nodeId, (_e, a, _s, target) => {
            if (a.kind === 'usesGlobal') globals.push({ global: this.label(target), members: a.members || [] });
        });
        return { file, globals };
    }

    globalUsages(globalName: string): object {
        const nodeId = id.global(globalName);
        this.requireNode(nodeId, globalName);
        const files: object[] = [];
        this.graph.forEachInEdge(nodeId, (_e, a, source) => {
            if (a.kind === 'usesGlobal') files.push({ file: this.label(source), members: a.members || [] });
        });
        return { global: globalName, usageCount: files.length, files };
    }

    unresolved(): object {
        const deadLinks: object[] = [];
        const silentNullPrefs: string[] = [];
        const orphanPrefs: string[] = [];
        this.graph.forEachDirectedEdge((_e, a, source, target) => {
            if ((a.kind === 'requires' || a.kind === 'callsHook') && this.graph.getNodeAttribute(target, 'kind') === 'external') {
                const spec = String(a.specifier || a.script || this.label(target));
                if (spec.startsWith('*/cartridge/') || spec.startsWith('app_storefront_base/') || a.unresolved) {
                    deadLinks.push({ from: this.label(source), kind: a.kind, target: spec });
                }
            }
        });
        this.graph.forEachNode((nodeId, a) => {
            if (a.kind !== 'pref') return;
            const u = this.prefUsage(String(a.label)) as { silentNullRisk: boolean; orphan: boolean };
            if (u.silentNullRisk) silentNullPrefs.push(String(a.label));
            if (u.orphan) orphanPrefs.push(String(a.label));
        });
        return { deadLinks, silentNullPrefs, orphanPrefs };
    }

    searchNodes(query: string, kind?: string, limit = 50): object {
        const q = query.toLowerCase();
        const hits: object[] = [];
        this.graph.forEachNode((nodeId, a) => {
            if (hits.length >= limit) return;
            if (kind && a.kind !== kind) return;
            const label = String(a.label);
            if (label.toLowerCase().includes(q) || nodeId.toLowerCase().includes(q)) {
                hits.push({ id: nodeId, kind: a.kind, label });
            }
        });
        return { query, kind: kind || null, count: hits.length, hits };
    }

    /** Resolve a user reference (full node id, exact label, or unambiguous substring) to a node id. */
    private resolveNodeRef(ref: string): string {
        if (this.graph.hasNode(ref)) return ref;
        let exact: string | null = null;
        const partial: string[] = [];
        this.graph.forEachNode((n, a) => {
            if (a.label === ref && !exact) exact = n;
            if (n.includes(ref)) partial.push(n);
        });
        if (exact) return exact;
        if (partial.length === 1) return partial[0];
        if (partial.length === 0) throw new Error(`No node matches "${ref}". Use search_nodes to find its id.`);
        throw new Error(`Ambiguous "${ref}" (${partial.length} matches). Pass a full node id, e.g. ${partial.slice(0, 3).join(', ')}`);
    }

    explain(ref: string): object {
        const nodeId = this.resolveNodeRef(ref);
        const attrs = this.graph.getNodeAttributes(nodeId);
        const outbound: object[] = [];
        const inbound: object[] = [];
        this.graph.forEachOutEdge(nodeId, (_e, a, _s, target) => {
            outbound.push({ kind: a.kind, to: this.label(target), line: a.line, confidence: a.confidence });
        });
        this.graph.forEachInEdge(nodeId, (_e, a, source) => {
            inbound.push({ kind: a.kind, from: this.label(source), line: a.line, confidence: a.confidence });
        });
        return {
            id: nodeId,
            kind: attrs.kind,
            label: attrs.label,
            cartridge: attrs.cartridge,
            outbound,
            inbound
        };
    }

    shortestPath(from: string, to: string): object {
        const s = this.resolveNodeRef(from);
        const t = this.resolveNodeRef(to);
        const p = bidirectional(this.graph, s, t);
        return {
            from: this.label(s),
            to: this.label(t),
            found: !!p,
            hops: p ? p.length - 1 : null,
            path: p ? p.map((n: string) => this.label(n)) : null,
            note: 'Directed path following out-edges (caller -> callee, template -> route, hook -> script, ...).'
        };
    }
}
