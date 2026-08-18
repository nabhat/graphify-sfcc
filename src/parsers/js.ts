// JS analyzer: extracts SFCC-relevant facts from a cartridge .js file using the TypeScript-ESLint
// ESTree parser. One traversal pass emits require/superModule/route/hook/pref/global/api edges.

import path from 'pathe';
import { parse, simpleTraverse, TSESTree } from '@typescript-eslint/typescript-estree';
import { CartridgeResolver } from '../resolve/cartridgePath.js';
import { Fragment, GNode, GEdge, id, emptyFragment, classifyExternal } from '../types.js';
import { relPath } from '../resolve/repo.js';

const ROUTE_VERBS: Record<string, GEdge['kind']> = {
    prepend: 'prependRoute',
    append: 'appendRoute',
    replace: 'replaceRoute',
    get: 'addRoute',
    post: 'addRoute',
    use: 'addRoute'
};
const AMBIENT_GLOBALS = new Set(['session', 'request', 'customer', 'response']);
const URLUTILS_METHODS = new Set(['url', 'https', 'http', 'abs', 'httpsHome']);

/** String value of a string Literal node, else null. */
function strLit(node: unknown): string | null {
    const n = node as TSESTree.Node | undefined;
    if (n?.type === 'Literal' && typeof (n as TSESTree.Literal).value === 'string') {
        return (n as TSESTree.Literal).value as string;
    }
    return null;
}

/** Object identifier name of a `obj.prop` member expression callee, else null. */
function objName(node: TSESTree.Node): string | null {
    const n = node as any;
    if (n.type === 'MemberExpression' && n.object?.type === 'Identifier') return n.object.name;
    return null;
}

/** Property name of a `obj.prop` member expression, else null. */
function propName(node: TSESTree.Node): string | null {
    const n = node as any;
    if (n.type === 'MemberExpression' && n.property?.type === 'Identifier') return n.property.name;
    return null;
}

/** The string specifier if `node` is a require('literal') call, else null. */
function requireSpec(node: any): string | null {
    if (node?.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require') {
        return strLit(node.arguments[0]);
    }
    return null;
}

/** Parse a hook-name arg: string literal -> exact name; `'prefix' + x` -> dynamic prefix; else neither. */
function parseHookName(node: any): { hookName: string | null; prefix: string | null } {
    const lit = strLit(node);
    if (lit !== null) return { hookName: lit, prefix: null };
    if (node?.type === 'BinaryExpression' && node.operator === '+') {
        const leftLit = strLit(node.left);
        if (leftLit !== null) return { hookName: null, prefix: leftLit };
    }
    return { hookName: null, prefix: null };
}

interface ParseCtx {
    abs: string;
    rel: string;
    moduleId: string;
    controller: string | null;
    curLine: number;
    resolver: CartridgeResolver;
    frag: Fragment;
    moduleNode: GNode;
    bindings: Map<string, { rel: string | null; external: boolean; member?: string; spec: string }>;
    callSites: { kind: 'member' | 'inline' | 'ident'; obj?: string; name: string; rel?: string | null; line: number; spec?: string }[];
    resolveCache: Map<string, { rel: string | null; external: boolean }>;
    hookCalls: { via: 'callHook' | 'helper'; callee: string; hookName: string | null; prefix: string | null; fn: string; line: number }[];
    globals: Record<string, string[]>;
    globalLines: Record<string, number>;
    exportsList: string[];
    localDefs: Map<string, number>;
    seenRequire: Set<string>;
    seenRoute: Set<string>;
    seenLink: Set<string>;
    seenPref: Set<string>;
    seenApi: Set<string>;
    seenRender: Set<string>;
    seenForm: Set<string>;
}

function bindResolved(ctx: ParseCtx, spec: string): { rel: string | null; external: boolean } {
    const cached = ctx.resolveCache.get(spec);
    if (cached) return cached;
    const r = ctx.resolver.resolve(spec, ctx.abs);
    const out = r.kind === 'module' && r.abs ? { rel: relPath(r.abs), external: false } : { rel: null, external: true };
    ctx.resolveCache.set(spec, out);
    return out;
}

