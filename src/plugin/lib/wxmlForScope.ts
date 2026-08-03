/**
 * wxml wx:for 作用域分析器
 *
 * 目标:对 wxml 模板中的 wx:for 循环,给定光标位置,返回该位置"可见"的循环变量列表
 * (包括默认的 item/index,以及通过 wx:for-item / wx:for-index / wx:for-items 重命名的)。
 *
 * 纯函数,不依赖 vscode。单测可直接跑。
 *
 * 实现策略:
 *   线性扫描 wxml 文本,维护开标签栈。遇到开标签解析其 wx:for* 属性,
 *   遇到闭合标签/自闭合标签则出栈并确定作用域 [start, end)。
 *   查询时返回所有 cursor 命中的作用域,内层在前(覆盖外层同名)。
 */

export interface WxForBinding {
  /** 变量名(含重命名后) */
  name: string
  /** 语义角色 */
  role: 'item' | 'index'
  /** wx:for 的值表达式,如 "list" 或 "user.tags" */
  sourceExpr: string
  /**
   * 定义位置 = 定义它的那个属性名在 wxml 中的字符偏移
   *   - default item/index:指向 wx:for="..." 的起始位置
   *   - renamed:指向 wx:for-item 或 wx:for-index 属性名的起始位置
   */
  defOffset: number
  /** 该变量的作用域覆盖区间 [start, end) —— 元素开标签结束到闭合标签开始 */
  scopeStart: number
  scopeEnd: number
}

interface OpenTag {
  tagName: string
  /** 标签起始 `<` 的 offset */
  openStart: number
  /** 开标签 `>` 后一位的 offset (即子内容起点) */
  contentStart: number
  /** 该标签产生的 wx:for bindings(可能为空) */
  bindings: WxForBinding[]
  /** 是否自闭合(<foo />) */
  selfClosed: boolean
}

const TAG_NAME_RE = /[a-zA-Z_][\w:-]*/
/** 匹配一条属性:name="value" / name='value' / name */
const ATTR_RE = /([\w:.-]+)\s*(=\s*("([^"]*)"|'([^']*)'))?/g

/**
 * 从开标签的属性串(不含标签名与尖括号)解析出 wx:for 相关的 bindings。
 *
 * @param attrsText 属性文本,如 ' wx:for="{{list}}" wx:for-item="user"'
 * @param attrsStartOffset 属性文本在整个 wxml 中的起始 offset
 * @param scopeStart 作用域起点(开标签 > 后一位)
 * @param scopeEnd  作用域终点(闭合标签 < 位置,先填 -1,出栈时回填)
 */
function parseForBindings(
  attrsText: string,
  attrsStartOffset: number,
  scopeStart: number,
  scopeEnd: number
): WxForBinding[] {
  let hasFor = false
  let forExpr = ''
  let forOffset = -1
  let itemName = 'item'
  let itemOffset = -1
  let indexName = 'index'
  let indexOffset = -1

  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(attrsText))) {
    const name = m[1]
    const val = (m[4] ?? m[5] ?? '').trim()
    const attrOffset = attrsStartOffset + m.index

    if (name === 'wx:for' || name === 'wx:for-items') {
      hasFor = true
      forExpr = stripBraces(val)
      forOffset = attrOffset
    } else if (name === 'wx:for-item') {
      if (val) {
        itemName = val
        itemOffset = attrOffset
      }
    } else if (name === 'wx:for-index') {
      if (val) {
        indexName = val
        indexOffset = attrOffset
      }
    }
  }

  if (!hasFor) return []

  return [
    {
      name: itemName,
      role: 'item',
      sourceExpr: forExpr,
      defOffset: itemOffset !== -1 ? itemOffset : forOffset,
      scopeStart,
      scopeEnd,
    },
    {
      name: indexName,
      role: 'index',
      sourceExpr: forExpr,
      defOffset: indexOffset !== -1 ? indexOffset : forOffset,
      scopeStart,
      scopeEnd,
    },
  ]
}

function stripBraces(v: string): string {
  // "{{ list }}" → "list"
  const m = v.match(/^\{\{\s*([\s\S]*?)\s*\}\}$/)
  return m ? m[1].trim() : v
}

