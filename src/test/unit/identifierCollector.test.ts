/**
 * identifierCollector 单元测试
 *
 * 不依赖 vscode 模块；直接用 ts.createSourceFile 读取 fixture 文件后调用收集器。
 *
 * 运行方式：
 *   npm run test:unit
 */

import * as assert from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'

import {
  collectObjectLiteralKeys,
  collectClassMembers,
  collectSetDataKeys,
  collectReturnObjectKeys,
  collectAssignmentKeys,
  collectSpreadKeys,
  collectAllIdentifiers,
  rankAndDedupe,
  CollectedHit,
  CollectSource,
} from '../../plugin/lib/identifierCollector'

const FIXTURE_DIR = path.resolve(__dirname, '../../../src/test/fixtures')

function loadFixture(name: string): { source: ts.SourceFile; text: string } {
  const full = path.join(FIXTURE_DIR, name)
  const text = fs.readFileSync(full, 'utf8')
  const kind = name.endsWith('.ts') ? ts.ScriptKind.TS : name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS
  const source = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, kind)
  return { source, text }
}

/** 把 hit 的字符偏移转换为 1-based 行号，方便断言 */
function hitLine(source: ts.SourceFile, hit: CollectedHit): number {
  return source.getLineAndCharacterOfPosition(hit.start).line + 1
}

function byName(name: string) {
  return (n: string) => n === name
}

