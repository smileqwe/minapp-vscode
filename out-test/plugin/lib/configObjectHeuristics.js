"use strict";
/**
 * Config Object Heuristics
 *
 * 纯函数实现，不依赖 vscode 模块。
 *
 * 目标：当 ScriptFile 无法通过硬编码入口名（Page/Component/definePage/defineComponent）
 * 识别配置对象时（如用户自定义的 MyPage/createPage 封装），
 * 启发式扫描文件中所有 CallExpression 的对象字面量参数，
 * 按其包含的已知 key（lifecycle/data/methods/properties）评分，
 * 得分超过阈值的视为"小程序配置对象"。
 *
 * 所有函数只返回字符偏移（start/end），由上层包装为 vscode.Location。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSectionObject = exports.detectConfigObjects = exports.scoreConfigObject = exports.DEFAULT_HEURISTIC = void 0;
const ts = require("typescript");
exports.DEFAULT_HEURISTIC = {
    dataKeys: ['data', 'state', 'initialData', 'initialState'],
    methodKeys: ['methods', 'actions'],
    propKeys: ['properties', 'props', 'externalClasses'],
    computedKeys: ['computed'],
    lifecycleKeys: [
        'onLoad',
        'onShow',
        'onReady',
        'onHide',
        'onUnload',
        'onPullDownRefresh',
        'onReachBottom',
        'onShareAppMessage',
        'onPageScroll',
        'onResize',
        'onTabItemTap',
        'onLaunch',
        'onError',
        'onPageNotFound',
        'onThemeChange',
        'created',
        'attached',
        'ready',
        'moved',
        'detached',
        'mounted',
        'beforeMount',
        'destroyed',
        'beforeDestroy',
    ],
    weights: {
        data: 3,
        methods: 2,
        properties: 3,
        computed: 2,
        lifecycle: 5,
    },
    threshold: 5,
};
/** 获取属性名（identifier 或 string literal） */
function getPropName(prop) {
    if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
        if (ts.isIdentifier(prop.name))
            return prop.name.text;
        if (ts.isStringLiteral(prop.name))
            return prop.name.text;
    }
    if (ts.isShorthandPropertyAssignment(prop)) {
        return prop.name.text;
    }
    return undefined;
}
/**
 * 对一个对象字面量评分，判断它是否像"小程序配置对象"
 */
function scoreConfigObject(obj, _sourceFile, heuristic = exports.DEFAULT_HEURISTIC) {
    let score = 0;
    for (const prop of obj.properties) {
        const name = getPropName(prop);
        if (!name)
            continue;
        if (heuristic.lifecycleKeys.includes(name)) {
            score += heuristic.weights.lifecycle;
        }
        if (heuristic.dataKeys.includes(name)) {
            score += heuristic.weights.data;
        }
        if (heuristic.methodKeys.includes(name)) {
            score += heuristic.weights.methods;
        }
        if (heuristic.propKeys.includes(name)) {
            score += heuristic.weights.properties;
        }
        if (heuristic.computedKeys.includes(name)) {
            score += heuristic.weights.computed;
        }
    }
    return score;
}
exports.scoreConfigObject = scoreConfigObject;
/**
 * 扫描 SourceFile 中所有 CallExpression，对对象字面量参数评分，
 * 返回得分超过阈值的候选，按得分降序排列。
 */
function detectConfigObjects(sourceFile, heuristic = exports.DEFAULT_HEURISTIC) {
    const candidates = [];
    function visit(node) {
        if (ts.isCallExpression(node)) {
            const funcName = node.expression.getText(sourceFile);
            // 对每个对象字面量参数评分
            node.arguments.forEach((arg, argIndex) => {
                if (ts.isObjectLiteralExpression(arg)) {
                    const score = scoreConfigObject(arg, sourceFile, heuristic);
                    if (score >= heuristic.threshold) {
                        candidates.push({
                            call: node,
                            config: arg,
                            score,
                            functionName: funcName,
                            argumentIndex: argIndex,
                        });
                    }
                }
            });
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    // 按得分降序排列，得分相同则按出现顺序（start 升序）
    return candidates.sort((a, b) => {
        const d = b.score - a.score;
        if (d !== 0)
            return d;
        return a.config.getStart(sourceFile) - b.config.getStart(sourceFile);
    });
}
exports.detectConfigObjects = detectConfigObjects;
/**
 * 从探测到的配置对象中提取指定 section 的对象字面量。
 *
 * @param config 配置对象字面量
 * @param sectionNames 可能的 section 名列表（如 ['data', 'state']）
 * @param sourceFile
 * @returns 第一个匹配的 section 的对象字面量，或 undefined
 */
function extractSectionObject(config, sectionNames, _sourceFile) {
    for (const sectionName of sectionNames) {
        const prop = config.properties.find(p => {
            const name = getPropName(p);
            return name === sectionName;
        });
        if (prop && ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
            return prop.initializer;
        }
    }
    return undefined;
}
exports.extractSectionObject = extractSectionObject;
//# sourceMappingURL=configObjectHeuristics.js.map