// Public API for @sfcc-graph/core — the reusable SFCC/Demandware code-graph engine.
// Consumers build a graph over any SFCC repo and query it, or reuse the cartridge-path resolver /
// parsers standalone. Frontends (mcp, cli, viz) and external projects import from here.

export * from './types.js';
export { Index } from './graph/indexer.js';
export { buildGraph, exportGraph, importGraph } from './graph/graph.js';
export type { SfccGraph } from './graph/graph.js';
export { CartridgeResolver } from './resolve/cartridgePath.js';
export type { Resolution } from './resolve/cartridgePath.js';
export {
    getRoot,
    resolveInRoot,
    relPath,
    readSource,
    exists,
    dwJsonCartridgePath,
    glob,
    discoverCartridges,
    cacheDir
} from './resolve/repo.js';
export type { Cartridge } from './resolve/repo.js';
