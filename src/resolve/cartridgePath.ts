// The Demandware-specific resolution engine.
//
// SFCC resolves modules and templates along a cartridge path, left-to-right, leftmost wins.
// This models require('*/cartridge/...'), require('app_storefront_base/cartridge/...'),
// require('base/...'), relative requires, ISML <isinclude template=...>, and module.superModule.

import path from 'pathe';
import { Cartridge, exists, dwJsonCartridgePath } from './repo.js';

// Fallback cartridge order, used ONLY when neither SFCC_GRAPH_CARTRIDGE_PATH nor dw.json's
// `cartridgesPath` is set. Empty ⇒ use every discovered cartridge in discovery order. This is how the
// tool stays project-agnostic: a real project declares its own path (in dw.json or the env var), which
// is what wires the graph to that project — nothing project-specific is baked in here.
const DEFAULT_PATH = '';

export interface Resolution {
    kind: 'module' | 'external';
    abs?: string; // set when kind === 'module'
    specifier: string; // the original specifier (or normalized external target)
    shadows: string[]; // same file in lower-priority cartridges (leftmost-wins losers)
    winnerCartridge?: string;
}

export class CartridgeResolver {
    private readonly byName = new Map<string, Cartridge>();
    private readonly order: Cartridge[] = []; // cartridge-path priority order (leftmost wins)
    readonly pathSource: 'env' | 'dw.json' | 'default';

    constructor(cartridges: Cartridge[]) {
        for (const c of cartridges) {
            // First-seen wins if a name appears twice (e.g. base present in two roots).
            if (!this.byName.has(c.name)) this.byName.set(c.name, c);
        }
        // Priority: explicit env override, then dw.json cartridgesPath (mirrors the BM site path),
        // then the hardcoded default. Names not present in the repo are skipped gracefully.
        const envPath = process.env.SFCC_GRAPH_CARTRIDGE_PATH;
        const dwPath = dwJsonCartridgePath();
        if (envPath) {
            this.pathSource = 'env';
        } else if (dwPath) {
            this.pathSource = 'dw.json';
        } else {
            this.pathSource = 'default';
        }
        const configured = (envPath || dwPath || DEFAULT_PATH)
            .split(':')
            .map((s) => s.trim())
            .filter(Boolean);
        const used = new Set<string>();
        for (const name of configured) {
            const c = this.byName.get(name);
            if (c) {
                this.order.push(c);
                used.add(name);
            }
        }
        // Any discovered cartridge not named in the configured path goes last (lowest priority).
        for (const c of cartridges) {
            if (!used.has(c.name)) {
                this.order.push(c);
                used.add(c.name);
            }
        }
    }

    /** The effective cartridge-path priority order (names, leftmost wins). */
    pathOrder(): string[] {
        return this.order.map((c) => c.name);
    }

    private static tryFile(baseNoExt: string): string | null {
        if (exists(baseNoExt)) return baseNoExt;
        if (exists(baseNoExt + '.js')) return baseNoExt + '.js';
        if (exists(baseNoExt + '.json')) return baseNoExt + '.json';
        const idx = baseNoExt.replace(/\/$/, '') + '/index.js';
        if (exists(idx)) return idx;
        return null;
    }

    /** Absolute `cartridge` dir of a cartridge by name, or null if not on the path. */
    cartridgeDirOf(name: string): string | null {
        const c = this.byName.get(name);
        return c ? c.cartridgeDir : null;
    }

    private resolveTildeSpecifier(rest: string, fromAbs: string, specifier: string): Resolution {
        const owner = this.order.find((c) => fromAbs.startsWith(c.cartridgeDir + '/'));
        if (owner) {
            const hit = CartridgeResolver.tryFile(owner.cartridgeDir + '/' + rest);
            if (hit) return { kind: 'module', abs: hit, specifier, shadows: [], winnerCartridge: owner.name };
        }
        return this.searchCartridgePath(rest, 'cartridge', specifier);
    }

    private resolveExplicitBase(rest: string, subPath: string, winnerName: string, specifier: string): Resolution {
        const base = this.byName.get(winnerName);
        if (base) {
            const hit = CartridgeResolver.tryFile(base.cartridgeDir + '/' + subPath);
            if (hit) return { kind: 'module', abs: hit, specifier, shadows: [], winnerCartridge: winnerName };
        }
        return { kind: 'external', specifier, shadows: [] };
    }

