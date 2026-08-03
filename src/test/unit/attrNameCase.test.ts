/**
 * attrNameCase 单元测试
 *
 * 不依赖 vscode 模块。
 *
 * 运行方式：
 *   npm run test:unit
 */

import * as assert from 'assert'

import {
  camelToKebab,
  kebabToCamel,
  attrNameEquals,
  attrNameExists,
  normalizeAttrName,
} from '../../common/src/attrNameCase'

describe('attrNameCase', () => {
  describe('camelToKebab', () => {
    it('驼峰转中划线', () => {
      assert.strictEqual(camelToKebab('userName'), 'user-name')
      assert.strictEqual(camelToKebab('totalFlowerCount'), 'total-flower-count')
      assert.strictEqual(camelToKebab('showBack'), 'show-back')
    })

    it('无大写字母不转换', () => {
      assert.strictEqual(camelToKebab('data'), 'data')
      assert.strictEqual(camelToKebab('src'), 'src')
      assert.strictEqual(camelToKebab('user-name'), 'user-name')
    })

    it('首字母大写不产生前导中划线', () => {
      assert.strictEqual(camelToKebab('MyProp'), 'my-prop')
    })
  })

  describe('kebabToCamel', () => {
    it('中划线转驼峰', () => {
      assert.strictEqual(kebabToCamel('user-name'), 'userName')
      assert.strictEqual(kebabToCamel('total-flower-count'), 'totalFlowerCount')
      assert.strictEqual(kebabToCamel('show-back'), 'showBack')
    })

    it('无中划线不转换', () => {
      assert.strictEqual(kebabToCamel('data'), 'data')
      assert.strictEqual(kebabToCamel('userName'), 'userName')
    })
  })

  describe('attrNameEquals', () => {
    it('相同写法相等', () => {
      assert.ok(attrNameEquals('userName', 'userName'))
      assert.ok(attrNameEquals('user-name', 'user-name'))
    })

    it('驼峰与中划线互通', () => {
      assert.ok(attrNameEquals('userName', 'user-name'))
      assert.ok(attrNameEquals('user-name', 'userName'))
      assert.ok(attrNameEquals('totalFlowerCount', 'total-flower-count'))
    })

    it('不同属性名不相等', () => {
      assert.ok(!attrNameEquals('userName', 'age'))
      assert.ok(!attrNameEquals('user-name', 'user-age'))
    })

    it('原生属性（无大写无中划线）正常匹配', () => {
      assert.ok(attrNameEquals('src', 'src'))
      assert.ok(!attrNameEquals('src', 'class'))
    })
  })

  describe('attrNameExists', () => {
    it('直接命中', () => {
      const attrs = { 'user-name': 'xx', src: true }
      assert.ok(attrNameExists('user-name', attrs))
      assert.ok(attrNameExists('src', attrs))
    })

    it('驼峰命中中划线写法', () => {
      const attrs = { 'user-name': 'xx' }
      assert.ok(attrNameExists('userName', attrs))
    })

    it('中划线命中驼峰写法', () => {
      const attrs = { userName: 'xx' }
      assert.ok(attrNameExists('user-name', attrs))
    })

    it('不存在返回 false', () => {
      const attrs = { 'user-name': 'xx' }
      assert.ok(!attrNameExists('age', attrs))
    })
  })

  describe('normalizeAttrName', () => {
    it('kebab 风格转中划线', () => {
      assert.strictEqual(normalizeAttrName('userName', 'kebab'), 'user-name')
      assert.strictEqual(normalizeAttrName('totalFlowerCount', 'kebab'), 'total-flower-count')
    })

    it('camel 风格保持驼峰', () => {
      assert.strictEqual(normalizeAttrName('userName', 'camel'), 'userName')
    })

    it('auto 风格使用 autoDecider', () => {
      assert.strictEqual(
        normalizeAttrName('userName', 'auto', () => 'kebab'),
        'user-name'
      )
      assert.strictEqual(
        normalizeAttrName('userName', 'auto', () => 'camel'),
        'userName'
      )
    })

    it('auto 无 decider 退化为 camel', () => {
      assert.strictEqual(normalizeAttrName('userName', 'auto'), 'userName')
    })

    it('原生属性（无大写）不转换', () => {
      assert.strictEqual(normalizeAttrName('src', 'kebab'), 'src')
      assert.strictEqual(normalizeAttrName('data', 'kebab'), 'data')
    })
  })
})
