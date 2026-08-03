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

import { scoreConfigObject, detectConfigObjects, DEFAULT_HEURISTIC } from '../../plugin/lib/configObjectHeuristics'

const FIXTURE_DIR = path.resolve(__dirname, '../../../src/test/fixtures')

function loadFixture(name: string): { source: ts.SourceFile; text: string } {
  const full = path.join(FIXTURE_DIR, name)
  const text = fs.readFileSync(full, 'utf8')
  const kind = name.endsWith('.ts') ? ts.ScriptKind.TS : name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS
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
      const obj = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0]
        .initializer as ts.ObjectLiteralExpression
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
