import { match, getPositionFromIndex } from './helper'
import { Position } from 'vscode'
import { SourceMapConsumer } from 'source-map'

const styleRegexp = /\.([a-zA-Z][\w-\d_]*)\s*\{/g

const styleSingleCommentRegexp = /\/\/.*/g
const styleMultipleCommentRegExp = /\/\*[\s\S]*?\*\//g

export namespace quickParseStyle {
  export interface Options {
    unique?: boolean
  }
}

/**
 * 解析样式文件内容成 className 和 doc 的形式
 *
 * 样式文件可能是 scss/less/css 所以不需要解析成 ast，只需要用正则即可
 */
export function quickParseStyle(styleContent: { css: string, map: string | undefined }, { unique }: quickParseStyle.Options = {}) {
  const style: { doc: string; pos: Position; name: string }[] = []
  const content = styleContent.css
    .replace(styleSingleCommentRegexp, replacer) // 去除单行注释
    .replace(styleMultipleCommentRegExp, replacer) // 去除多行注释
  const map = styleContent.map ? new SourceMapConsumer(JSON.parse(styleContent.map)) : undefined
  const res = match(content, styleRegexp)
  res.forEach(mat => {
    const name = mat[1]
    if (!unique || !style.find(s => s.name === name)) {
      const reg = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`, 'g')
      const match = reg.exec(content)
      let doc = ''
      if (match) {
        doc = `{${ match[1]}}`
      }
      const cssPos = getPositionFromIndex(content, mat.index + mat[0].length)
      const mapPos = map ? map.originalPositionFor({ line: cssPos.line + 1, column: cssPos.character }) : null
      const pos = mapPos && mapPos.line !== null ? new Position(mapPos.line - 1, mapPos.column) : cssPos
      // todo 当sass文件时，需要做原始映射
      style.push({ doc, pos: pos, name })
    }
  })

  // 再来获取带文档的 className
  // styleContent.replace(styleWithDocRegexp, (raw, doc, name) => {
  //   style.forEach(s => {
  //     if (s.name === name) s.doc = parseDoc(doc) + '\n' + s.doc
  //     return s.name === name
  //   })
  //   return ''
  // })

  return style
}

function replacer(raw: string) {
  return raw.replace(/[^\r\n]/g, ' ')
}
