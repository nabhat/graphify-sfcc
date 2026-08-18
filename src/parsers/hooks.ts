// hooks.json analyzer: maps each hook name to the script that implements it.
// hooks.json lives at a cartridge PACKAGE root; script paths are relative to that file
// (e.g. "./cartridge/scripts/..." or "../app_storefront_base/cartridge/...").

import path from 'pathe';
import { Fragment, id, emptyFragment } from '../types.js';
import { relPath, exists } from '../resolve/repo.js';
import { CartridgeResolver } from '../resolve/cartridgePath.js';

interface HookEntry {
    name?: string;
    script?: string;
}

/** Try a base path with .js / .json / /index.js fallbacks. */
function tryFile(base: string): string | null {
    for (const c of [base, base + '.js', base + '.json', base.replace(/\/$/, '') + '/index.js']) {
        if (exists(c)) return c;
    }
    return null;
}

/**
 * Resolve a hooks.json script path to a file, or null.
 * hooks.json script paths are relative to the hooks.json location, so a filesystem walk works in a
 * flattened deployment. In a split-root dev workspace (base cartridge under a different root) a
 * `../<cartridge>/cartridge/...` walk misses, so we also resolve `<cartridge>/cartridge/...` by
 * cartridge NAME through the resolver.
 */
function resolveScript(baseDir: string, script: string, resolver: CartridgeResolver): string | null {
    // 1) Filesystem-relative (correct for flattened deployments and same-cartridge `./...`).
    const raw = path.resolve(baseDir, script);
    const fsHit = tryFile(raw);
    if (fsHit) return fsHit;

    // 2) Cartridge-name form: strip any leading ./ or ../ then match `<cartridge>/cartridge/<rest>`.
    const m = /^(?:\.\.?\/)*([\w-]+)\/cartridge\/(.+)$/.exec(script.replaceAll('\\', '/'));
    if (m) {
        const dir = resolver.cartridgeDirOf(m[1]);
        if (dir) {
            const nameHit = tryFile(dir + '/' + m[2]);
            if (nameHit) return nameHit;
        }
    }
    return null;
}

/** Analyze a hooks.json file. Emits a hook node + callsHook edge per entry. */
export function parseHooksFile(abs: string, source: string, resolver: CartridgeResolver): Fragment {
    const frag = emptyFragment();
    let data: { hooks?: HookEntry[] };
    try {
        data = JSON.parse(source);
    } catch {
        return frag;
    }
    const baseDir = path.dirname(abs);
    const entries = Array.isArray(data.hooks) ? data.hooks : [];
    for (const entry of entries) {
        if (!entry?.name || !entry?.script) continue;

        const hookId = id.hook(entry.name);
        frag.nodes.push({ id: hookId, kind: 'hook', label: entry.name, attrs: {} });
        const resolved = resolveScript(baseDir, entry.script, resolver);
        if (resolved) {
            frag.edges.push({
                source: hookId,
                target: id.module(relPath(resolved)),
                kind: 'callsHook',
                attrs: { script: entry.script, definedIn: relPath(abs) }
            });
        } else {
            const extId = id.external(entry.script);
            frag.nodes.push({ id: extId, kind: 'external', label: entry.script, attrs: {} });
            frag.edges.push({
                source: hookId,
                target: extId,
                kind: 'callsHook',
                attrs: { script: entry.script, definedIn: relPath(abs), unresolved: true }
            });
        }
    }
    return frag;
}
