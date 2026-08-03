"use strict";
/**
 * Identifier Collector
 *
 * 纯函数实现，不依赖 vscode 模块。
 * 目标：对任意未知小程序封装（createPage、装饰器、类继承、Composition API 等），
 * 只要 JS/TS 源码里存在同名标识符，就能找出其定义位置。
 *
 * 所有函数只返回字符偏移（start/end），由上层包装为 vscode.Location。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectAllIdentifiers = exports.rankAndDedupe = exports.collectSpreadKeys = exports.collectAssignmentKeys = exports.collectReturnObjectKeys = exports.collectSetDataKeys = exports.collectClassMembers = exports.collectObjectLiteralKeys = void 0;
const ts = require("typescript");
const THIS_LIKE_NAMES = new Set(['this', 'that', 'self', '_this']);
/**
 * 生成一个 hit 记录，自动按 name 长度定位 name 的范围。
 * 若无法对齐到原文 name，则回退到整个节点范围。
 */
function makeHit(sourceFile, anchorNode, name, detail, source) {
    const start = anchorNode.getStart(sourceFile);
    const textAtStart = sourceFile.text.substring(start, start + name.length);
    const end = textAtStart === name ? start + name.length : anchorNode.getEnd();
    return { start, end, name, detail, source, confidence: 'low' };
}
function isFunctionLike(node) {
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node);
}
function getPropNameText(node) {
    if (ts.isShorthandPropertyAssignment(node))
        return node.name.text;
    const n = node.name;
    if (!n)
        return undefined;
    if (ts.isIdentifier(n))
        return n.text;
    if (ts.isStringLiteral(n))
        return n.text;
    if (ts.isPrivateIdentifier(n))
        return undefined; // 跳过 #private
    if (ts.isComputedPropertyName(n))
        return undefined; // 动态 key 跳过
    return undefined;
}
/* -------------------------------------------------------------------------- */
/* 2.1 collectObjectLiteralKeys                                               */
/* -------------------------------------------------------------------------- */
function collectObjectLiteralKeys(sourceFile, type, matchesProp) {
    const hits = [];
    function visit(node) {
        if (ts.isObjectLiteralExpression(node)) {
            for (const prop of node.properties) {
                if (ts.isPropertyAssignment(prop)) {
                    const name = getPropNameText(prop);
                    if (!name) {
                        ts.forEachChild(prop, visit);
                        continue;
                    }
                    const isFn = isFunctionLike(prop.initializer);
                    if ((type === 'prop' && matchesProp(name)) || (type === 'method' && isFn && matchesProp(name))) {
                        hits.push(makeHit(sourceFile, prop.name, name, `${name}`, 'object-literal'));
                    }
                }
                else if (ts.isShorthandPropertyAssignment(prop)) {
                    const name = prop.name.text;
                    if (type === 'prop' && matchesProp(name)) {
                        hits.push(makeHit(sourceFile, prop.name, name, `${name} (shorthand)`, 'object-literal'));
                    }
                }
                else if (ts.isMethodDeclaration(prop)) {
                    const name = getPropNameText(prop);
                    if (name && type === 'method' && matchesProp(name)) {
                        hits.push(makeHit(sourceFile, prop.name, name, `${name}()`, 'object-literal'));
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return hits;
}
exports.collectObjectLiteralKeys = collectObjectLiteralKeys;
/* -------------------------------------------------------------------------- */
/* 2.2 collectClassMembers                                                    */
/* -------------------------------------------------------------------------- */
function collectClassMembers(sourceFile, type, matchesProp) {
    const hits = [];
    function visit(node) {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
            for (const member of node.members) {
                if (ts.isPropertyDeclaration(member)) {
                    const name = getPropNameText(member);
                    if (name && type === 'prop' && matchesProp(name)) {
                        hits.push(makeHit(sourceFile, member.name, name, `class.${name}`, 'class-member'));
                    }
                }
                else if (ts.isMethodDeclaration(member)) {
                    const name = getPropNameText(member);
                    if (name && type === 'method' && matchesProp(name)) {
                        hits.push(makeHit(sourceFile, member.name, name, `class.${name}()`, 'class-member'));
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return hits;
}
exports.collectClassMembers = collectClassMembers;
/* -------------------------------------------------------------------------- */
/* 2.3 collectSetDataKeys                                                     */
/* -------------------------------------------------------------------------- */
function collectSetDataKeys(sourceFile, matchesProp) {
    const hits = [];
    function visit(node) {
        if (ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'setData' &&
            node.arguments.length > 0) {
            const receiver = node.expression.expression;
            const receiverText = receiver.getText(sourceFile);
            const isThisLike = receiver.kind === ts.SyntaxKind.ThisKeyword || (ts.isIdentifier(receiver) && THIS_LIKE_NAMES.has(receiverText));
            if (isThisLike) {
                const arg = node.arguments[0];
                if (ts.isObjectLiteralExpression(arg)) {
                    for (const prop of arg.properties) {
                        if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
                            let name;
                            if (ts.isShorthandPropertyAssignment(prop)) {
                                name = prop.name.text;
                            }
                            else if (ts.isStringLiteral(prop.name)) {
                                // 'list[0].name' → 取首段 'list'
                                name = prop.name.text.split(/[.[]/)[0];
                            }
                            else if (ts.isIdentifier(prop.name)) {
                                name = prop.name.text;
                            }
                            if (name && matchesProp(name)) {
                                hits.push(makeHit(sourceFile, prop.name, name, `setData ${name}`, 'setData'));
                            }
                        }
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return hits;
}
exports.collectSetDataKeys = collectSetDataKeys;
/* -------------------------------------------------------------------------- */
/* 2.4 collectReturnObjectKeys                                                */
/* -------------------------------------------------------------------------- */
function collectReturnObjectKeys(sourceFile, type, matchesProp) {
    const hits = [];
    /** 找到 block/arrow 最终返回的对象字面量 */
    function findReturnedObjects(fn) {
        const objs = [];
        const body = fn.body;
        if (!body)
            return objs;
        if (ts.isBlock(body)) {
            body.forEachChild(function walk(n) {
                if (ts.isReturnStatement(n) && n.expression) {
                    const e = ts.isParenthesizedExpression(n.expression) ? n.expression.expression : n.expression;
                    if (ts.isObjectLiteralExpression(e))
                        objs.push(e);
                }
                else {
                    n.forEachChild(walk);
                }
            });
        }
        else if (ts.isObjectLiteralExpression(body)) {
            objs.push(body);
        }
        else if (ts.isParenthesizedExpression(body) && ts.isObjectLiteralExpression(body.expression)) {
            objs.push(body.expression);
        }
        return objs;
    }
    /** 在同一函数体内查找变量/函数声明（含解构、函数声明、const = fn） */
    function findLocalDecl(fn, name) {
        const body = fn.body;
        if (!body || !ts.isBlock(body))
            return undefined;
        for (const stmt of body.statements) {
            // function foo() {}
            if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.name.text === name) {
                return stmt.name;
            }
            if (!ts.isVariableStatement(stmt))
                continue;
            for (const decl of stmt.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && decl.name.text === name)
                    return decl.name;
                if (ts.isObjectBindingPattern(decl.name)) {
                    for (const el of decl.name.elements) {
                        if (ts.isIdentifier(el.name) && el.name.text === name)
                            return el.name;
                    }
                }
                if (ts.isArrayBindingPattern(decl.name)) {
                    for (const el of decl.name.elements) {
                        if (ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === name) {
                            return el.name;
                        }
                    }
                }
            }
        }
        return undefined;
    }
    function visit(node) {
        if (ts.isArrowFunction(node) ||
            ts.isFunctionExpression(node) ||
            ts.isFunctionDeclaration(node) ||
            ts.isMethodDeclaration(node)) {
            const returned = findReturnedObjects(node);
            for (const obj of returned) {
                for (const prop of obj.properties) {
                    if (ts.isShorthandPropertyAssignment(prop)) {
                        const name = prop.name.text;
                        if (!matchesProp(name))
                            continue;
                        // prop 与 method 都可能命中；对 method，若能找到本地函数声明则指向它
                        const localDecl = findLocalDecl(node, name);
                        if (type === 'prop') {
                            const anchor = localDecl !== null && localDecl !== void 0 ? localDecl : prop.name;
                            hits.push(makeHit(sourceFile, anchor, name, `return { ${name} }`, 'return-destructure'));
                        }
                        else if (type === 'method' && localDecl) {
                            hits.push(makeHit(sourceFile, localDecl, name, `return { ${name} }()`, 'return-destructure'));
                        }
                    }
                    else if (ts.isPropertyAssignment(prop)) {
                        const name = getPropNameText(prop);
                        if (!name)
                            continue;
                        const isFn = isFunctionLike(prop.initializer);
                        if ((type === 'prop' && matchesProp(name)) || (type === 'method' && isFn && matchesProp(name))) {
                            hits.push(makeHit(sourceFile, prop.name, name, `return ${name}`, 'return-destructure'));
                        }
                    }
                    else if (ts.isMethodDeclaration(prop)) {
                        const name = getPropNameText(prop);
                        if (name && type === 'method' && matchesProp(name)) {
                            hits.push(makeHit(sourceFile, prop.name, name, `return ${name}()`, 'return-destructure'));
                        }
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return hits;
}
exports.collectReturnObjectKeys = collectReturnObjectKeys;
/* -------------------------------------------------------------------------- */
/* 2.5 collectAssignmentKeys                                                  */
/* -------------------------------------------------------------------------- */
function collectAssignmentKeys(sourceFile, type, matchesProp) {
    const hits = [];
    function visit(node) {
        if (ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.left)) {
            const left = node.left;
            const receiver = left.expression;
            const nameNode = left.name;
            const name = nameNode.text;
            // 接受：this.x / that.x / <Identifier>.prototype.x
            let accepted = false;
            if (receiver.kind === ts.SyntaxKind.ThisKeyword)
                accepted = true;
            else if (ts.isIdentifier(receiver) && THIS_LIKE_NAMES.has(receiver.text))
                accepted = true;
            else if (ts.isPropertyAccessExpression(receiver) &&
                receiver.name.text === 'prototype' &&
                ts.isIdentifier(receiver.expression)) {
                accepted = true;
            }
            if (accepted && matchesProp(name)) {
                const rightIsFn = isFunctionLike(node.right);
                if ((type === 'prop' && !rightIsFn) ||
                    (type === 'method' && rightIsFn) ||
                    type === 'prop' // prop 查询也允许函数赋值(兼容 getter 风格)
                ) {
                    hits.push(makeHit(sourceFile, nameNode, name, `assign ${name}`, 'assignment'));
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return hits;
}
exports.collectAssignmentKeys = collectAssignmentKeys;
/* -------------------------------------------------------------------------- */
/* 2.6 collectSpreadKeys                                                      */
/* -------------------------------------------------------------------------- */
function collectSpreadKeys(sourceFile, type, matchesProp) {
    const hits = [];
    // 建立文件顶层 const/let/var 的名称 → 初始化表达式映射
    const topLevelBindings = new Map();
    for (const stmt of sourceFile.statements) {
        if (ts.isVariableStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && decl.initializer) {
                    topLevelBindings.set(decl.name.text, decl.initializer);
                }
            }
        }
    }
    function collectFromObjectLike(expr, visited) {
        if (ts.isObjectLiteralExpression(expr)) {
            for (const prop of expr.properties) {
                if (ts.isPropertyAssignment(prop)) {
                    const name = getPropNameText(prop);
                    if (!name)
                        continue;
                    const isFn = isFunctionLike(prop.initializer);
                    if ((type === 'prop' && matchesProp(name)) || (type === 'method' && isFn && matchesProp(name))) {
                        hits.push(makeHit(sourceFile, prop.name, name, `spread ${name}`, 'spread'));
                    }
                }
                else if (ts.isSpreadAssignment(prop)) {
                    resolveAndCollect(prop.expression, visited);
                }
            }
        }
        else if (ts.isCallExpression(expr)) {
            const callText = expr.expression.getText(sourceFile);
            if (callText === 'Object.assign' || callText.endsWith('.assign')) {
                for (const arg of expr.arguments) {
                    resolveAndCollect(arg, visited);
                }
            }
        }
    }
    function resolveAndCollect(expr, visited) {
        if (ts.isIdentifier(expr)) {
            const name = expr.text;
            if (visited.has(name))
                return;
            visited.add(name);
            const init = topLevelBindings.get(name);
            if (init)
                collectFromObjectLike(init, visited);
            return;
        }
        collectFromObjectLike(expr, visited);
    }
    // 触发点：任何 Object.assign 调用或任何含 spread 的对象字面量
    function visit(node) {
        if (ts.isCallExpression(node)) {
            const callText = node.expression.getText(sourceFile);
            if (callText === 'Object.assign' || callText.endsWith('.assign')) {
                for (const arg of node.arguments) {
                    resolveAndCollect(arg, new Set());
                }
            }
        }
        else if (ts.isObjectLiteralExpression(node)) {
            for (const prop of node.properties) {
                if (ts.isSpreadAssignment(prop)) {
                    resolveAndCollect(prop.expression, new Set());
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return hits;
}
exports.collectSpreadKeys = collectSpreadKeys;
/* -------------------------------------------------------------------------- */
/* 阶段4: 去重与优先级排序(纯函数,便于单测)                                   */
/* -------------------------------------------------------------------------- */
const SOURCE_PRIORITY = {
    'class-member': 1,
    'object-literal': 2,
    'return-destructure': 3,
    setData: 4,
    assignment: 5,
    spread: 6,
};
/**
 * 按 (start,end) 去重,保留优先级最高者;结果按优先级升序、start 升序排序。
 */
function rankAndDedupe(hits) {
    const byKey = new Map();
    for (const h of hits) {
        const key = `${h.start}:${h.end}`;
        const prev = byKey.get(key);
        if (!prev || SOURCE_PRIORITY[h.source] < SOURCE_PRIORITY[prev.source]) {
            byKey.set(key, h);
        }
    }
    return Array.from(byKey.values()).sort((a, b) => {
        const d = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
        return d !== 0 ? d : a.start - b.start;
    });
}
exports.rankAndDedupe = rankAndDedupe;
function collectAllIdentifiers(sourceFile, type, matchesProp) {
    const all = [
        ...collectObjectLiteralKeys(sourceFile, type, matchesProp),
        ...collectClassMembers(sourceFile, type, matchesProp),
        ...collectSetDataKeys(sourceFile, matchesProp),
        ...collectReturnObjectKeys(sourceFile, type, matchesProp),
        ...collectAssignmentKeys(sourceFile, type, matchesProp),
        ...collectSpreadKeys(sourceFile, type, matchesProp),
    ];
    return rankAndDedupe(all);
}
exports.collectAllIdentifiers = collectAllIdentifiers;
//# sourceMappingURL=identifierCollector.js.map