function addRequire(ctx: ParseCtx, spec: string): void {
    if (ctx.seenRequire.has(spec)) return;
    ctx.seenRequire.add(spec);
    const r = ctx.resolver.resolve(spec, ctx.abs);
    if (r.kind === 'module' && r.abs) {
        const targetId = id.module(relPath(r.abs));
        ctx.frag.edges.push({
            source: ctx.moduleId,
            target: targetId,
            kind: 'requires',
            attrs: { specifier: spec, winner: r.winnerCartridge, shadows: r.shadows.map(relPath), line: ctx.curLine }
        });
    } else {
        const extId = id.external(spec);
        ctx.frag.nodes.push({ id: extId, kind: 'external', label: spec, attrs: { origin: classifyExternal(spec) } });
        ctx.frag.edges.push({ source: ctx.moduleId, target: extId, kind: 'requires', attrs: { specifier: spec, line: ctx.curLine } });
    }
}

function addRoute(ctx: ParseCtx, name: string, kind: GEdge['kind']): void {
    if (!ctx.controller) return;
    const routeId = id.route(ctx.controller + '-' + name);
    const dedup = kind + ':' + routeId;
    if (ctx.seenRoute.has(dedup)) return;
    ctx.seenRoute.add(dedup);
    ctx.frag.nodes.push({ id: routeId, kind: 'route', label: ctx.controller + '-' + name, attrs: { controller: ctx.controller, action: name } });
    ctx.frag.edges.push({ source: ctx.moduleId, target: routeId, kind, attrs: { line: ctx.curLine } });
}

function addLink(ctx: ParseCtx, controllerAction: string): void {
    if (!/^[A-Za-z]\w*-[A-Za-z]\w*$/.test(controllerAction)) return;
    if (ctx.seenLink.has(controllerAction)) return;
    ctx.seenLink.add(controllerAction);
    const routeId = id.route(controllerAction);
    ctx.frag.nodes.push({ id: routeId, kind: 'route', label: controllerAction, attrs: {} });
    ctx.frag.edges.push({ source: ctx.moduleId, target: routeId, kind: 'linksToRoute', attrs: { line: ctx.curLine } });
}

function addPref(ctx: ParseCtx, prefId: string): void {
    if (ctx.seenPref.has(prefId)) return;
    ctx.seenPref.add(prefId);
    ctx.frag.nodes.push({ id: id.pref(prefId), kind: 'pref', label: prefId, attrs: {} });
    ctx.frag.edges.push({ source: ctx.moduleId, target: id.pref(prefId), kind: 'readsPref', attrs: { line: ctx.curLine } });
}

function addApi(ctx: ParseCtx, className: string): void {
    if (ctx.seenApi.has(className)) return;
    ctx.seenApi.add(className);
    ctx.frag.nodes.push({ id: id.apiClass(className), kind: 'apiClass', label: className, attrs: {} });
    ctx.frag.edges.push({ source: ctx.moduleId, target: id.apiClass(className), kind: 'callsApi', attrs: { line: ctx.curLine } });
}

function addRender(ctx: ParseCtx, tpl: string): void {
    if (ctx.seenRender.has(tpl)) return;
    ctx.seenRender.add(tpl);
    const r = ctx.resolver.resolveTemplate(tpl);
    let targetId: string;
    if (r.kind === 'module' && r.abs) {
        targetId = id.template(relPath(r.abs));
        ctx.frag.nodes.push({ id: targetId, kind: 'template', label: relPath(r.abs), attrs: {} });
    } else {
        targetId = id.template(tpl);
        ctx.frag.nodes.push({ id: targetId, kind: 'template', label: tpl, attrs: { unresolved: true } });
    }
    ctx.frag.edges.push({ source: ctx.moduleId, target: targetId, kind: 'rendersTemplate', attrs: { template: tpl, line: ctx.curLine } });
}

function addForm(ctx: ParseCtx, name: string): void {
    if (ctx.seenForm.has(name)) return;
    ctx.seenForm.add(name);
    ctx.frag.nodes.push({ id: id.form(name), kind: 'form', label: name, attrs: {} });
    ctx.frag.edges.push({ source: ctx.moduleId, target: id.form(name), kind: 'usesForm', attrs: { line: ctx.curLine } });
}

