# 三方框架劫持场景的 ScriptFile 解析增强 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `getProp()` 在遇到 `MyPage`、`createPage`、`defineApp` 等任意三方框架封装时，能够自动识别配置对象并精确提取 `data`/`methods`/`properties` 中的定义，不再依赖硬编码的入口名白名单。

**Architecture:** 在现有 `createSourceFile`（纯 AST）解析路径之上，新增三层渐进式解析：Layer 0 类型驱动（LanguageService + TypeChecker，利用 `.d.ts` 类型包自动识别）、Layer 1 启发式探测（零配置，按生命周期/data/methods key 评分自动发现配置对象）、Layer 2 置信度标签（给兜底结果打标，避免误导）。所有新增模块遵循现有 `identifierCollector.ts` / `wxmlForScope.ts` 的纯函数模式，不依赖 `vscode`，可单测。

**Tech Stack:** TypeScript（运行时 AST + 类型解析）、mocha（单元测试）、现有 `identifierCollector` / `ScriptFile` 架构

---

## 总体架构

```
getProp(wxmlFile, type, prop)
    │
    ├─ Layer 0: 类型驱动解析 (typeDrivenResolver.ts)
    │    需要 tsconfig.json + 框架 .d.ts
    │    用 LanguageService 拿到函数签名 → 自动识别 sections
    │    精度最高，零用户配置
    │
    ├─ Layer 1: 启发式探测 (configObjectHeuristics.ts)
    │    纯 AST，零配置
    │    扫描所有 CallExpression，按 lifecycle/data/methods key 评分
    │    取 top-1 候选作为配置对象
    │
    └─ Layer 2: 置信度标签 + 现有 collectAllIdentifiers 兜底
         给兜底结果打 low 置信度
```

**设计决策：**

1. **LanguageService 不可用时必须优雅降级** —— 纯 JS 项目、无 tsconfig 的项目、或 LS 初始化失败时，无缝回退到 Layer 1/2。
2. **LanguageService 全局单例 + 懒加载** —— 首次调用才创建，带 30s TTL 缓存避免重复初始化（LS 首次启动 2-5 秒）。
3. **不修改 `identifierCollector.ts`** —— 它已经是稳定的兜底模块，新逻辑独立成新文件。
4. **所有新模块纯函数、不依赖 vscode** —— 遵循现有可单测模式，加入 `tsconfig.test.json` 的 `include`。
5. **`getProp()` 是唯一集成点** —— 所有 provider（HoverProvider、PropDefinitionProvider、AutoCompletion）都通过它获取结果，只改这一个入口的内部实现。

---

## Task 1: 启发式配置对象探测器 — configObjectHeuristics.ts

**优先做 Layer 1 的原因：** 它零配置、不依赖 LanguageService、纯函数可单测、能覆盖 80% 的三方框架场景。Layer 0 依赖 LS 基础设施，先做 Layer 1 可以快速验证核心思路。

**Files:**
- Create: `src/plugin/lib/configObjectHeuristics.ts`
- Create: `src/test/unit/configObjectHeuristics.test.ts`
- Create: `src/test/fixtures/my-page-wrap.js`
- Modify: `tsconfig.test.json` (加入新文件到 include)

**Step 1: 创建 fixture 文件**

创建 `src/test/fixtures/my-page-wrap.js`:

```javascript
// Fixture: 自定义 MyPage 封装（无类型包）
// Covers: 启发式探测能识别 MyPage 的配置对象

function MyPage(options) {
  return Page(options)
}

MyPage({
  data: {
    userName: 'a',
    age: 18,
  },
  methods: {
    onTap() {
      console.log('tap')
    },
    onScroll() {},
  },
  onLoad() {
    this.setData({ userName: 'b' })
  },
})

// 干扰项：普通函数调用，不应被识别为配置对象
const config = { debug: true }
setupApp(config)
```

**Step 2: 写失败的单测**

创建 `src/test/unit/configObjectHeuristics.test.ts`:

```typescript
/**
 * configObjectHeuristics 单元测试
 *
 * 不依赖 vscode 模块；直接用 ts.createSourceFile 读取 fixture 文件后调用探测器。
 *
 * 运行方式：
 *   npm run test:unit
 */

import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'

import {
  scoreConfigObject,
  detectConfigObjects,
  HeuristicConfig,
  DEFAULT_HEURISTIC,
} from '../../plugin/lib/configObjectHeuristics'

const FIXTURE_DIR = path.resolve(__dirname, '../../../src/test/fixtures')

function loadFixture(name: string): { source: ts.SourceFile; text: string } {
  const full = path.join(FIXTURE_DIR, name)
  const text = fs.readFileSync(full, 'utf8')
  const kind = name.endsWith('.ts')
    ? ts.ScriptKind.TS
    : name.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.JS
  const source = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, kind)
  return { source, text }
}

describe('configObjectHeuristics', () => {
  describe('scoreConfigObject (H1)', () => {
    it('H1.1: 含 data + methods + onLoad 的对象得分应超阈值', () => {
      const { source } = loadFixture('my-page-wrap.js')
      // 找到 MyPage({...}) 里的对象字面量
      let target: ts.ObjectLiteralExpression | undefined
      function visit(node: ts.Node) {
        if (ts.isObjectLiteralExpression(node) && !target) {
          // 检查是否包含 data 属性
          const hasData = node.properties.some(
            p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'data'
          )
          if (hasData) target = node
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      assert.ok(target, '应找到配置对象')
      const score = scoreConfigObject(target, source)
      assert.ok(score >= DEFAULT_HEURISTIC.threshold, `得分 ${score} 应 >= 阈值 ${DEFAULT_HEURISTIC.threshold}`)
    })

    it('H1.2: 只有 { debug: true } 的对象得分应低于阈值', () => {
      const text = 'const config = { debug: true }'
      const sf = ts.createSourceFile('x.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      const obj = (sf.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0].initializer as ts.ObjectLiteralExpression
      const score = scoreConfigObject(obj, sf)
      assert.ok(score < DEFAULT_HEURISTIC.threshold, `得分 ${score} 应 < 阈值`)
    })

    it('H1.3: 只有 lifecycle（onLoad）的对象得分应超阈值', () => {
      const text = 'Page({ onLoad() {} })'
      const sf = ts.createSourceFile('x.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      const call = sf.statements[0] as ts.ExpressionStatement
      const arg = (call.expression as ts.CallExpression).arguments[0] as ts.ObjectLiteralExpression
      const score = scoreConfigObject(arg, sf)
      assert.ok(score >= DEFAULT_HEURISTIC.threshold, '仅 lifecycle 也应达标')
    })
  })

  describe('detectConfigObjects (H2)', () => {
    it('H2.1: my-page-wrap.js 中 MyPage 的配置对象被探测到且得分最高', () => {
      const { source } = loadFixture('my-page-wrap.js')
      const candidates = detectConfigObjects(source)
      assert.ok(candidates.length >= 1, '至少探测到 1 个候选')
      // top-1 应该是 MyPage 的配置对象
      const top = candidates[0]
      const topText = top.config.getText(source)
      assert.ok(topText.includes('userName'), 'top-1 应包含 userName')
      assert.ok(topText.includes('onLoad'), 'top-1 应包含 onLoad')
    })

    it('H2.2: native-page.js 中 Page 的配置对象也能被探测到', () => {
      const { source } = loadFixture('native-page.js')
      const candidates = detectConfigObjects(source)
      assert.ok(candidates.length >= 1)
      const top = candidates[0]
      assert.ok(top.config.getText(source).includes('foo'), '应包含 data.foo')
    })

    it('H2.3: 没有配置对象的文件返回空数组', () => {
      const text = 'const x = 1\nconst y = 2'
      const sf = ts.createSourceFile('x.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      const candidates = detectConfigObjects(sf)
      assert.strictEqual(candidates.length, 0)
    })

    it('H2.4: 候选按得分降序排列', () => {
      const { source } = loadFixture('my-page-wrap.js')
      const candidates = detectConfigObjects(source)
      for (let i = 1; i < candidates.length; i++) {
        assert.ok(
          candidates[i - 1].score >= candidates[i].score,
          `候选 ${i - 1} 得分 ${candidates[i - 1].score} 应 >= 候选 ${i} 得分 ${candidates[i].score}`
        )
      }
    })
  })
})
```

