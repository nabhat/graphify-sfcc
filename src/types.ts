// Graph model for the SFCC/Demandware code graph.
//
// Parsers emit Fragment { nodes, edges }; the indexer merges fragments into a graphology
// MultiDirectedGraph. Node ids are stable, human-readable strings so tools can address them
// directly (e.g. "route:Checkout-Begin", "pref:MyCartridge_Enabled").

export type NodeKind =
    | 'cartridge' // an SFCC cartridge on the path
    | 'module' // a .js file (controller / script / model / hook / apiClient)
    | 'template' // an .isml template
    | 'route' // a Controller-Action endpoint
    | 'hook' // a hooks.json hook name
    | 'pref' // a site preference (join key between code reads and metadata)
    | 'global' // a dw ambient global (session, request, customer, pdict, ...)
    | 'external' // an unresolved / platform require target (dw/*, server, unknown)
    | 'service' // a dw.svc service definition (services.xml)
    | 'form' // a cartridge form (forms/**/*.xml)
    | 'job' // a job-step script (scripts/jobs)
    | 'customObject' // a custom-object type
    | 'apiClass' // an apiClient REST SDK class
    | 'symbol'; // a top-level function definition inside a module (name + def line)

export type EdgeKind =
    | 'overlays' // cartridge -> cartridge it overlays (lower priority), path order
    | 'superModule' // module -> module one cartridge down-path (module.superModule)
    | 'requires' // module -> module | external it require()s
    | 'extendsRoute' // module -> route (server.extend of the base controller)
    | 'prependRoute' // module -> route (server.prepend)
    | 'appendRoute' // module -> route (server.append)
    | 'replaceRoute' // module -> route (server.replace)
    | 'addRoute' // module -> route (server.get/post/use — new route)
    | 'callsHook' // hook -> module (hooks.json maps a hook name to a script)
    | 'includesTemplate' // template -> template (<isinclude template=>)
    | 'remoteIncludes' // template -> route (<isinclude url=${URLUtils.url('C-A')}>)
    | 'linksToRoute' // module|template -> route (URLUtils.url/https('C-A'))
    | 'readsPref' // module -> pref (getCustomPreferenceValue / configuration accessor)
    | 'definesPref' // module|meta -> pref (customPreferences.js id / metadata attribute-id)
    | 'usesGlobal' // module|template -> global
    | 'callsApi' // module -> apiClass (new CustomRestApi.XxxApi)
    | 'rendersTemplate' // module (controller) -> template (res.render('...'))
    | 'usesForm' // module -> form (server.forms.getForm('...'))
    | 'registersProcessor' // module -> module (processor Handle/Authorize export)

    | 'definesSymbol' // module -> symbol (a top-level function the module declares)
    | 'callsSymbol'; // module -> symbol (a resolved call site: caller module -> target function)

export interface GNode {
    id: string;
    kind: NodeKind;
    label: string;
    attrs: Record<string, unknown>;
}

export interface GEdge {
    source: string;
    target: string;
    kind: EdgeKind;
    attrs: Record<string, unknown>;
}

export interface Fragment {
    nodes: GNode[];
    edges: GEdge[];
}

/** An empty fragment, for accumulation. */
export function emptyFragment(): Fragment {
    return { nodes: [], edges: [] };
}

/** Merge fragment b into a (in place) and return a. */
export function mergeFragment(a: Fragment, b: Fragment): Fragment {
    for (const n of b.nodes) a.nodes.push(n);
    for (const e of b.edges) a.edges.push(e);
    return a;
}

/**
 * Classify an unresolved require target: `dw/*` is a platform API (provided at runtime, not a file
 * in the repo), `server`/`base/*` is SFRA framework, everything else is genuinely unknown.
 */
export function classifyExternal(spec: string): 'platform' | 'framework' | 'unknown' {
    if (spec === 'dw' || spec.startsWith('dw/')) return 'platform';
    if (spec === 'server' || spec.startsWith('base/')) return 'framework';
    return 'unknown';
}


// ---- id helpers (single source of truth for node id formatting) ----

export const id = {
    cartridge: (name: string): string => `cartridge:${name}`,
    module: (relPath: string): string => `module:${relPath}`,
    template: (relPath: string): string => `template:${relPath}`,
    route: (controllerAction: string): string => `route:${controllerAction}`,
    hook: (name: string): string => `hook:${name}`,
    pref: (prefId: string): string => `pref:${prefId}`,
    global: (name: string): string => `global:${name}`,
    external: (specifier: string): string => `external:${specifier}`,
    service: (svcId: string): string => `service:${svcId}`,
    form: (formName: string): string => `form:${formName}`,
    job: (relPath: string): string => `job:${relPath}`,
    customObject: (typeName: string): string => `customObject:${typeName}`,
    apiClass: (className: string): string => `apiClass:${className}`,
    symbol: (relPath: string, name: string): string => `symbol:${relPath}#${name}`
};
