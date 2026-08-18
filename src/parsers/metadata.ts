// Metadata analyzer: joins site-preference IDs across code and importable metadata.
//   - customPreferences.js declares pref/group ids (parsed via the ESTree parser)
//   - metadata meta/*.xml declares attribute-id values (parsed via fast-xml-parser)
// Combined with readsPref edges (parseJs), this surfaces the silent-null class: an id read in code
// but never defined in metadata, or defined but never read.

import { parse, simpleTraverse, TSESTree } from '@typescript-eslint/typescript-estree';
import { XMLParser } from 'fast-xml-parser';
import { Fragment, id, emptyFragment } from '../types.js';
import { relPath } from '../resolve/repo.js';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', allowBooleanAttributes: true });

/** Recursively collect every `attribute-id` attribute value from a parsed XML tree. */
function collectAttributeIds(node: unknown, out: Set<string>): void {
    if (Array.isArray(node)) {
        for (const item of node) collectAttributeIds(item, out);
        return;
    }
    if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        for (const key of Object.keys(obj)) {
            if (key === '@_attribute-id') {
                out.add(String(obj[key]));
            } else if (!key.startsWith('@_')) {
                collectAttributeIds(obj[key], out);
            }
        }
    }
}

/** Analyze customPreferences.js: every object property `id: '<string>'` is a defined pref. */
export function parseCustomPrefs(abs: string, source: string): Fragment {
    const frag = emptyFragment();
    const rel = relPath(abs);
    const moduleId = id.module(rel);
    frag.nodes.push({ id: moduleId, kind: 'module', label: rel, attrs: { role: 'customPreferences' } });

    let ast: TSESTree.Program;
    try {
        ast = parse(source, { loc: false, range: false, jsx: false });
    } catch {
        return frag;
    }
    const seen = new Set<string>();
    // A real preference object has both an `id: '<string>'` and a `type:` property. Group containers
    // have an `id` + `Preferences: {...}` but no `type`, so keying on `type` presence excludes them
    // (a group id is a metadata <group-id>, not an <attribute-id>, so flagging it is a false positive).
    simpleTraverse(ast, {
        enter(node: TSESTree.Node): void {
            const n = node as any;
            if (n.type !== 'ObjectExpression') return;
            let prefId: string | null = null;
            let hasType = false;
            for (const p of n.properties) {
                if (p.type !== 'Property' || p.computed) continue;
                let key: string | null = null;
                if (p.key.type === 'Identifier') {
                    key = p.key.name;
                } else if (p.key.type === 'Literal') {
                    key = String(p.key.value);
                }
                if (key === 'id' && p.value.type === 'Literal' && typeof p.value.value === 'string') prefId = p.value.value;
                if (key === 'type') hasType = true;
            }

            if (!prefId || !hasType || seen.has(prefId)) return;
            seen.add(prefId);
            frag.nodes.push({ id: id.pref(prefId), kind: 'pref', label: prefId, attrs: {} });
            frag.edges.push({ source: moduleId, target: id.pref(prefId), kind: 'definesPref', attrs: { via: 'customPreferences' } });
        }
    });
    return frag;
}

/** Analyze a metadata XML file: every attribute-id becomes a defined pref (via metadata). */
export function parseMetaXml(abs: string, source: string): Fragment {
    const frag = emptyFragment();
    const rel = relPath(abs);
    const fileId = id.module(rel);
    frag.nodes.push({ id: fileId, kind: 'module', label: rel, attrs: { role: 'metadata' } });

    let doc: unknown;
    try {
        doc = xml.parse(source);
    } catch {
        return frag;
    }
    const ids = new Set<string>();
    collectAttributeIds(doc, ids);
    for (const prefId of ids) {
        frag.nodes.push({ id: id.pref(prefId), kind: 'pref', label: prefId, attrs: {} });
        frag.edges.push({ source: fileId, target: id.pref(prefId), kind: 'definesPref', attrs: { via: 'metadata' } });
    }
    return frag;
}