**Step 3: 运行测试确认失败**

Run: `npx tsc -p tsconfig.test.json && npx mocha "out-test/test/unit/configObjectHeuristics.test.js"`

Expected: FAIL — `Cannot find module '../../plugin/lib/configObjectHeuristics'`

**Step 4: 实现 configObjectHeuristics.ts**

创建 `src/plugin/lib/configObjectHeuristics.ts`:

```typescript
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
    'onUnload',
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
```

**Step 5: 更新 tsconfig.test.json**

修改 `tsconfig.test.json`，在 `include` 中加入新文件:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "out-test",
    "rootDir": "src",
    "sourceMap": true,
    "noUnusedLocals": false,
    "types": ["mocha", "node"]
  },
  "include": [
    "src/plugin/lib/identifierCollector.ts",
    "src/plugin/lib/wxmlForScope.ts",
    "src/plugin/lib/configObjectHeuristics.ts",
    "src/test/unit/**/*"
  ]
}
```

**Step 6: 运行测试确认通过**

Run: `npx tsc -p tsconfig.test.json && npx mocha "out-test/test/unit/configObjectHeuristics.test.js"`

Expected: PASS — 所有 H1.x 和 H2.x 测试通过

**Step 7: 运行全量单测确保无回归**

Run: `npm run test:unit`

Expected: PASS — 所有现有测试 + 新测试全部通过

**Step 8: Commit**

```bash
git add src/plugin/lib/configObjectHeuristics.ts src/test/unit/configObjectHeuristics.test.ts src/test/fixtures/my-page-wrap.js tsconfig.test.json
git commit -m "feat: add configObjectHeuristics for detecting third-party framework wrappers"
```

---

## Task 2: 置信度标签 — CollectedHit 增强

**Files:**
- Modify: `src/plugin/lib/identifierCollector.ts` (给 CollectedHit 加 confidence 字段)
- Modify: `src/test/unit/identifierCollector.test.ts` (补充 confidence 断言)

**Step 1: 给 CollectedHit 接口加 confidence 字段**

在 `src/plugin/lib/identifierCollector.ts` 中修改 `CollectedHit` 接口:

```typescript
export type Confidence = 'high' | 'medium' | 'low'

export interface CollectedHit {
  start: number
  end: number
  name: string
  detail: string
  source: CollectSource
  /** 置信度：high=入口精确命中, medium=启发式探测, low=全文件同名兜底 */
  confidence: Confidence
}
```

同时修改 `makeHit` 函数，默认设为 `low`（因为 identifierCollector 是兜底层）:

```typescript
function makeHit(
  sourceFile: ts.SourceFile,
  anchorNode: ts.Node,
  name: string,
  detail: string,
  source: CollectSource
): CollectedHit {
  const start = anchorNode.getStart(sourceFile)
  const textAtStart = sourceFile.text.substring(start, start + name.length)
  const end = textAtStart === name ? start + name.length : anchorNode.getEnd()
  return { start, end, name, detail, source, confidence: 'low' }
}
```

**Step 2: 运行现有测试确认仍通过**

Run: `npm run test:unit`

Expected: PASS — 现有测试不检查 confidence 字段，新增可选字段不破坏

**Step 3: 补充 confidence 断言**

在 `src/test/unit/identifierCollector.test.ts` 的 `describe('identifierCollector — collectAllIdentifiers (T1)')` 中新增:

```typescript
it('T1.7: 兜底收集的 hit 置信度应为 low', () => {
  const { source } = loadFixture('native-page.js')
  const hits = collectAllIdentifiers(source, 'prop', byName('foo'))
  assert.ok(hits.length >= 1)
  assert.strictEqual(hits[0].confidence, 'low')
})
```

**Step 4: 运行测试确认通过**

Run: `npx tsc -p tsconfig.test.json && npx mocha "out-test/test/unit/identifierCollector.test.js"`

Expected: PASS

**Step 5: Commit**

```bash
git add src/plugin/lib/identifierCollector.ts src/test/unit/identifierCollector.test.ts
git commit -m "feat: add confidence field to CollectedHit for traceability"
```

---

## Task 3: 启发式探测集成到 ScriptFile.ts

**Files:**
- Modify: `src/plugin/lib/ScriptFile.ts` (在 visit() 中加入启发式探测分支)

**Step 1: 在 ScriptFile.ts 中导入启发式模块**

在 `src/plugin/lib/ScriptFile.ts` 顶部 import 区域加入:

```typescript
import {
  detectConfigObjects,
  extractSectionObject,
  DetectedConfigObject,
  DEFAULT_HEURISTIC,
} from './configObjectHeuristics'
```

**Step 2: 在 parseScriptFile 中新增启发式探测函数**

在 `parseScriptFile` 函数内部（`visit` 函数定义之前）加入:

```typescript
/**
 * 用启发式探测处理非白名单入口的配置对象
 * 返回是否找到目标定义
 */
