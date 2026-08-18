// Repo access: root resolution, path-safety, cartridge discovery, and globbing. Read-only.

import fs from 'node:fs';
import path from 'pathe';
import fg from 'fast-glob';

const IGNORE = ['**/node_modules/**', '**/.git/**', '**/.cache/**', '**/dist/**', '**/static/**'];

/** A discovered cartridge: a directory containing a `cartridge/` subfolder. */
export interface Cartridge {
    name: string; // basename, e.g. "app_storefront_base"
    dir: string; // absolute dir that contains the `cartridge` folder
    cartridgeDir: string; // absolute `<dir>/cartridge`
}

/**
 * Absolute, normalized repo root. Configurable via SFCC_GRAPH_ROOT, else CLAUDE_PROJECT_DIR,
 * else the process cwd.
 */
export function getRoot(): string {
    const raw = process.env.SFCC_GRAPH_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    return path.resolve(raw);
}

/**
 * Directory for the on-disk graph cache. The cache is a parse of the TARGET repo, so it lives under
 * that repo's root (`<getRoot()>/.sfcc-graph-cache`) — one cache per project, so running the tool
 * against multiple projects never collides. Override with the SFCC_GRAPH_CACHE env var. Shared by the
 * indexer (writer) and the visualizer (reader) so they never diverge. Add `.sfcc-graph-cache/` to the
 * target repo's .gitignore.
 */
export function cacheDir(): string {
    if (process.env.SFCC_GRAPH_CACHE) return path.resolve(process.env.SFCC_GRAPH_CACHE);
    const newCache = path.join(getRoot(), '.graphify-sfcc-cache');
    const oldCache = path.join(getRoot(), '.sfcc-graph-cache');
    if (!fs.existsSync(newCache) && fs.existsSync(oldCache)) {
        return oldCache;
    }
    return newCache;
}


/** Resolve a user path (relative or absolute) and guarantee it stays inside the root. */
export function resolveInRoot(file: string): string {
    const root = getRoot();
    const abs = path.resolve(root, file);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('Path is outside the project root: ' + file);
    }
    // pathe returns forward-slash paths, so abs is already normalized for comparisons against
    // cartridgeDir (also pathe-normalized) on Windows. fs.statSync accepts '/' on Windows.
    return abs;
}

/** Project-relative, forward-slash display path. */
export function relPath(abs: string): string {
    return path.relative(getRoot(), abs);
}

/** Read a UTF-8 file. */
export function readSource(abs: string): string {
    return fs.readFileSync(abs, 'utf8');
}

/** True if a file exists. */
export function exists(abs: string): boolean {
    try {
        return fs.statSync(abs).isFile();
    } catch {
        return false;
    }
}

/**
 * The cartridge resolution path declared in dw.json (`cartridgesPath`), or null if there is no
 * dw.json or no such key. This mirrors the Business Manager site cartridge path.
 */
export function dwJsonCartridgePath(): string | null {
    const p = path.join(getRoot(), 'dw.json');
    try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return typeof data.cartridgesPath === 'string' && data.cartridgesPath.trim() ? data.cartridgesPath : null;
    } catch {
        return null;
    }
}

/** Glob (sync) relative to root, returning absolute paths with forward slashes. */
export function glob(patterns: string[]): string[] {
    const root = getRoot();
    return fg.sync(patterns, { cwd: root, ignore: IGNORE, absolute: true, dot: false, onlyFiles: true });
}

/**
 * Discover cartridges: any directory that contains a `cartridge/` subfolder. Deduped by absolute
 * path. Ordering here is discovery order, NOT cartridge-path priority (that lives in cartridgePath.ts).
 */
export function discoverCartridges(): Cartridge[] {
    const root = getRoot();
    const dirs = fg.sync(['**/cartridge'], {
        cwd: root,
        ignore: IGNORE,
        absolute: true,
        onlyDirectories: true
    });
    const out: Cartridge[] = [];
    const seen = new Set<string>();
    for (const cartridgeDir of dirs) {
        const dir = path.dirname(cartridgeDir);
        const name = path.basename(dir);
        const key = path.resolve(dir);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            name,
            dir,
            cartridgeDir
        });
    }
    return out;
}