    /** Resolve a require() specifier from a given file. */
    resolve(specifier: string, fromAbs: string): Resolution {
        const spec = specifier.replace(/\.js$/, '');

        // Platform + framework specifiers are external (not files in this repo).
        if (spec.startsWith('dw/') || spec === 'server' || spec === 'dw') {
            return { kind: 'external', specifier, shadows: [] };
        }

        // Relative require.
        if (spec.startsWith('./') || spec.startsWith('../')) {
            const hit = CartridgeResolver.tryFile(path.resolve(path.dirname(fromAbs), spec));
            return hit
                ? { kind: 'module', abs: hit, specifier, shadows: [] }
                : { kind: 'external', specifier, shadows: [] };
        }

        const starMatch = /^\*\/cartridge\/(.+)$/.exec(spec);
        if (starMatch) {
            return this.searchCartridgePath(starMatch[1], 'cartridge', specifier);
        }

        const tildeMatch = /^~\/cartridge\/(.+)$/.exec(spec);
        if (tildeMatch) {
            return this.resolveTildeSpecifier(tildeMatch[1], fromAbs, specifier);
        }

        const baseMatch = /^app_storefront_base\/cartridge\/(.+)$/.exec(spec);
        if (baseMatch) {
            return this.resolveExplicitBase(baseMatch[1], baseMatch[1], 'app_storefront_base', specifier);
        }

        const clientBase = /^base\/(.+)$/.exec(spec);
        if (clientBase) {
            return this.resolveExplicitBase(clientBase[1], 'client/default/js/' + clientBase[1], 'app_storefront_base', specifier);
        }

        return { kind: 'external', specifier, shadows: [] };
    }


    /** Resolve an ISML <isinclude template="..."> local include, leftmost wins. */
    resolveTemplate(name: string): Resolution {
        const rest = name.replace(/^\//, '').replace(/\.isml$/, '');
        const hits: { cart: string; abs: string }[] = [];
        for (const c of this.order) {
            const cand = c.cartridgeDir + '/templates/default/' + rest + '.isml';
            if (exists(cand)) hits.push({ cart: c.name, abs: cand });
        }
        if (!hits.length) return { kind: 'external', specifier: name, shadows: [] };
        return {
            kind: 'module',
            abs: hits[0].abs,
            specifier: name,
            shadows: hits.slice(1).map((h) => h.abs),
            winnerCartridge: hits[0].cart
        };
    }

    private searchCartridgePath(rest: string, sub: string, specifier: string): Resolution {
        const hits: { cart: string; abs: string }[] = [];
        for (const c of this.order) {
            const candBase = (sub === 'cartridge' ? c.cartridgeDir : c.dir) + '/' + rest;
            const hit = CartridgeResolver.tryFile(candBase);
            if (hit) hits.push({ cart: c.name, abs: hit });
        }
        if (!hits.length) return { kind: 'external', specifier, shadows: [] };
        return {
            kind: 'module',
            abs: hits[0].abs,
            specifier,
            shadows: hits.slice(1).map((h) => h.abs),
            winnerCartridge: hits[0].cart
        };
    }

    /**
     * module.superModule: the same logical module one cartridge DOWN the path from the one
     * that owns fromAbs. Returns the absolute path or null.
     */
    superModuleOf(fromAbs: string): string | null {
        const owner = this.order.find((c) => fromAbs.startsWith(c.cartridgeDir + '/'));
        if (!owner) return null;
        const rel = fromAbs.slice(owner.cartridgeDir.length + 1); // e.g. controllers/Checkout.js
        const startIdx = this.order.indexOf(owner);
        for (let i = startIdx + 1; i < this.order.length; i++) {
            const cand = this.order[i].cartridgeDir + '/' + rel;
            if (exists(cand)) return cand;
        }
        return null;
    }

    /** Which cartridge owns an absolute path, or null. */
    ownerCartridge(abs: string): string | null {
        const owner = this.order.find((c) => abs.startsWith(c.cartridgeDir + '/'));
        return owner ? owner.name : null;
    }

    /**
     * Every cartridge (in priority order, leftmost wins) that contains the same cartridge-relative
     * path as `abs`. The first entry is the winner on the path; the rest are shadowed overrides.
     */
    shadowChain(abs: string): { cartridge: string; abs: string }[] {
        const owner = this.order.find((c) => abs.startsWith(c.cartridgeDir + '/'));
        if (!owner) return [];
        const rel = abs.slice(owner.cartridgeDir.length + 1);
        const out: { cartridge: string; abs: string }[] = [];
        for (const c of this.order) {
            const cand = c.cartridgeDir + '/' + rel;
            if (exists(cand)) out.push({ cartridge: c.name, abs: cand });
        }
        return out;
    }
}
