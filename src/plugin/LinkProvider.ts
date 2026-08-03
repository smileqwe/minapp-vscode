/******************************************************************
 MIT License http://www.opensource.org/licenses/mit-license.php
 Author Mora <qiuzhongleiabc@126.com> (https://github.com/qiu8310)
*******************************************************************/

import { DocumentLinkProvider, DocumentLink, CancellationToken, TextDocument, Uri, Range } from 'vscode'
import { Config } from './lib/config'
import * as fs from 'fs'
import * as path from 'path'
import { getProp } from './lib/ScriptFile'
import { getVisibleWxForBindings } from './lib/wxmlForScope'

export default class implements DocumentLinkProvider {
  constructor(public config: Config) {}

  async provideDocumentLinks(doc: TextDocument, token: CancellationToken): Promise<DocumentLink[]> {
    return this.getLinks(doc)
  }

  private getLinks(doc: TextDocument) {
    const links: DocumentLink[] = []
    const { linkAttributeNames } = this.config
    if (!linkAttributeNames.length) return links

    const roots = this.config.getResolveRoots(doc)
    const rootsWithDir = [path.dirname(doc.fileName), ...roots]
    const regexp = new RegExp(`\\b(${linkAttributeNames.join('|')})=['"]([^'"]+)['"]`, 'g')
    const remote = /^\w+:\/\// // 是否是远程路径，如 "http://" ...
    doc.getText().replace(regexp, (raw, tag: string, key: string, index: number) => {
      // {{ }} 变量表达式：生成指向变量定义位置的 DocumentLink（与 F12 行为统一）
      if (key.includes('{{') || key.includes('}}')) {
        const varLink = this.tryResolveVariableLink(doc, index, tag, key)
        if (varLink) links.push(varLink)
        return raw
      }

      const isRemote = remote.test(key)
      let file: string | undefined
      if (isRemote) {
        file = key
      } else if (key.startsWith('/')) {
        // 绝对路径解析
        file = roots.map(root => path.join(root, key)).find(f => fs.existsSync(f))
      } else {
        file = rootsWithDir.map(dir => path.resolve(dir, key)).find(file => fs.existsSync(file))
      }

      if (file) {
        const offset = index + tag.length + 2
        const startPoint = doc.positionAt(offset)
        const endPoint = doc.positionAt(offset + key.length)
        links.push(new DocumentLink(new Range(startPoint, endPoint), isRemote ? Uri.parse(file) : Uri.file(file)))
      }
      return raw
    })

    return links
  }

  /**
   * 为 {{ }} 变量表达式生成 DocumentLink，指向变量定义位置。
   * 优先级：wx:for 循环变量（wxml 自身）> data/properties/computed 定义（js 文件）。
   * 与 PropDefinitionProvider 的逻辑保持一致，确保 Ctrl+Click 和 F12 行为统一。
   *
   * VSCode DocumentLink 的 target 是一个 Uri，跳转后光标位置由 Uri fragment
   * （#L行,列，1-based 行 / 0-based 列）决定。
   */
  private tryResolveVariableLink(
    doc: TextDocument,
    attrMatchIndex: number,
    attrName: string,
    attrValue: string
  ): DocumentLink | undefined {
    // 提取 {{ }} 内的变量名（取第一个表达式，支持 item.xxx 取根变量）
    const exprMatch = attrValue.match(/\{\{\s*([\s\S]*?)\s*\}\}/)
    if (!exprMatch) return undefined
    const expr = exprMatch[1].trim()
    // 取根变量（item.title → item）
    const rootVar = expr.split('.')[0].trim()
    if (!rootVar || !/^[a-zA-Z_$][\w$]*$/.test(rootVar)) return undefined

    // 属性值中变量的字符偏移（跳过 attrName=" 部分）
    const valueOffset = attrMatchIndex + attrName.length + 2 // +2 for =' or ="
    const varOffsetInValue = attrValue.indexOf(rootVar)
    if (varOffsetInValue < 0) return undefined
    const varStartOffset = valueOffset + varOffsetInValue
    const varEndOffset = varStartOffset + rootVar.length
    const linkRange = new Range(doc.positionAt(varStartOffset), doc.positionAt(varEndOffset))

    // 1. wx:for 循环变量 → wxml 自身
    const text = doc.getText()
    const bindings = getVisibleWxForBindings(text, varStartOffset)
    const wxForHit = bindings.find(b => b.name === rootVar)
    if (wxForHit) {
      const pos = doc.positionAt(wxForHit.defOffset)
      // VSCode Uri fragment: #L行,列（1-based 行，0-based 列）
      return new DocumentLink(linkRange, doc.uri.with({ fragment: `${pos.line + 1},${pos.character}` }))
    }

    // 2. data/properties/computed 定义 → js 文件
    const propInfos = getProp(doc.fileName, 'prop', rootVar)
    if (propInfos.length > 0) {
      const first = propInfos[0]
      const pos = first.loc.range.start
      return new DocumentLink(linkRange, first.loc.uri.with({ fragment: `${pos.line + 1},${pos.character}` }))
    }

    return undefined
  }
}