describe('identifierCollector — atomic fns', () => {
  /* ------------------------------------------------------------------ 2.1 */
  describe('collectObjectLiteralKeys (T2.1)', () => {
    it('T2.1.1: 平铺对象字面量命中 foo', () => {
      const { source } = loadFixture('factory-wrap.js')
      const hits = collectObjectLiteralKeys(source, 'prop', byName('userName'))
      assert.strictEqual(hits.length, 1, '应命中一次')
      assert.strictEqual(hits[0].source, 'object-literal')
      assert.strictEqual(hits[0].name, 'userName')
    })

    it('T2.1.2: 深层对象字面量（被 factory 包裹）也能命中', () => {
      const { source } = loadFixture('factory-wrap.js')
      const hits = collectObjectLiteralKeys(source, 'prop', byName('age'))
      assert.strictEqual(hits.length, 1)
      assert.strictEqual(hits[0].source, 'object-literal')
    })

    it('T2.1.5: method 查询命中对象字面量中的方法声明 go()', () => {
      const { source } = loadFixture('native-page.js')
      const hits = collectObjectLiteralKeys(source, 'method', byName('go'))
      assert.ok(hits.length >= 1, '应至少命中一次')
      assert.strictEqual(hits[0].source, 'object-literal')
    })

    it('T2.1.4: computed key 不应命中', () => {
      const text = 'const o = { [key]: 1 }'
      const sf = ts.createSourceFile('x.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      const hits = collectObjectLiteralKeys(sf, 'prop', byName('key'))
      assert.strictEqual(hits.length, 0)
    })
  })

  /* ------------------------------------------------------------------ 2.2 */
  describe('collectClassMembers (T2.2)', () => {
    it('T2.2.1: class 方法声明命中 onTap', () => {
      const { source } = loadFixture('class-extends.js')
      const hits = collectClassMembers(source, 'method', byName('onTap'))
      assert.strictEqual(hits.length, 1)
      assert.strictEqual(hits[0].source, 'class-member')
    })

    it('T2.2.2: class 属性声明命中 data', () => {
      const { source } = loadFixture('decorator-class.ts')
      const hits = collectClassMembers(source, 'prop', byName('data'))
      assert.strictEqual(hits.length, 1)
      assert.strictEqual(hits[0].source, 'class-member')
    })

    it('T2.2.3: private 字段 #privateField 不被命中', () => {
      const { source } = loadFixture('class-extends.js')
      const hits = collectClassMembers(source, 'prop', byName('privateField'))
      assert.strictEqual(hits.length, 0)
    })

    it('T2.2.4: static 属性 foo 能命中', () => {
      const { source } = loadFixture('decorator-class.ts')
      const hits = collectClassMembers(source, 'prop', byName('foo'))
      assert.strictEqual(hits.length, 1)
    })
  })

  /* ------------------------------------------------------------------ 2.3 */
  describe('collectSetDataKeys (T2.3)', () => {
    it('T2.3.1: this.setData({ loading }) 命中 loading', () => {
      const { source } = loadFixture('set-data.js')
      const hits = collectSetDataKeys(source, byName('loading'))
      assert.strictEqual(hits.length, 1)
      assert.strictEqual(hits[0].source, 'setData')
    })

    it('T2.3.2: 路径 key "list[0].name" 取首段 list', () => {
      const { source } = loadFixture('set-data.js')
      const hits = collectSetDataKeys(source, byName('list'))
      assert.strictEqual(hits.length, 1)
    })

    it('T2.3.3: that.setData 也支持', () => {
      const { source } = loadFixture('set-data.js')
      const hits = collectSetDataKeys(source, byName('foo'))
      assert.strictEqual(hits.length, 1)
    })

    it('T2.3.4: setData 参数是变量时不收集', () => {
      const { source } = loadFixture('set-data.js')
      // bar 只存在于 dynamicObj 里，不应被 setData 路径收集
      const hits = collectSetDataKeys(source, byName('bar'))
      assert.strictEqual(hits.length, 0)
    })
  })

  /* ------------------------------------------------------------------ 2.4 */
  describe('collectReturnObjectKeys (T2.4)', () => {
    it('T2.4.1: shorthand return 指向 const 定义位置', () => {
      const { source } = loadFixture('composition-api.js')
      const hits = collectReturnObjectKeys(source, 'prop', byName('count'))
      assert.strictEqual(hits.length, 1)
      // 定位应指向 `const count` 的标识符行，而非 return 语句中的 shorthand
      const line = hitLine(source, hits[0])
      // fixture 里 `const count = ref(0)` 在第 7 行（0-based 6）
      assert.strictEqual(line, 7, `期望行号=7，实际=${line}`)
    })

    it('T2.4.3: 箭头函数直接返回对象 buildState', () => {
      const { source } = loadFixture('composition-api.js')
      const hits = collectReturnObjectKeys(source, 'prop', byName('foo'))
      assert.strictEqual(hits.length, 1)
      assert.strictEqual(hits[0].source, 'return-destructure')
    })

    it('T2.4.4: method 查询命中 return 对象中的 handleTap', () => {
      const { source } = loadFixture('composition-api.js')
      const hits = collectReturnObjectKeys(source, 'method', byName('handleTap'))
      // handleTap 是 shorthand，对 method 查询应能命中并指向 function 声明位置
      assert.ok(hits.length >= 1, '应命中 handleTap')
    })
  })

  /* ------------------------------------------------------------------ 2.5 */
  describe('collectAssignmentKeys (T2.5)', () => {
    it('T2.5.1: this.userName 命中', () => {
      const { source } = loadFixture('this-assign.js')
      const hits = collectAssignmentKeys(source, 'prop', byName('userName'))
      assert.strictEqual(hits.length, 1)
      assert.strictEqual(hits[0].source, 'assignment')
    })

    it('T2.5.2: Home.prototype.onTap 命中', () => {
      const { source } = loadFixture('this-assign.js')
      const hits = collectAssignmentKeys(source, 'method', byName('onTap'))
      assert.strictEqual(hits.length, 1)
    })

    it('T2.5.3: globalThis.foo 不命中', () => {
      const { source } = loadFixture('this-assign.js')
      const hits = collectAssignmentKeys(source, 'prop', byName('foo'))
      assert.strictEqual(hits.length, 0)
    })
  })

  /* ------------------------------------------------------------------ 2.6 */
  describe('collectSpreadKeys (T2.6)', () => {
    it('T2.6.1: ...base 解析到文件顶层 const base 并命中 foo', () => {
      const { source } = loadFixture('spread-in-file.js')
      const hits = collectSpreadKeys(source, 'prop', byName('foo'))
      assert.ok(hits.length >= 1, '应命中来自 base 的 foo')
      assert.strictEqual(hits[0].source, 'spread')
    })

    it('T2.6.2: Object.assign({}, mixinA) 展开 mixinA.bar', () => {
      const { source } = loadFixture('spread-in-file.js')
      const hits = collectSpreadKeys(source, 'prop', byName('bar'))
      assert.ok(hits.length >= 1)
    })
  })
})

describe('identifierCollector — collectAllIdentifiers (T1)', () => {
  it('T1.1: 未知 factory 包裹的 data.userName 可被找到', () => {
    const { source } = loadFixture('factory-wrap.js')
    const hits = collectAllIdentifiers(source, 'prop', byName('userName'))
    assert.ok(hits.some(h => h.name === 'userName'))
  })

  it('T1.2: 装饰器+class property 中的 age 可被找到', () => {
    const { source } = loadFixture('decorator-class.ts')
    const hits = collectAllIdentifiers(source, 'prop', byName('age'))
    // class.data 是 class-member，里面的 age 是 object-literal
    assert.ok(hits.some(h => h.name === 'age' && h.source === 'object-literal'))
  })

  it('T1.3: class 方法 onTap 能通过 class-member 路径命中', () => {
    const { source } = loadFixture('class-extends.js')
    const hits = collectAllIdentifiers(source, 'method', byName('onTap'))
    assert.ok(hits.some(h => h.source === 'class-member'))
  })

  it('T1.4: Composition API 中 return { count } 能被找到', () => {
    const { source } = loadFixture('composition-api.js')
    const hits = collectAllIdentifiers(source, 'prop', byName('count'))
    assert.ok(hits.some(h => h.source === 'return-destructure'))
  })

  it('T1.5: 原生 Page 的 methods.go 能被找到', () => {
    const { source } = loadFixture('native-page.js')
    const hits = collectAllIdentifiers(source, 'method', byName('go'))
    assert.ok(hits.length >= 1)
  })

  it('T1.6: 不存在的 prop 返回空', () => {
    const { source } = loadFixture('native-page.js')
    const hits = collectAllIdentifiers(source, 'prop', byName('doesNotExist'))
    assert.strictEqual(hits.length, 0)
  })

  it('T1.7: 兜底收集的 hit 置信度应为 low', () => {
    const { source } = loadFixture('native-page.js')
    const hits = collectAllIdentifiers(source, 'prop', byName('foo'))
    assert.ok(hits.length >= 1)
    assert.strictEqual(hits[0].confidence, 'low')
  })
})

/* ------------------------------------------------------------------ T4 */
describe('rankAndDedupe (T4)', () => {
  function hit(start: number, end: number, source: CollectSource, name = 'x'): CollectedHit {
    return { start, end, name, detail: name, source, confidence: 'low' }
  }

  it('T4.1: 同位置多 source 只保留优先级最高(class-member > object-literal)', () => {
    const input: CollectedHit[] = [hit(10, 11, 'object-literal'), hit(10, 11, 'class-member'), hit(10, 11, 'setData')]
    const out = rankAndDedupe(input)
    assert.strictEqual(out.length, 1, '同位置应去重到 1 条')
    assert.strictEqual(out[0].source, 'class-member', '应保留优先级最高的')
  })

  it('T4.2: 不同位置同名命中全部保留,按优先级排序', () => {
    const input: CollectedHit[] = [hit(30, 31, 'setData'), hit(10, 11, 'spread'), hit(20, 21, 'object-literal')]
    const out = rankAndDedupe(input)
    assert.strictEqual(out.length, 3)
    assert.deepStrictEqual(
      out.map(h => h.source),
      ['object-literal', 'setData', 'spread'],
      '应按 class > object > return > setData > assign > spread 排序'
    )
  })

  it('T4.3: 同优先级不同位置按 start 升序', () => {
    const input: CollectedHit[] = [
      hit(50, 51, 'object-literal'),
      hit(10, 11, 'object-literal'),
      hit(30, 31, 'object-literal'),
    ]
    const out = rankAndDedupe(input)
    assert.deepStrictEqual(
      out.map(h => h.start),
      [10, 30, 50]
    )
  })

  it('T4.4: 空输入返回空数组', () => {
    assert.deepStrictEqual(rankAndDedupe([]), [])
  })

  it('T4.5: collectAllIdentifiers 内部已用 rankAndDedupe(针对 native-page 的 foo 唯一)', () => {
    const { source } = loadFixture('native-page.js')
    const hits = collectAllIdentifiers(source, 'prop', byName('foo'))
    // fixture 里 topLevelFoo !== foo,且 Page({data:{foo}}) 里的 foo 应只命中一次
    const fooHits = hits.filter(h => h.name === 'foo')
    assert.strictEqual(fooHits.length, 1, '应只命中 1 次 foo')
    assert.strictEqual(fooHits[0].source, 'object-literal')
  })
})