function handleObjectPatternBinding(ctx: ParseCtx, directSpec: string, n: any): void {
    for (const p of n.id.properties) {
        if (p.type === 'Property' && p.key?.type === 'Identifier') {
            const local = p.value?.type === 'Identifier' ? p.value.name : p.key.name;
            ctx.bindings.set(local, { ...bindResolved(ctx, directSpec), member: p.key.name, spec: directSpec });
        }
    }
}

function handleVariableDeclarator(ctx: ParseCtx, n: any): void {
    if (!n.init) return;
    const directSpec = requireSpec(n.init);
    if (directSpec && n.id?.type === 'Identifier') {
        ctx.bindings.set(n.id.name, { ...bindResolved(ctx, directSpec), spec: directSpec });
    } else if (directSpec && n.id?.type === 'ObjectPattern') {
        handleObjectPatternBinding(ctx, directSpec, n);
    } else if (n.init.type === 'MemberExpression' && n.id?.type === 'Identifier' && n.init.property?.type === 'Identifier') {
        const memberSpec = requireSpec(n.init.object);
        if (memberSpec) ctx.bindings.set(n.id.name, { ...bindResolved(ctx, memberSpec), member: n.init.property.name, spec: memberSpec });
    }
}

function handleIdentifierCall(ctx: ParseCtx, n: any): void {
    if (n.callee.name === 'require') {
        const spec = strLit(n.arguments[0]);
        if (spec) addRequire(ctx, spec);
        return;
    }
    if (n.arguments.length >= 2) {
        const fn = strLit(n.arguments[1]);
        if (fn) {
            const hn = parseHookName(n.arguments[0]);
            if (hn.hookName || hn.prefix) {
                ctx.hookCalls.push({ via: 'helper', callee: n.callee.name, hookName: hn.hookName, prefix: hn.prefix, fn, line: ctx.curLine });
            }
        }
    }
    ctx.callSites.push({ kind: 'ident', name: n.callee.name, line: ctx.curLine });
}

function handleServerAndRouteCalls(ctx: ParseCtx, obj: string | null, prop: string | null, n: any): void {
    if (obj === 'server' && prop) {
        if (prop === 'extend') {
            ctx.moduleNode.attrs.usesSuperModule = true;
        } else if (ROUTE_VERBS[prop]) {
            const name = strLit(n.arguments[0]);
            if (name) addRoute(ctx, name, ROUTE_VERBS[prop]);
        }
    }
    if (obj === 'URLUtils' && prop && URLUTILS_METHODS.has(prop)) {
        const ca = strLit(n.arguments[0]);
        if (ca) addLink(ctx, ca);
    }
}

function handleFrameworkMemberCall(ctx: ParseCtx, obj: string | null, prop: string | null, n: any): void {
    handleServerAndRouteCalls(ctx, obj, prop, n);
    if (prop === 'getCustomPreferenceValue') {
        const pid = strLit(n.arguments[0]);
        if (pid) addPref(ctx, pid);
    }
    if (obj === 'Transaction' && (prop === 'wrap' || prop === 'begin')) {
        ctx.moduleNode.attrs.transactionWraps = (ctx.moduleNode.attrs.transactionWraps as number) + 1;
    }
    if (obj === 'res' && prop === 'render') {
        const tpl = strLit(n.arguments[0]);
        if (tpl) addRender(ctx, tpl);
    }
    if (prop === 'getForm') {
        const fname = strLit(n.arguments[0]);
        if (fname) addForm(ctx, fname);
    }
}

function handleMemberCall(ctx: ParseCtx, n: any): void {
    const obj = objName(n.callee);
    const prop = propName(n.callee);

    handleFrameworkMemberCall(ctx, obj, prop, n);

    if (prop === 'callHook' && n.arguments.length >= 2) {
        const fn = strLit(n.arguments[1]);
        if (fn) {
            const hn = parseHookName(n.arguments[0]);
            if (hn.hookName || hn.prefix) {
                ctx.hookCalls.push({ via: 'callHook', callee: obj || '', hookName: hn.hookName, prefix: hn.prefix, fn, line: ctx.curLine });
            }
        }
    }

    const inlineSpec = requireSpec(n.callee.object);
    if (inlineSpec) {
        const b = bindResolved(ctx, inlineSpec);
        if (b.rel && prop) ctx.callSites.push({ kind: 'inline', name: prop, rel: b.rel, line: ctx.curLine, spec: inlineSpec });
    } else if (obj && prop) {
        ctx.callSites.push({ kind: 'member', obj, name: prop, line: ctx.curLine });
    }
}