function visitWithHeuristic(): boolean {
  const candidates = detectConfigObjects(sourceFile, DEFAULT_HEURISTIC)
  if (candidates.length === 0) return false

  // 取得分最高的候选
  const best = candidates[0]
  console.log(`[ScriptFile] 启发式探测命中: ${best.functionName}(得分=${best.score})`)

  const dataKeys = DEFAULT_HEURISTIC.dataKeys
  const methodKeys = DEFAULT_HEURISTIC.methodKeys
  const propKeys = DEFAULT_HEURISTIC.propKeys

  let found = false

  if (type === 'prop') {
    // 依次尝试 data / properties section
    const dataObj = extractSectionObject(best.config, dataKeys, sourceFile)
    if (dataObj) {
      visitObjectProperties(dataObj)
      found = locs.length > 0
    }
    if (!found) {
      const propObj = extractSectionObject(best.config, propKeys, sourceFile)
      if (propObj) {
        visitObjectProperties(propObj)
        found = locs.length > 0
      }
    }
  } else if (type === 'method') {
    const methodObj = extractSectionObject(best.config, methodKeys, sourceFile)
    if (methodObj) {
      visitObjectProperties(methodObj)
      found = locs.length > 0
    }
    // 原生 Page 风格：方法直接定义在顶层
    if (!found) {
      best.config.properties.forEach(prop => {
        if (ts.isMethodDeclaration(prop)) {
          const name = getPropertyName(prop)
          if (name && matchesProp(name)) {
            addLocation(prop, name, `${name}()`)
            found = true
          }
        } else if (ts.isPropertyAssignment(prop)) {
          const name = getPropertyName(prop)
          if (name && matchesProp(name) && isFunctionLikeExpression(prop.initializer)) {
            addLocation(prop, name, `${name}()`)
            found = true
          }
        }
      })
    }
  }

  return found
}
```

**Step 3: 修改兜底逻辑，在 collectAllIdentifiers 之前插入启发式探测**

在 `parseScriptFile` 函数末尾（`visit(sourceFile)` 之后），修改现有的兜底代码块:

找到现有代码:
```typescript
    // ========== 阶段3+4: 通用兜底 + 去重优先级 ==========
    // 特殊入口(Page/Component/definePage/defineComponent)已命中则不走兜底,避免混入顶层同名
    if (!foundInSpecialContext && locs.length === 0 && (type === 'prop' || type === 'method')) {
      try {
        const allHits = collectAllIdentifiers(sourceFile, type, matchesProp)
        const merged = mergeAndRank(allHits, file, sourceFile)
        locs.push(...merged)
```

替换为:
```typescript
    // ========== 阶段3: 启发式探测兜底 ==========
    // 特殊入口(Page/Component/definePage/defineComponent)已命中则不走兜底,避免混入顶层同名
    if (!foundInSpecialContext && locs.length === 0 && (type === 'prop' || type === 'method')) {
      // 先尝试启发式探测（识别三方框架的配置对象）
      const heuristicFound = visitWithHeuristic()
      if (heuristicFound) {
        console.log('[ScriptFile] 启发式探测命中，跳过通用兜底')
      }
    }

    // ========== 阶段4: 通用兜底 + 去重优先级 ==========
    // 启发式和特殊入口都没命中才走全文件同名搜索
    if (!foundInSpecialContext && locs.length === 0 && (type === 'prop' || type === 'method')) {
      try {
        const allHits = collectAllIdentifiers(sourceFile, type, matchesProp)
        const merged = mergeAndRank(allHits, file, sourceFile)
        locs.push(...merged)
```

**Step 4: 手动验证 — 编译通过**

Run: `npx tsc -p tsconfig.json --noEmit`

Expected: 无编译错误

**Step 5: 运行全量单测确认无回归**

Run: `npm run test:unit`

Expected: PASS — 现有测试全部通过（启发式是新增分支，不影响白名单入口命中的路径）

**Step 6: Commit**

```bash
git add src/plugin/lib/ScriptFile.ts
git commit -m "feat: integrate heuristic detection into ScriptFile as Layer 1 fallback"
```

---

## Task 4: 启发式探测集成测试

**Files:**
- Create: `src/test/fixtures/my-page-no-standard-keys.js`
- Create: `src/test/integration/scriptFileHeuristic.test.ts` (纯函数层验证，不走 vscode)

> **注意：** `ScriptFile.ts` 依赖 `vscode` 模块（`Location`, `Uri`, `Position`, `window`），无法直接单测。
> 这里采用"间接验证"策略：提取 `visitWithHeuristic` 的核心逻辑为纯函数，或直接在 fixture 层验证启发式探测的输入输出。

**Step 1: 创建非标准 key 名的 fixture**

创建 `src/test/fixtures/my-page-no-standard-keys.js`:

```javascript
// Fixture: MyPage 使用非标准 section 名（state/actions）
// 启发式探测应能通过 onLoad 生命周期识别这是配置对象

function MyPage(options) {
  return Page(options)
}

MyPage({
  state: {
    count: 0,
    list: [],
  },
  actions: {
    increment() {
      this.setData({ count: this.data.count + 1 })
    },
  },
  onLoad() {
    console.log('page loaded')
  },
})
```

**Step 2: 在 configObjectHeuristics.test.ts 中补充非标准 key 场景**

在 `src/test/unit/configObjectHeuristics.test.ts` 末尾追加:

```typescript
describe('configObjectHeuristics — 非标准 section 名 (H3)', () => {
  it('H3.1: MyPage({ state, actions, onLoad }) 能被探测到', () => {
    const { source } = loadFixture('my-page-no-standard-keys.js')
    const candidates = detectConfigObjects(source)
    assert.ok(candidates.length >= 1, '应探测到配置对象')
    const top = candidates[0]
    // 得分应主要来自 onLoad (lifecycle=5) + state(data=3) + actions(methods=2) = 10
    assert.ok(top.score >= DEFAULT_HEURISTIC.threshold, `得分 ${top.score} 应 >= 阈值`)
  })

  it('H3.2: 从探测到的配置对象中提取 state section', () => {
    const { source } = loadFixture('my-page-no-standard-keys.js')
    const candidates = detectConfigObjects(source)
    const top = candidates[0]
    const stateObj = extractSectionObject(top.config, ['state', 'data'], source)
    assert.ok(stateObj, '应提取到 state section')
    assert.ok(stateObj!.getText(source).includes('count'), 'state 应包含 count')
  })

  it('H3.3: 从探测到的配置对象中提取 actions section', () => {
    const { source } = loadFixture('my-page-no-standard-keys.js')
    const candidates = detectConfigObjects(source)
    const top = candidates[0]
    const actionsObj = extractSectionObject(top.config, ['actions', 'methods'], source)
    assert.ok(actionsObj, '应提取到 actions section')
    assert.ok(actionsObj!.getText(source).includes('increment'), 'actions 应包含 increment')
  })
})
```

**Step 3: 运行测试确认通过**

Run: `npx tsc -p tsconfig.test.json && npx mocha "out-test/test/unit/configObjectHeuristics.test.js"`

Expected: PASS — H3.x 全部通过

**Step 4: 运行全量单测**

Run: `npm run test:unit`

Expected: PASS

**Step 5: Commit**

```bash
git add src/test/fixtures/my-page-no-standard-keys.js src/test/unit/configObjectHeuristics.test.ts
git commit -m "test: add heuristic detection tests for non-standard section names"
```

---

## Task 5: 类型驱动解析器 — typeDrivenResolver.ts (核心)

**Files:**
- Create: `src/plugin/lib/typeDrivenResolver.ts`
- Create: `src/test/fixtures/my-page-typed.ts`
- Create: `src/test/fixtures/my-framework.d.ts`
- Create: `src/test/unit/typeDrivenResolver.test.ts`

> **设计说明：** `typeDrivenResolver.ts` 中 LanguageService 创建部分依赖 `fs` 和 `ts.sys`，
> 但核心的 `resolveCallShape` 和 `extractKeysFromSection` 接收 `TypeChecker` 参数，是纯函数。
> 单测通过手动构造 `ts.createProgram` + `getTypeChecker` 来测试，不依赖 vscode。

**Step 1: 创建模拟框架的类型定义 fixture**

创建 `src/test/fixtures/my-framework.d.ts`:

```typescript
// 模拟三方框架的类型定义
// 测试 typeDrivenResolver 能从此类型签名中提取 section 结构

declare function MyPage<TData, TMethods>(
  options: {
    data: TData
    methods: TMethods
    onLoad?: (query: Record<string, string>) => void
    onShow?: () => void
  }
): void

declare function MyComponent<TData, TProps, TMethods>(
  options: {
    data?: TData
    properties?: TProps
    methods?: TMethods
    attached?: () => void
    detached?: () => void
  }
): void
```

**Step 2: 创建使用该框架的 fixture**

创建 `src/test/fixtures/my-page-typed.ts`:

```typescript
// Fixture: 使用带类型包的 MyPage
// typeDrivenResolver 应能从 MyPage 的类型签名自动识别 data/methods section

import { MyPage } from './my-framework'

MyPage({
  data: {
    userName: 'a',
    age: 18,
    isActive: true,
  },
  methods: {
    onTap() {
      console.log('tap')
    },
    onScroll() {},
  },
  onLoad() {
    this.setData({ userName: 'b' })
  },
})
```

**Step 3: 写失败的单测**

创建 `src/test/unit/typeDrivenResolver.test.ts`:

```typescript
/**
 * typeDrivenResolver 单元测试
 *
 * 不依赖 vscode 模块。
 * 通过 ts.createProgram 构造带类型信息的 Program，测试 resolveCallShape 和 extractKeysFromSection。
 *
 * 运行方式：
 *   npm run test:unit
 */

import * as assert from 'assert'
import * as path from 'path'
import * as ts from 'typescript'

import {
  resolveCallShape,
  extractKeysFromSection,
  ResolvedWrapperShape,
} from '../../plugin/lib/typeDrivenResolver'

const FIXTURE_DIR = path.resolve(__dirname, '../../../src/test/fixtures')

/**
 * 构造一个带类型信息的 Program，用于测试 TypeChecker 相关逻辑
 */
function createProgramWithTypes(fileNames: string[]): ts.Program {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  }
  return ts.createProgram(fileNames, options)
}

/** 在 SourceFile 中找到第一个匹配函数名的 CallExpression */
function findCallExpr(
  sourceFile: ts.SourceFile,
  funcName: string
): ts.CallExpression | undefined {
  let result: ts.CallExpression | undefined
  function visit(node: ts.Node) {
    if (!result && ts.isCallExpression(node)) {
      if (node.expression.getText(sourceFile) === funcName) {
        result = node
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return result
}

describe('typeDrivenResolver', () => {
  let program: ts.Program
  let checker: ts.TypeChecker
  let sourceFile: ts.SourceFile

  before(() => {
    const myPageTyped = path.join(FIXTURE_DIR, 'my-page-typed.ts')
    const dtsFile = path.join(FIXTURE_DIR, 'my-framework.d.ts')
    program = createProgramWithTypes([myPageTyped, dtsFile])
    checker = program.getTypeChecker()
    sourceFile = program.getSourceFile(myPageTyped)!
    assert.ok(sourceFile, '应成功加载 my-page-typed.ts')
  })

  describe('resolveCallShape (T0)', () => {
    it('T0.1: MyPage 调用的类型签名被解析', () => {
      const callExpr = findCallExpr(sourceFile, 'MyPage')
      assert.ok(callExpr, '应找到 MyPage() 调用')

      const shape = resolveCallShape(callExpr!, checker, sourceFile)
      assert.ok(shape, '应解析出 shape')
      assert.strictEqual(shape!.functionName, 'MyPage')
      assert.strictEqual(shape!.argumentIndex, 0)
    })

    it('T0.2: shape.sections 包含 data 和 methods', () => {
      const callExpr = findCallExpr(sourceFile, 'MyPage')
      const shape = resolveCallShape(callExpr!, checker, sourceFile)
      assert.ok(shape)
      assert.ok(shape!.sections.data?.includes('data'), 'sections.data 应包含 "data"')
      assert.ok(shape!.sections.methods?.includes('methods'), 'sections.methods 应包含 "methods"')
    })

    it('T0.3: shape.sourceModule 为导入路径', () => {
      const callExpr = findCallExpr(sourceFile, 'MyPage')
      const shape = resolveCallShape(callExpr!, checker, sourceFile)
      assert.ok(shape)
      // import { MyPage } from './my-framework'
      assert.ok(shape!.sourceModule?.includes('my-framework'), `sourceModule=${shape!.sourceModule}`)
    })
  })

  describe('extractKeysFromSection (T0b)', () => {
    it('T0b.1: 从 MyPage 配置对象中提取 data section 的 key', () => {
      const callExpr = findCallExpr(sourceFile, 'MyPage')
      assert.ok(callExpr)
      const configArg = callExpr!.arguments[0]
      assert.ok(ts.isObjectLiteralExpression(configArg))

      const keys = extractKeysFromSection(configArg as ts.ObjectLiteralExpression, 'data', checker)
      assert.ok(keys.length >= 3, `应提取至少 3 个 key，实际 ${keys.length}`)
      const names = keys.map(k => k.name)
      assert.ok(names.includes('userName'), `应包含 userName，实际 ${names}`)
      assert.ok(names.includes('age'), `应包含 age，实际 ${names}`)
      assert.ok(names.includes('isActive'), `应包含 isActive，实际 ${names}`)
    })

    it('T0b.2: 从 MyPage 配置对象中提取 methods section 的 key', () => {
      const callExpr = findCallExpr(sourceFile, 'MyPage')
      const configArg = callExpr!.arguments[0]
      const keys = extractKeysFromSection(configArg as ts.ObjectLiteralExpression, 'methods', checker)
      assert.ok(keys.length >= 2, `应提取至少 2 个 method，实际 ${keys.length}`)
      const names = keys.map(k => k.name)
      assert.ok(names.includes('onTap'), `应包含 onTap，实际 ${names}`)
      assert.ok(names.includes('onScroll'), `应包含 onScroll，实际 ${names}`)
    })

    it('T0b.3: data section 的 key 带有类型信息', () => {
      const callExpr = findCallExpr(sourceFile, 'MyPage')
      const configArg = callExpr!.arguments[0]
      const keys = extractKeysFromSection(configArg as ts.ObjectLiteralExpression, 'data', checker)
      const userNameKey = keys.find(k => k.name === 'userName')
      assert.ok(userNameKey, '应找到 userName')
      assert.ok(userNameKey!.typeInfo, '应有 typeInfo')
      // userName: 'a' → 类型应为 string
      assert.ok(
        userNameKey!.typeInfo!.includes('string'),
        `userName 类型应包含 string，实际 ${userNameKey!.typeInfo}`
      )
    })

    it('T0b.4: 不存在的 section 返回空数组', () => {
      const callExpr = findCallExpr(sourceFile, 'MyPage')
      const configArg = callExpr!.arguments[0]
      const keys = extractKeysFromSection(configArg as ts.ObjectLiteralExpression, 'computed', checker)
      assert.strictEqual(keys.length, 0)
    })
  })
})
```

**Step 4: 运行测试确认失败**

Run: `npx tsc -p tsconfig.test.json && npx mocha "out-test/test/unit/typeDrivenResolver.test.js"`

Expected: FAIL — `Cannot find module '../../plugin/lib/typeDrivenResolver'`

**Step 5: 实现 typeDrivenResolver.ts**

创建 `src/plugin/lib/typeDrivenResolver.ts`:

```typescript
/**
 * Type Driven Resolver
 *
 * 纯函数实现，不依赖 vscode 模块。
 *
 * 目标：当三方框架（如 MyPage、createPage）提供了 TypeScript 类型包时，
 * 利用 TypeScript TypeChecker 从函数签名中自动提取配置对象的结构信息
 * （哪些 key 是 data、哪些是 methods、哪些是 properties），
 * 无需用户手动配置 wrapper 描述器。
 *
 * 核心函数：
 *   - resolveCallShape: 从 CallExpression + TypeChecker 提取 ResolvedWrapperShape
 *   - extractKeysFromSection: 从配置对象字面量中提取指定 section 的所有 key
 *
 * LanguageService 创建在 typeDrivenLanguageService.ts 中（依赖 vscode 上下文），
 * 本文件只接收 TypeChecker 参数，保持可单测。
 */

import * as ts from 'typescript'

/** 解析出的框架封装结构 */
export interface ResolvedWrapperShape {
  /** 调用函数的导入路径（如 'my-framework'），无法确定时为 undefined */
  sourceModule?: string
  /** 调用函数名（如 'MyPage'） */
  functionName: string
  /** 配置对象在参数列表中的位置 */
  argumentIndex: number
  /** 配置对象类型中，各 section 的 key 列表 */
  sections: {
    data?: string[]
    methods?: string[]
    properties?: string[]
    computed?: string[]
    setup?: string[]
  }
}

/** 已知的 section key 映射（用于从类型属性名归类到 section） */
const SECTION_KEY_MAP: Record<string, keyof ResolvedWrapperShape['sections']> = {
  data: 'data',
  state: 'data',
  initialData: 'data',
  initialState: 'data',
  methods: 'methods',
  actions: 'methods',
  properties: 'properties',
  props: 'properties',
  externalClasses: 'properties',
  computed: 'computed',
  setup: 'setup',
}

/** 从属性名归类到 section */
function classifySection(
  propName: string
): keyof ResolvedWrapperShape['sections'] | undefined {
  return SECTION_KEY_MAP[propName]
}

/**
 * 从一个 CallExpression 出发，利用 TypeChecker 解析出配置对象的结构信息。
 *
 * @param callExpr 调用表达式（如 MyPage({...})）
 * @param checker TypeChecker
 * @param sourceFile 源文件
 * @returns 解析出的结构信息，或 undefined（无法解析）
 */
export function resolveCallShape(
  callExpr: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): ResolvedWrapperShape | undefined {
  // 1. 拿到被调用函数的签名
  const signature = checker.getResolvedSignature(callExpr)
  if (!signature) return undefined

  const decl = signature.getDeclaration()
  if (!decl) return undefined

  // 2. 找到第一个对象类型的参数
  let argIndex = 0
  let paramType: ts.Type | undefined
  for (let i = 0; i < decl.parameters.length; i++) {
    const param = decl.parameters[i]
    if (!param) continue
    const pt = checker.getTypeAtLocation(param)
    if (pt && pt.getProperties().length > 0) {
      paramType = pt
      argIndex = i
      break
    }
  }

  if (!paramType) {
    // 尝试从实际传入的参数推导
    const actualArg = callExpr.arguments[0]
    if (actualArg) {
      paramType = checker.getTypeAtLocation(actualArg)
      argIndex = 0
    }
  }

  if (!paramType) return undefined

  // 3. 遍历参数类型的所有属性，按语义分类
  const sections: ResolvedWrapperShape['sections'] = {}
  for (const prop of paramType.getProperties()) {
    const propName = prop.name
    const section = classifySection(propName)
    if (section) {
      if (!sections[section]) sections[section] = []
      sections[section]!.push(propName)
    }
  }

  // 如果没有识别出任何 section，说明这不是配置对象
  const hasAnySection = Object.values(sections).some(arr => arr && arr.length > 0)
  if (!hasAnySection) return undefined

  // 4. 从函数名提取信息
  const funcName = callExpr.expression.getText(sourceFile)

  // 5. 尝试获取导入路径
  let sourceModule: string | undefined
  if (ts.isIdentifier(callExpr.expression)) {
    sourceModule = findImportPath(callExpr.expression.text, sourceFile)
  }

  return {
    functionName: funcName,
    sourceModule,
    argumentIndex: argIndex,
    sections,
  }
}

/**
 * 从用户的配置对象字面量中，提取指定 section 的所有 key。
 *
 * @param configObject 用户传入的配置对象字面量（如 MyPage({ data: {...} }) 中的 {...}）
 * @param sectionName section 名（如 'data'、'methods'）
 * @param checker TypeChecker
 * @returns 提取出的 key 列表（含名称、AST 节点、类型信息）
 */
export interface ExtractedKey {
  name: string
  node: ts.Node
  typeInfo?: string
}

export function extractKeysFromSection(
  configObject: ts.ObjectLiteralExpression,
  sectionName: string,
  checker: ts.TypeChecker
): ExtractedKey[] {
  // 1. 在配置对象中找到指定 section 的属性
  const sectionProp = configObject.properties.find(p => {
    if (ts.isPropertyAssignment(p) && p.name) {
      if (ts.isIdentifier(p.name)) return p.name.text === sectionName
      if (ts.isStringLiteral(p.name)) return p.name.text === sectionName
    }
    return false
  })

  if (!sectionProp || !ts.isPropertyAssignment(sectionProp)) return []
  if (!ts.isObjectLiteralExpression(sectionProp.initializer)) return []

  const results: ExtractedKey[] = []

  // 2. 遍历 section 对象的每个属性
  for (const prop of sectionProp.initializer.properties) {
    let name: string | undefined
    let node: ts.Node | undefined

    if (ts.isPropertyAssignment(prop)) {
      if (ts.isIdentifier(prop.name)) {
        name = prop.name.text
        node = prop.name
      } else if (ts.isStringLiteral(prop.name)) {
        name = prop.name.text
        node = prop.name
      }
      // 提取类型信息
      if (name && prop.initializer) {
        const propType = checker.getTypeAtLocation(prop.initializer)
        const typeInfo = checker.typeToString(propType)
        results.push({ name, node: node!, typeInfo })
      }
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      name = prop.name.text
      node = prop.name
      results.push({ name, node: node! })
    } else if (ts.isMethodDeclaration(prop)) {
      if (ts.isIdentifier(prop.name)) {
        name = prop.name.text
        node = prop.name
        results.push({ name, node: node!, typeInfo: '() => void' })
      }
    }
  }

  return results
}

/**
 * 在 sourceFile 中查找某个标识符的 import 来源模块。
 *
 * @param name 标识符名（如 'MyPage'）
 * @param sourceFile 源文件
 * @returns 模块路径（如 './my-framework'），找不到返回 undefined
 */
export function findImportPath(name: string, sourceFile: ts.SourceFile): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    const moduleSpecifier = stmt.moduleSpecifier
      .getText(sourceFile)
      .replace(/['"]/g, '')

    // import { MyPage } from 'my-framework'
    if (
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const el of stmt.importClause.namedBindings.elements) {
        if (el.name.text === name) return moduleSpecifier
        // import { MyPage as MP } from '...' — propertyName 是原名
        if (el.propertyName && el.propertyName.text === name) return moduleSpecifier
      }
    }

    // import MyPage from 'my-framework'
    if (stmt.importClause?.name?.text === name) return moduleSpecifier

    // import * as Framework from 'my-framework' → Framework.MyPage
    if (
      stmt.importClause?.namedBindings &&
      ts.isNamespaceImport(stmt.importClause.namedBindings)
    ) {
      // 不处理命名空间导入，因为调用名会是 Framework.MyPage 而非 MyPage
    }
  }

  // 可能是 require() 形式
  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          // const MyPage = require('my-framework').MyPage
          // 或 const { MyPage } = require('my-framework')
          const init = decl.initializer
          if (ts.isCallExpression(init) && init.expression.getText(sourceFile) === 'require') {
            const arg = init.arguments[0]
            if (arg && ts.isStringLiteral(arg)) return arg.text
          }
        }
      }
    }
  }

  return undefined
}
```

**Step 6: 更新 tsconfig.test.json 加入新文件**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "out-test",
    "rootDir": "src",
    "sourceMap": true,
    "noUnusedLocals": false,
    "types": ["mocha", "node"]
  },
  "include": [
    "src/plugin/lib/identifierCollector.ts",
    "src/plugin/lib/wxmlForScope.ts",
    "src/plugin/lib/configObjectHeuristics.ts",
    "src/plugin/lib/typeDrivenResolver.ts",
    "src/test/unit/**/*"
  ]
}
```

**Step 7: 运行测试确认通过**

Run: `npx tsc -p tsconfig.test.json && npx mocha "out-test/test/unit/typeDrivenResolver.test.js"`

Expected: PASS — T0.x 和 T0b.x 全部通过

**Step 8: 运行全量单测**

Run: `npm run test:unit`

Expected: PASS

**Step 9: Commit**

```bash
git add src/plugin/lib/typeDrivenResolver.ts src/test/unit/typeDrivenResolver.test.ts src/test/fixtures/my-page-typed.ts src/test/fixtures/my-framework.d.ts tsconfig.test.json
git commit -m "feat: add typeDrivenResolver for .d.ts-powered automatic wrapper detection"
```

---

## Task 6: LanguageService 单例管理 — typeDrivenLanguageService.ts

**Files:**
- Create: `src/plugin/lib/typeDrivenLanguageService.ts`

> **说明：** 此模块依赖 `vscode` 获取 workspace root，不可单测。
> 逻辑保持极简，只负责 LS 的创建、缓存和降级。

**Step 1: 实现 LanguageService 单例管理**

创建 `src/plugin/lib/typeDrivenLanguageService.ts`:

```typescript
/**
 * LanguageService 单例管理
 *
 * 依赖 vscode 模块（获取 workspace root），不可单测。
 * 负责为 typeDrivenResolver 提供 TypeChecker。
 *
 * 策略：
 *   - 全局单例，按 projectRoot 缓存
 *   - 懒加载，首次调用才创建
 *   - 创建失败（无 tsconfig.json / 解析失败）时返回 undefined，上层优雅降级
 */

import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'
import { workspace } from 'vscode'

interface LSCacheEntry {
  root: string
  service: ts.LanguageService
  program: ts.Program
  checker: ts.TypeChecker
  createdAt: number
}

const lsCache = new Map<string, LSCacheEntry>()

/** 缓存 TTL：30 秒。超时后下次访问重新创建（文件可能已变化） */
const LS_CACHE_TTL = 30_000

/**
 * 获取项目的 LanguageService（带缓存）。
 *
 * @param projectRoot 项目根目录（workspace root 或 config.rootPath）
 * @returns LS + Program + Checker，或 undefined（无法创建）
 */
export function getLanguageService(
  projectRoot: string
): { service: ts.LanguageService; program: ts.Program; checker: ts.TypeChecker } | undefined {
  // 检查缓存
  const cached = lsCache.get(projectRoot)
  if (cached && Date.now() - cached.createdAt < LS_CACHE_TTL) {
    return cached
  }

  // 创建新的 LS
  const entry = createLanguageService(projectRoot)
  if (entry) {
    lsCache.set(projectRoot, entry)
    return entry
  }

  return undefined
}

/**
 * 获取 LanguageService 中指定文件的 SourceFile 和 TypeChecker。
 *
 * @param filePath 要分析的文件路径
 * @returns { sourceFile, checker } 或 undefined
 */
export function getFileInfo(
  filePath: string
): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } | undefined {
  const projectRoot = findProjectRoot(filePath)
  if (!projectRoot) return undefined

  const ls = getLanguageService(projectRoot)
  if (!ls) return undefined

  // 刷新文件内容（如果编辑器中有未保存的改动）
  const content = getFileContent(filePath)
  if (content !== undefined) {
    // LS 会自动通过 host 读取文件，这里不需要手动操作
  }

  const sourceFile = ls.program.getSourceFile(filePath)
  if (!sourceFile) {
    // 文件不在 program 中，可能是新文件，尝试刷新
    ls.service.getProgram() // 触发重新编译
    const updatedProgram = ls.service.getProgram()
    if (!updatedProgram) return undefined
    const sf = updatedProgram.getSourceFile(filePath)
    if (!sf) return undefined
    return { sourceFile: sf, checker: updatedProgram.getTypeChecker() }
  }

  return { sourceFile, checker: ls.checker }
}

/** 清除所有缓存（插件 deactivate 时调用） */
export function clearLanguageServiceCache(): void {
  lsCache.clear()
}

// ---------- 内部函数 ----------

function createLanguageService(projectRoot: string): LSCacheEntry | undefined {
  const tsconfigPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json')
  if (!tsconfigPath) {
    console.log('[typeDrivenLanguageService] 未找到 tsconfig.json，跳过类型驱动解析')
    return undefined
  }

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    console.warn('[typeDrivenLanguageService] 读取 tsconfig 失败:', configFile.error)
    return undefined
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath)
  )

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => parsedConfig.fileNames,
    getScriptVersion: (_fileName: string) => '1',
    getScriptSnapshot: (fileName: string) => {
      if (!fs.existsSync(fileName)) return undefined
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'))
    },
    getCurrentDirectory: () => projectRoot,
    getCompilationSettings: () => parsedConfig.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }

  const service = ts.createLanguageService(host, ts.createDocumentRegistry())
  const program = service.getProgram()
  if (!program) {
    console.warn('[typeDrivenLanguageService] Program 创建失败')
    return undefined
  }

  const checker = program.getTypeChecker()

  console.log(`[typeDrivenLanguageService] LanguageService 创建成功，root=${projectRoot}`)

  return {
    root: projectRoot,
    service,
    program,
    checker,
    createdAt: Date.now(),
  }
}

/** 从文件路径推断项目根目录 */
function findProjectRoot(filePath: string): string | undefined {
  // 向上查找包含 tsconfig.json 的目录
  let dir = path.dirname(filePath)
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'tsconfig.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // 回退到 workspace root
  const wf = workspace.getWorkspaceFolder({ fsPath: filePath, scheme: 'file' } as any)
  return wf?.uri.fsPath
}

/** 获取文件内容（优先从编辑器获取未保存的内容） */
function getFileContent(filePath: string): string | undefined {
  // 从 vscode 编辑器获取（未保存的改动）
  // 这里用 require 避免循环依赖
  try {
    const { window } = require('vscode')
    const editor = window.visibleTextEditors.find(
      (e: any) => e.document.fileName === filePath
    )
    if (editor) return editor.document.getText()
  } catch {
    // ignore
  }

  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8')
  }

  return undefined
}
```

**Step 2: 编译确认**

Run: `npx tsc -p tsconfig.json --noEmit`

Expected: 无编译错误（此文件依赖 vscode，不在 test tsconfig 中，只验证主 tsconfig 编译通过）

**Step 3: Commit**

```bash
git add src/plugin/lib/typeDrivenLanguageService.ts
git commit -m "feat: add LanguageService singleton manager for type-driven resolution"
```

---

## Task 7: 类型驱动解析集成到 ScriptFile.ts

**Files:**
- Modify: `src/plugin/lib/ScriptFile.ts`

**Step 1: 在 ScriptFile.ts 顶部加入导入**

```typescript
import { resolveCallShape, extractKeysFromSection, ResolvedWrapperShape } from './typeDrivenResolver'
import { getFileInfo, clearLanguageServiceCache } from './typeDrivenLanguageService'
```

**Step 2: 在 parseScriptFile 中新增类型驱动解析分支**

在 `parseScriptFile` 函数内部，`visit` 函数定义之前，加入类型驱动的预处理:

```typescript
// ========== 阶段0: 类型驱动解析（如果有 .d.ts 类型包）==========
let typeDrivenFound = false
try {
  const fileInfo = getFileInfo(file)
  if (fileInfo && (type === 'prop' || type === 'method')) {
    const { sourceFile: typedSF, checker } = fileInfo
    // 扫描所有 CallExpression，尝试类型驱动解析
    function visitForTypeDriven(node: ts.Node) {
      if (typeDrivenFound) return
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const shape = resolveCallShape(node, checker, typedSF)
        if (shape && ts.isObjectLiteralExpression(node.arguments[shape.argumentIndex])) {
          console.log(`[ScriptFile] 类型驱动命中: ${shape.functionName} from ${shape.sourceModule}`)
          const configArg = node.arguments[shape.argumentIndex] as ts.ObjectLiteralExpression

          // 根据 type 决定查哪个 section
          if (type === 'prop') {
            // 优先 data，其次 properties
            for (const sectionName of shape.sections.data || []) {
              const keys = extractKeysFromSection(configArg, sectionName, checker)
              for (const key of keys) {
                if (matchesProp(key.name)) {
                  // 用 typedSF 的位置信息（和 sourceFile 是同一个文件，位置一致）
                  const keyStart = key.node.getStart(typedSF)
                  const keyEnd = key.node.getEnd()
                  const startLc = typedSF.getLineAndCharacterOfPosition(keyStart)
                  const endLc = typedSF.getLineAndCharacterOfPosition(keyEnd)
                  locs.push({
                    loc: new Location(
                      Uri.file(file),
                      new Range(
                        new Position(startLc.line, startLc.character),
                        new Position(endLc.line, endLc.character)
                      )
                    ),
                    name: key.name,
                    detail: `${shape.functionName} ${sectionName}.${key.name}`,
                    typeInfo: key.typeInfo,
                  })
                  typeDrivenFound = true
                }
              }
            }
            if (!typeDrivenFound) {
              for (const sectionName of shape.sections.properties || []) {
                const keys = extractKeysFromSection(configArg, sectionName, checker)
                for (const key of keys) {
                  if (matchesProp(key.name)) {
                    const keyStart = key.node.getStart(typedSF)
                    const keyEnd = key.node.getEnd()
                    const startLc = typedSF.getLineAndCharacterOfPosition(keyStart)
                    const endLc = typedSF.getLineAndCharacterOfPosition(keyEnd)
                    locs.push({
                      loc: new Location(
                        Uri.file(file),
                        new Range(
                          new Position(startLc.line, startLc.character),
                          new Position(endLc.line, endLc.character)
                        )
                      ),
                      name: key.name,
                      detail: `${shape.functionName} ${sectionName}.${key.name}`,
                      typeInfo: key.typeInfo,
                    })
                    typeDrivenFound = true
                  }
                }
              }
            }
          } else if (type === 'method') {
            for (const sectionName of shape.sections.methods || []) {
              const keys = extractKeysFromSection(configArg, sectionName, checker)
              for (const key of keys) {
                if (matchesProp(key.name)) {
                  const keyStart = key.node.getStart(typedSF)
                  const keyEnd = key.node.getEnd()
                  const startLc = typedSF.getLineAndCharacterOfPosition(keyStart)
                  const endLc = typedSF.getLineAndCharacterOfPosition(keyEnd)
                  locs.push({
                    loc: new Location(
                      Uri.file(file),
                      new Range(
                        new Position(startLc.line, startLc.character),
                        new Position(endLc.line, endLc.character)
                      )
                    ),
                    name: key.name,
                    detail: `${shape.functionName} ${sectionName}.${key.name}()`,
                    typeInfo: key.typeInfo,
                  })
                  typeDrivenFound = true
                }
              }
            }
          }
        }
      }
      if (!typeDrivenFound) {
        ts.forEachChild(node, visitForTypeDriven)
      }
    }
    visitForTypeDriven(typedSF)
  }
} catch (e) {
  console.warn('[ScriptFile] 类型驱动解析异常，降级到纯 AST:', e)
}

// 如果类型驱动已命中，直接返回，跳过后续所有解析
if (typeDrivenFound) {
  console.log(`[ScriptFile] 类型驱动解析命中 ${locs.length} 个结果，跳过 AST 解析`)
  return locs
}
```

**Step 3: 在 deactivate 时清理 LS 缓存**

在 `ScriptFile.ts` 末尾加入:

```typescript
// 插件停用时清理 LanguageService 缓存
// （实际调用点在 extension.ts 的 deactivate 中）
export function cleanupTypeDrivenCache(): void {
  clearLanguageServiceCache()
}
```

**Step 4: 在 extension.ts 的 deactivate 中调用清理**

修改 `src/extension.ts` 的 `deactivate` 函数:

```typescript
export function deactivate(): void {
  configDeactivate()
  // 清理 LanguageService 缓存
  import('./plugin/lib/ScriptFile').then(m => m.cleanupTypeDrivenCache?.())
}
```

> **注意：** 用动态 import 避免循环依赖。如果 `ScriptFile` 已静态导入则直接调用。

实际上 `ScriptFile` 没有在 `extension.ts` 直接导入，更简单的做法是在 `ScriptFile.ts` 中导出清理函数，然后在 `extension.ts` 中静态导入:

在 `extension.ts` 顶部加:
```typescript
import { cleanupTypeDrivenCache } from './plugin/lib/ScriptFile'
```

修改 `deactivate`:
```typescript
export function deactivate(): void {
  configDeactivate()
  cleanupTypeDrivenCache()
}
```

**Step 5: 编译确认**

Run: `npx tsc -p tsconfig.json --noEmit`

Expected: 无编译错误

**Step 6: 运行全量单测**

Run: `npm run test:unit`

Expected: PASS — 单测不涉及 vscode，类型驱动分支只在运行时触发

**Step 7: Commit**

```bash
git add src/plugin/lib/ScriptFile.ts src/extension.ts
git commit -m "feat: integrate type-driven resolution as Layer 0 in ScriptFile"
```

---

## Task 8: 完整回归测试 + Prettier 格式化

**Step 1: 运行全量单测**

Run: `npm run test:unit`

Expected: PASS — 所有测试通过

**Step 2: 编译检查**

Run: `npx tsc -p tsconfig.json --noEmit`

Expected: 无编译错误

**Step 3: ESLint 检查**

Run: `npm run lint`

Expected: 无新增 lint 错误

**Step 4: Prettier 格式化所有新增/修改的文件**

Run:
```bash
npx prettier --write \
  src/plugin/lib/configObjectHeuristics.ts \
  src/plugin/lib/typeDrivenResolver.ts \
  src/plugin/lib/typeDrivenLanguageService.ts \
  src/plugin/lib/identifierCollector.ts \
  src/plugin/lib/ScriptFile.ts \
  src/extension.ts \
  src/test/unit/configObjectHeuristics.test.ts \
  src/test/unit/typeDrivenResolver.test.ts \
  src/test/unit/identifierCollector.test.ts \
  src/test/fixtures/my-page-wrap.js \
  src/test/fixtures/my-page-no-standard-keys.js \
  src/test/fixtures/my-page-typed.ts \
  src/test/fixtures/my-framework.d.ts \
  tsconfig.test.json
```

**Step 5: 再次运行测试确认格式化无破坏**

Run: `npm run test:unit`

Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "style: format all modified files with prettier"
```

---

## 后续扩展（不在本次计划内）

1. **内置常见框架描述器** — 为 Taro/uni-app/wepy/mpx 内置 `pageWrappers` 配置，作为 Layer 0/1 的补充。
2. **用户可配置 wrapper** — `package.json` contributes.configuration 新增 `minapp-vscode.pageWrappers`，让用户手动声明自定义封装的结构。
3. **`this.data.xxx` 赋值模式** — 在 `collectAssignmentKeys` 中增加 `this.data.x = ...` 识别。
4. **跨文件函数调用追踪** — 当前 `resolveFunctionReturnProperties` 只在同文件内查找，可扩展为跨文件（需 LS 支持）。
5. **性能监控** — 给类型驱动解析加耗时统计日志，超时自动降级。