/**
 * 扫描整个 wxml 文本,返回所有 wx:for 绑定(已确定完整 scope)。
 */
export function collectWxForBindings(text: string): WxForBinding[] {
  const stack: OpenTag[] = []
  const all: WxForBinding[] = []

  let i = 0
  const n = text.length
  while (i < n) {
    // 快进到下一个 <
    const lt = text.indexOf('<', i)
    if (lt === -1) break

    // 跳过注释 <!-- ... -->
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    // 跳过 <![CDATA[ 等
    if (text[lt + 1] === '!') {
      const end = text.indexOf('>', lt)
      i = end === -1 ? n : end + 1
      continue
    }

    // 闭合标签 </tag>
    if (text[lt + 1] === '/') {
      const gt = text.indexOf('>', lt)
      if (gt === -1) break
      const tagNameMatch = TAG_NAME_RE.exec(text.slice(lt + 2, gt))
      const closeName = tagNameMatch ? tagNameMatch[0] : ''
      // 弹栈到同名
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tagName === closeName) {
          // 把第 k 层及以上都弹出,每个都记 scopeEnd
          while (stack.length > k) {
            const top = stack.pop()!
            for (const b of top.bindings) {
              b.scopeEnd = lt
              all.push(b)
            }
          }
          break
        }
      }
      i = gt + 1
      continue
    }

    // 开标签 <tag ...>
    const gt = findTagEnd(text, lt + 1)
    if (gt === -1) break

    const nameMatch = TAG_NAME_RE.exec(text.slice(lt + 1, gt))
    if (!nameMatch) {
      i = gt + 1
      continue
    }
    const tagName = nameMatch[0]
    const selfClosed = text[gt - 1] === '/'
    const attrsStart = lt + 1 + nameMatch[0].length
    const attrsEnd = selfClosed ? gt - 1 : gt
    const attrsText = text.slice(attrsStart, attrsEnd)
    const contentStart = gt + 1

    const bindings = parseForBindings(attrsText, attrsStart, contentStart, -1)

    if (selfClosed) {
      // 自闭合元素的 scope = 属性本身覆盖范围(实际没有子元素,scopeEnd = gt + 1)
      for (const b of bindings) {
        b.scopeEnd = gt + 1
        all.push(b)
      }
    } else {
      stack.push({ tagName, openStart: lt, contentStart, bindings, selfClosed })
    }

    i = gt + 1
  }

  // 文件结束仍未闭合的标签,按 n 作为 scopeEnd 兜底
  while (stack.length > 0) {
    const top = stack.pop()!
    for (const b of top.bindings) {
      b.scopeEnd = n
      all.push(b)
    }
  }

  return all
}

/**
 * 找到开标签 `<` 起向后第一个真正属于该标签的 `>`。
 * 需考虑属性值中的 `>`(由引号包裹)。
 */
function findTagEnd(text: string, from: number): number {
  let i = from
  const n = text.length
  let inStr: '"' | "'" | null = null
  while (i < n) {
    const c = text[i]
    if (inStr) {
      if (c === inStr) inStr = null
    } else {
      if (c === '"' || c === "'") inStr = c
      else if (c === '>') return i
    }
    i++
  }
  return -1
}

/**
 * 查询给定光标 offset 下可见的 wx:for 变量列表。
 * 内层作用域优先(靠前);同层按出现顺序。
 */
export function getVisibleWxForBindings(text: string, cursorOffset: number): WxForBinding[] {
  const all = collectWxForBindings(text)
  const hits = all.filter(b => cursorOffset >= b.scopeStart && cursorOffset < b.scopeEnd)
  // 内层优先:scopeStart 越大越靠内
  hits.sort((a, b) => b.scopeStart - a.scopeStart)
  // 同一作用域内 item 排在 index 前
  return hits
}

/**
 * 去重:同一 name 只保留最内层定义(用于补全列表)。
 */
export function dedupeByName(bindings: WxForBinding[]): WxForBinding[] {
  const seen = new Set<string>()
  const out: WxForBinding[] = []
  for (const b of bindings) {
    if (seen.has(b.name)) continue
    seen.add(b.name)
    out.push(b)
  }
  return out
}