function handleCallExpression(ctx: ParseCtx, n: any): void {
    if (n.callee.type === 'Identifier') {
        handleIdentifierCall(ctx, n);
    } else if (n.callee.type === 'MemberExpression') {
        handleMemberCall(ctx, n);
    }
}

function handleNewExpression(ctx: ParseCtx, n: any): void {
    if (n.callee.type === 'Identifier' && n.callee.name === 'URLAction') {
        const ca = strLit(n.arguments[0]);
        if (ca) addLink(ctx, ca);
    } else if (n.callee.type === 'MemberExpression') {
        const cls = propName(n.callee);
        if (cls?.endsWith('Api')) addApi(ctx, cls);
    }
}

function handleDwAndExportsMember(ctx: ParseCtx, n: any): void {
    if (
        n.object.type === 'MemberExpression' &&
        n.object.object?.type === 'Identifier' &&
        n.object.object.name === 'dw' &&
        n.object.property?.type === 'Identifier' &&
        n.property?.type === 'Identifier'
    ) {
        addRequire(ctx, 'dw/' + n.object.property.name + '/' + n.property.name);
        return;
    }

    if (n.object.type === 'Identifier') {
        if (n.object.name === 'exports' && n.property?.type === 'Identifier') {
            if (!ctx.exportsList.includes(n.property.name)) ctx.exportsList.push(n.property.name);
        } else if (n.object.name === 'module' && n.property?.type === 'Identifier' && n.property.name === 'superModule') {
            ctx.moduleNode.attrs.usesSuperModule = true;
        }
    }
}

function handleMemberExpression(ctx: ParseCtx, n: any): void {
    if (n.object?.type === 'Identifier' && AMBIENT_GLOBALS.has(n.object.name)) {
        const g = n.object.name as string;
        const member = n.property?.type === 'Identifier' ? n.property.name : '*';
        if (!ctx.globals[g]) ctx.globals[g] = [];
        ctx.globalLines[g] ??= ctx.curLine;
        if (!ctx.globals[g].includes(member)) ctx.globals[g].push(member);
        return;
    }

    handleDwAndExportsMember(ctx, n);
}

function resolveCallTarget(ctx: ParseCtx, cs: any): { targetRel: string | null; name: string; via: string } {
    let targetRel: string | null = null;
    let name = cs.name;
    let via = '';
    if (cs.kind === 'inline') {
        targetRel = cs.rel || null;
        via = 'inline-require';
    } else if (cs.kind === 'member') {
        const b = ctx.bindings.get(cs.obj as string);
        if (b && !b.external && b.rel && !b.member) {
            targetRel = b.rel;
            via = 'require-alias';
        }
    } else {
        const b = ctx.bindings.get(cs.name);
        if (b && !b.external && b.rel && b.member) {
            targetRel = b.rel;
            name = b.member;
            via = 'require-member';
        } else if (ctx.localDefs.has(cs.name)) {
            targetRel = ctx.rel;
            via = 'same-file';
        }
    }
    return { targetRel, name, via };
}

function emitCallSites(ctx: ParseCtx): void {
    const seenCall = new Set<string>();
    for (const cs of ctx.callSites) {
        const { targetRel, name, via } = resolveCallTarget(ctx, cs);
        if (!targetRel) continue;
        const targetId = id.symbol(targetRel, name);
        const dedup = via + '|' + targetId + '|' + cs.line;
        if (seenCall.has(dedup)) continue;
        seenCall.add(dedup);
        ctx.frag.edges.push({
            source: ctx.moduleId,
            target: targetId,
            kind: 'callsSymbol',
            attrs: { name, line: cs.line, via, specifier: cs.spec || null }
        });
    }
}

/**
 * Analyze a cartridge JS file. Emits the module node plus every SFCC edge it participates in.
 * Resolution (require, superModule) uses the cartridge-path resolver.
 */
