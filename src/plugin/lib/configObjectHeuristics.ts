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

import * as ts from 'typescript'

/** 启发式配置：已知的 section key 和评分权重 */
export interface HeuristicConfig {
  /** data 相关 key */
  dataKeys: string[]
  /** methods 相关 key */
  methodKeys: string[]
  /** properties 相关 key */
  propKeys: string[]
  /** computed 相关 key */
  computedKeys: string[]
  /** 生命周期 key（最强信号） */
  lifecycleKeys: string[]
  /** 各类 key 的评分权重 */
  weights: {
    data: number
    methods: number
    properties: number
    computed: number
    lifecycle: number
  }
  /** 得分超过此阈值才认为是配置对象 */
  threshold: number
}

export const DEFAULT_HEURISTIC: HeuristicConfig = {
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
}

/** 探测到的配置对象候选 */
export interface DetectedConfigObject {
  /** 触发调用的 CallExpression */
  call: ts.CallExpression
  /** 配置对象字面量 */
  config: ts.ObjectLiteralExpression
  /** 得分 */
  score: number
  /** 调用函数名 */
  functionName: string
  /** 配置对象是第几个参数 */
  argumentIndex: number
}

/** 获取属性名（identifier 或 string literal） */
function getPropName(prop: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
    if (ts.isIdentifier(prop.name)) return prop.name.text
    if (ts.isStringLiteral(prop.name)) return prop.name.text
  }
  if (ts.isShorthandPropertyAssignment(prop)) {
    return prop.name.text
  }
  return undefined
}

/**
 * 对一个对象字面量评分，判断它是否像"小程序配置对象"
 */
export function scoreConfigObject(
  obj: ts.ObjectLiteralExpression,
  _sourceFile: ts.SourceFile,
  heuristic: HeuristicConfig = DEFAULT_HEURISTIC
): number {
  let score = 0
  for (const prop of obj.properties) {
    const name = getPropName(prop)
    if (!name) continue

    if (heuristic.lifecycleKeys.includes(name)) {
      score += heuristic.weights.lifecycle
    }
    if (heuristic.dataKeys.includes(name)) {
      score += heuristic.weights.data
    }
    if (heuristic.methodKeys.includes(name)) {
      score += heuristic.weights.methods
    }
    if (heuristic.propKeys.includes(name)) {
      score += heuristic.weights.properties
    }
    if (heuristic.computedKeys.includes(name)) {
      score += heuristic.weights.computed
    }
  }
  return score
}

/**
 * 扫描 SourceFile 中所有 CallExpression，对对象字面量参数评分，
 * 返回得分超过阈值的候选，按得分降序排列。
 */
export function detectConfigObjects(
  sourceFile: ts.SourceFile,
  heuristic: HeuristicConfig = DEFAULT_HEURISTIC
): DetectedConfigObject[] {
  const candidates: DetectedConfigObject[] = []

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const funcName = node.expression.getText(sourceFile)
      // 对每个对象字面量参数评分
      node.arguments.forEach((arg, argIndex) => {
        if (ts.isObjectLiteralExpression(arg)) {
          const score = scoreConfigObject(arg, sourceFile, heuristic)
          if (score >= heuristic.threshold) {
            candidates.push({
              call: node,
              config: arg,
              score,
              functionName: funcName,
              argumentIndex: argIndex,
            })
          }
        }
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  // 按得分降序排列，得分相同则按出现顺序（start 升序）
  return candidates.sort((a, b) => {
    const d = b.score - a.score
    if (d !== 0) return d
    return a.config.getStart(sourceFile) - b.config.getStart(sourceFile)
  })
}

/**
 * 从探测到的配置对象中提取指定 section 的对象字面量。
 *
 * @param config 配置对象字面量
 * @param sectionNames 可能的 section 名列表（如 ['data', 'state']）
 * @param sourceFile
 * @returns 第一个匹配的 section 的对象字面量，或 undefined
 */
export function extractSectionObject(
  config: ts.ObjectLiteralExpression,
  sectionNames: string[],
  _sourceFile: ts.SourceFile
): ts.ObjectLiteralExpression | undefined {
  for (const sectionName of sectionNames) {
    const prop = config.properties.find(p => {
      const name = getPropName(p)
      return name === sectionName
    })
    if (prop && ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
      return prop.initializer
    }
  }
  return undefined
}
