/**
 * wxmlForScope 单元测试
 *
 * 覆盖:
 *   W1  默认 item/index
 *   W2  wx:for-item 重命名
 *   W3  wx:for-index 重命名
 *   W4  wx:for-items 别名
 *   W5  嵌套作用域(内层覆盖外层同名)
 *   W6  嵌套作用域(不同名并列可见)
 *   W7  block 标签 wx:for
 *   W8  自闭合元素 wx:for
 *   W9  光标在 wx:for 开标签外(标签之前) 不命中
 *   W10 光标在 wx:for 闭合标签之后 不命中
 *   W11 注释中 wx:for 被忽略
 *   W12 属性值中的 `>` 不会截断标签解析
 */

import * as assert from 'assert'
import {
  collectWxForBindings,
  getVisibleWxForBindings,
  dedupeByName,
} from '../../plugin/lib/wxmlForScope'

/** 用 `|` 标记光标位置,返回 { text, offset } */
function mark(src: string): { text: string; offset: number } {
  const offset = src.indexOf('|')
  if (offset === -1) throw new Error('marker `|` required')
  return { text: src.slice(0, offset) + src.slice(offset + 1), offset }
}

describe('wxmlForScope', () => {
  it('W1: 默认 item/index 都可见', () => {
    const { text, offset } = mark(
      '<view wx:for="{{list}}"><text>{{|item}}</text></view>'
    )
    const names = getVisibleWxForBindings(text, offset).map(b => b.name)
    assert.ok(names.includes('item'))
    assert.ok(names.includes('index'))
  })

  it('W2: wx:for-item 重命名后 item 不再可见,新名生效', () => {
    const { text, offset } = mark(
      '<view wx:for="{{list}}" wx:for-item="user">{{|user.name}}</view>'
    )
    const names = getVisibleWxForBindings(text, offset).map(b => b.name)
    assert.ok(names.includes('user'))
    assert.ok(!names.includes('item'))
    // 默认 index 仍在
    assert.ok(names.includes('index'))
  })

  it('W3: wx:for-index 重命名', () => {
    const { text, offset } = mark(
      '<view wx:for="{{list}}" wx:for-index="idx">{{|idx}}</view>'
    )
    const names = getVisibleWxForBindings(text, offset).map(b => b.name)
    assert.ok(names.includes('idx'))
    assert.ok(!names.includes('index'))
    assert.ok(names.includes('item'))
  })

  it('W4: wx:for-items 作为 wx:for 的别名', () => {
    const { text, offset } = mark(
      '<view wx:for-items="{{list}}">{{|item}}</view>'
    )
    const bindings = getVisibleWxForBindings(text, offset)
    assert.ok(bindings.some(b => b.name === 'item' && b.sourceExpr === 'list'))
  })

  it('W5: 嵌套 for,内层 wx:for-item="tag",index 被外层 idx 覆盖', () => {
    const { text, offset } = mark(
      '<view wx:for="{{list}}" wx:for-item="user" wx:for-index="idx">' +
        '<text wx:for="{{user.tags}}" wx:for-item="tag">{{|tag}}-{{idx}}</text>' +
      '</view>'
    )
    const all = getVisibleWxForBindings(text, offset)
    const uniq = dedupeByName(all).map(b => b.name)
    assert.ok(uniq.includes('tag'))
    assert.ok(uniq.includes('idx'))
    assert.ok(uniq.includes('user'))
    // 内层没有重命名 index,默认 index 依然可见(内层作用域贡献)
    assert.ok(uniq.includes('index'))
  })

  it('W6: 内层覆盖外层同名(内层 item 胜出)', () => {
    const { text, offset } = mark(
      '<view wx:for="{{outer}}">' +
        '<text wx:for="{{inner}}">{{|item}}</text>' +
      '</view>'
    )
    const all = getVisibleWxForBindings(text, offset)
    const itemHits = all.filter(b => b.name === 'item')
    assert.strictEqual(itemHits.length, 2, '两层都叫 item')
    // 内层排在前
    assert.strictEqual(itemHits[0].sourceExpr, 'inner')
    // dedupeByName 只保留内层
    const uniq = dedupeByName(all)
    const uniqItem = uniq.find(b => b.name === 'item')!
    assert.strictEqual(uniqItem.sourceExpr, 'inner')
  })

  it('W7: block 标签 wx:for 也能解析', () => {
    const { text, offset } = mark(
      '<block wx:for="{{list}}"><view>{{|item}}</view></block>'
    )
    const names = getVisibleWxForBindings(text, offset).map(b => b.name)
    assert.ok(names.includes('item'))
  })

  it('W8: 自闭合标签的 wx:for 作用域在标签结束后失效', () => {
    // 自闭合元素通常没有子节点,这里测光标落在元素之后应不可见
    const { text, offset } = mark(
      '<view wx:for="{{list}}" />{{|item}}'
    )
    const names = getVisibleWxForBindings(text, offset).map(b => b.name)
    assert.ok(!names.includes('item'), '自闭合元素后应不可见')
  })

  it('W9: 光标在 wx:for 开标签之前不命中', () => {
    const { text, offset } = mark(
      '{{|item}}<view wx:for="{{list}}"><text>x</text></view>'
    )
    const names = getVisibleWxForBindings(text, offset).map(b => b.name)
    assert.strictEqual(names.length, 0)
  })

  it('W10: 光标在闭合标签之后不命中', () => {
    const { text, offset } = mark(
      '<view wx:for="{{list}}"><text>x</text></view>{{|item}}'
    )
    const names = getVisibleWxForBindings(text, offset).map(b => b.name)
    assert.strictEqual(names.length, 0)
  })

  it('W11: 注释中的 wx:for 被忽略', () => {
    const { text, offset } = mark(
      '<!-- <view wx:for="{{list}}"> --><view>{{|item}}</view>'
    )
    const names = getVisibleWxForBindings(text, offset).map(b => b.name)
    assert.strictEqual(names.length, 0)
  })

  it('W12: 属性值中的 `>` 不会截断标签解析', () => {
    const { text, offset } = mark(
      '<view wx:for="{{list}}" title="a>b"><text>{{|item}}</text></view>'
    )
    const names = getVisibleWxForBindings(text, offset).map(b => b.name)
    assert.ok(names.includes('item'))
  })

  it('W13: defOffset 正确指向属性名起点', () => {
    const wxml = '<view wx:for="{{list}}" wx:for-item="user">{{user.name}}</view>'
    const all = collectWxForBindings(wxml)
    const user = all.find(b => b.name === 'user')!
    // wx:for-item 属性名起始位置
    const expected = wxml.indexOf('wx:for-item')
    assert.strictEqual(user.defOffset, expected)

    const idx = all.find(b => b.name === 'index')!
    // 默认 index 未重命名,defOffset 指向 wx:for
    assert.strictEqual(idx.defOffset, wxml.indexOf('wx:for'))
  })
})