export function parseJsFile(abs: string, source: string, resolver: CartridgeResolver): Fragment {
    const frag = emptyFragment();
    const rel = relPath(abs);
    const moduleId = id.module(rel);
    const owner = resolver.ownerCartridge(abs);
    const isController = /\/controllers\//.test(rel);
    const isProcessor = /\/scripts\/hooks\/.*processor\//.test(rel);

    const controller = isController ? path.basename(rel).replace(/\.js$/, '') : null;

    const moduleNode: GNode = {
        id: moduleId,
        kind: 'module',
        label: rel,
        attrs: {
            cartridge: owner,
            isController,
            isProcessor,
            controller,
            exports: [] as string[],
            globals: {} as Record<string, string[]>,
            transactionWraps: 0,
            usesSuperModule: false
        }
    };
    frag.nodes.push(moduleNode);

    let ast: TSESTree.Program;
    try {
        ast = parse(source, { loc: true, range: false, jsx: false, errorOnUnknownASTType: false });
    } catch {
        return frag;
    }

    const ctx: ParseCtx = {
        abs, rel, moduleId, controller, curLine: 0, resolver, frag, moduleNode,
        bindings: new Map(), callSites: [], resolveCache: new Map(), hookCalls: [],
        globals: moduleNode.attrs.globals as Record<string, string[]>,
        globalLines: {},
        exportsList: moduleNode.attrs.exports as string[],
        localDefs: new Map(),
        seenRequire: new Set(), seenRoute: new Set(), seenLink: new Set(),
        seenPref: new Set(), seenApi: new Set(), seenRender: new Set(), seenForm: new Set()
    };

    simpleTraverse(ast, {
        enter(node: TSESTree.Node): void {
            const n = node as any;
            if (n.loc) ctx.curLine = n.loc.start.line;

            if (n.type === 'CallExpression') {
                handleCallExpression(ctx, n);
            } else if (n.type === 'VariableDeclarator') {
                handleVariableDeclarator(ctx, n);
            } else if (n.type === 'NewExpression') {
                handleNewExpression(ctx, n);
            } else if (n.type === 'MemberExpression') {
                handleMemberExpression(ctx, n);
            } else if (n.type === 'FunctionDeclaration' && n.id) {
                if (!ctx.localDefs.has(n.id.name)) ctx.localDefs.set(n.id.name, ctx.curLine);
                if ((n.id.name === 'Handle' || n.id.name === 'Authorize') && !ctx.exportsList.includes(n.id.name)) {
                    ctx.exportsList.push(n.id.name);
                }
            }
        }
    });

    for (const g of Object.keys(ctx.globals)) {
        const gid = id.global(g);
        frag.nodes.push({ id: gid, kind: 'global', label: g, attrs: {} });
        frag.edges.push({ source: moduleId, target: gid, kind: 'usesGlobal', attrs: { members: ctx.globals[g], line: ctx.globalLines[g] } });
    }

    if (isProcessor) {
        const fns = ctx.exportsList.filter((e) => e === 'Handle' || e === 'Authorize');
        if (fns.length) moduleNode.attrs.processorFns = fns;
    }

    for (const [name, line] of ctx.localDefs) {
        const symId = id.symbol(rel, name);
        frag.nodes.push({ id: symId, kind: 'symbol', label: rel + '#' + name, attrs: { name, module: rel, line } });
        frag.edges.push({ source: moduleId, target: symId, kind: 'definesSymbol', attrs: { name, line } });
    }

    emitCallSites(ctx);

    const dispatches: { hookName: string | null; prefix: string | null; fn: string; line: number; via: string }[] = [];
    for (const hc of ctx.hookCalls) {
        if (hc.via === 'helper') {
            const b = ctx.bindings.get(hc.callee);
            if (!b?.rel || b.external || !b.rel.endsWith('/scripts/helpers/hooks.js')) continue;
        }
        dispatches.push({ hookName: hc.hookName, prefix: hc.prefix, fn: hc.fn, line: hc.line, via: hc.via });
    }
    if (dispatches.length) moduleNode.attrs.hookDispatches = dispatches;

    return frag;
}
