// AST analysis of embedded JS expressions (ISML ${...} and <isscript> bodies) using the ESTree
// parser, so ISML wiring is extracted via a real parser instead of regex. Each snippet is parsed
// independently so one malformed expression does not lose the rest.

import { parse, simpleTraverse, TSESTree } from '@typescript-eslint/typescript-estree';

export interface ExprSignals {
    requires: string[]; // require('...') specifiers
    routeLinks: string[]; // Controller-Action from URLUtils.* / new URLAction
    globals: Record<string, string[]>; // ambient global name -> members accessed
}

const URLUTILS_METHODS = new Set(['url', 'https', 'http', 'abs', 'httpsHome']);
const ISML_GLOBALS = new Set(['pdict', 'session', 'request', 'customer', 'slotcontent']);

function strLit(node: unknown): string | null {
    const n = node as TSESTree.Node | undefined;
    return n?.type === 'Literal' && typeof (n as TSESTree.Literal).value === 'string'
        ? ((n as TSESTree.Literal).value as string)
        : null;
}

function isControllerAction(s: string): boolean {
    return /^[A-Za-z]\w*-[A-Za-z]\w*$/.test(s);
}

function pushUniq(arr: string[], v: string): void {
    if (!arr.includes(v)) arr.push(v);
}

function visitCallExpression(n: any, out: ExprSignals): void {
    if (n.callee.type === 'Identifier' && n.callee.name === 'require') {
        const s = strLit(n.arguments[0]);
        if (s) pushUniq(out.requires, s);
        return;
    }
    if (
        n.callee.type === 'MemberExpression' &&
        n.callee.object.type === 'Identifier' &&
        n.callee.object.name === 'URLUtils' &&
        n.callee.property.type === 'Identifier' &&
        URLUTILS_METHODS.has(n.callee.property.name)
    ) {
        const ca = strLit(n.arguments[0]);
        if (ca && isControllerAction(ca)) pushUniq(out.routeLinks, ca);
    }
}

function visitNewExpression(n: any, out: ExprSignals): void {
    if (n.callee.type === 'Identifier' && n.callee.name === 'URLAction') {
        const ca = strLit(n.arguments[0]);
        if (ca && isControllerAction(ca)) pushUniq(out.routeLinks, ca);
    }
}

function visitMemberExpression(n: any, out: ExprSignals): void {
    if (n.object.type === 'Identifier' && ISML_GLOBALS.has(n.object.name)) {
        const g = n.object.name as string;
        const member = n.property?.type === 'Identifier' ? n.property.name : '*';
        if (!out.globals[g]) out.globals[g] = [];
        pushUniq(out.globals[g], member);
    }
}

/** Analyze a set of JS expression snippets and merge their signals. */
export function analyzeExpressions(snippets: string[]): ExprSignals {
    const out: ExprSignals = { requires: [], routeLinks: [], globals: {} };
    for (const snippet of snippets) {
        const src = snippet.trim();
        if (!src) continue;
        let ast: TSESTree.Program;
        try {
            ast = parse(src, { loc: false, range: false, jsx: false, errorOnUnknownASTType: false });
        } catch {
            continue; // not a parseable JS expression — skip
        }
        simpleTraverse(ast, {
            enter(node: TSESTree.Node): void {
                const n = node as any;
                if (n.type === 'CallExpression') {
                    visitCallExpression(n, out);
                } else if (n.type === 'NewExpression') {
                    visitNewExpression(n, out);
                } else if (n.type === 'MemberExpression') {
                    visitMemberExpression(n, out);
                }
            }
        });
    }
    return out;
}


/**
 * Extract the inner text of each `${ ... }` expression from a string (balanced braces). This tiny
 * delimiter scan is inherent to ISML's expression syntax — there is no off-the-shelf ISML parser.
 */
export function extractDollarExpressions(s: string): string[] {
    const out: string[] = [];
    let i = 0;
    while ((i = s.indexOf('${', i)) !== -1) {
        let depth = 0;
        let j = i + 2;
        const start = j;
        for (; j < s.length; j++) {
            const c = s[j];
            if (c === '{') depth++;
            else if (c === '}') {
                if (depth === 0) break;
                depth--;
            }
        }
        out.push(s.slice(start, j));
        i = j + 1;
    }
    return out;
}
