// graphology wrapper: build a directed multigraph from fragments, deduping nodes (by id) and
// edges (by kind+source+target). Attribute merges are shallow.

import { MultiDirectedGraph } from 'graphology';
import { Fragment, GEdge } from '../types.js';

export type SfccGraph = MultiDirectedGraph;

/** Deterministic edge key so repeated (kind, source, target) triples merge instead of duplicating. */
function edgeKey(e: GEdge): string {
    return e.kind + '|' + e.source + '->' + e.target;
}

const ID_KINDS = new Set([
    'cartridge', 'module', 'template', 'route', 'hook', 'pref', 'global', 'external', 'service', 'form', 'job', 'customObject', 'apiClass', 'symbol'
]);

/**
 * Derive {kind,label} for an edge endpoint that has no explicit node. Node ids are `<kind>:<label>`,
 * so a resolved-but-unparsed target (e.g. a required .json/config that no parser emits a node for)
 * is inferred as a real `module`, not mislabeled `external` — which unresolved() would otherwise
 * report as a dead link. Genuinely unresolved targets carry an `external:` id and stay external.
 */
function inferNode(nodeId: string): { kind: string; label: string } {
    const i = nodeId.indexOf(':');
    if (i > 0) {
        const prefix = nodeId.slice(0, i);
        if (ID_KINDS.has(prefix)) return { kind: prefix, label: nodeId.slice(i + 1) };
    }
    return { kind: 'external', label: nodeId };
}

/** Build a directed multigraph from one merged fragment. */
export function buildGraph(fragment: Fragment): SfccGraph {
    const g = new MultiDirectedGraph({ allowSelfLoops: true });
    for (const n of fragment.nodes) {
        if (g.hasNode(n.id)) {
            g.mergeNodeAttributes(n.id, { kind: n.kind, label: n.label, ...n.attrs });
        } else {
            g.addNode(n.id, { kind: n.kind, label: n.label, ...n.attrs });
        }
    }
    for (const e of fragment.edges) {
        // Nodes referenced by an edge must exist (parsers usually add them, but be defensive).
        // Infer kind + clean label from the id prefix so a resolved-but-unparsed target isn't
        // mislabeled 'external' (see inferNode).
        if (!g.hasNode(e.source)) g.addNode(e.source, inferNode(e.source));
        if (!g.hasNode(e.target)) g.addNode(e.target, inferNode(e.target));
        // Structural edges we derive from the cartridge layout are INFERRED; everything parsed
        // directly from source/config is EXTRACTED (graphify-style confidence tagging).
        const confidence = e.kind === 'superModule' || e.kind === 'overlays' ? 'INFERRED' : 'EXTRACTED';
        const key = edgeKey(e);
        if (g.hasEdge(key)) {
            g.mergeEdgeAttributes(key, { kind: e.kind, confidence, ...e.attrs });
        } else {
            g.addDirectedEdgeWithKey(key, e.source, e.target, { kind: e.kind, confidence, ...e.attrs });
        }
    }
    return g;
}

/** Serialize to a plain object for on-disk caching. */
export function exportGraph(g: SfccGraph): object {
    return g.export();
}

/** Rehydrate a graph from exportGraph() output. */
export function importGraph(data: object): SfccGraph {
    const g = new MultiDirectedGraph({ allowSelfLoops: true });
    g.import(data as never);
    return g;
}
