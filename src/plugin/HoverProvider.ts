/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Mora <qiuzhongleiabc@126.com> (https://github.com/qiu8310)
*******************************************************************/

import { HoverProvider, TextDocument, Position, CancellationToken, Hover, MarkdownString } from 'vscode'
import { classHover, hoverComponentAttrMarkdown, hoverComponentMarkdown } from '../common/src'
import { getTagAtPosition } from './getTagAtPosition/'
import { Config } from './lib/config'
import { getLanguage, getCustomOptions } from './lib/helper'
import { getProp } from './lib/ScriptFile'

export default class implements HoverProvider {
  constructor(public config: Config) {}

  async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | null> {
    if (token.isCancellationRequested) {
      return null;
    }

    const language = getLanguage(document, position)
    if (!language) return null

    const tag = getTagAtPosition(document, position)
    
    // 1. 处理 {{ }} 表达式中的变量悬停
    const interpolationHover = this.getInterpolationHover(document, position)
    if (interpolationHover) {
      return interpolationHover
    }
    
    if (!tag) return null
    
    // 2. 处理class悬停
    if (tag.isOnAttrValue && (tag.attrName === 'class' || /^[\w\d-]+-class/.test(tag.attrName)) ) {
      // 获取当前元素的所有 class
      const allClasses = tag.attrs.class ? String(tag.attrs.class).split(/\s+/).filter(c => c) : []
      const mk = await classHover(document, tag.posWord, allClasses)
      return mk ? new Hover(mk) : null  
    }
    
    // 3. 处理属性值中的变量悬停
    if (tag.isOnAttrValue && tag.posWord) {
      const varHover = this.getVariableHover(document, tag.posWord)
      if (varHover) {
        return varHover
      }
    }

    const co = getCustomOptions(this.config, document)

    // 4. 处理组件和属性的悬停提示
    let markdown: string | undefined
    if (tag.isOnTagName) {
      markdown = await hoverComponentMarkdown(tag.name, language, co)
    } else if (!tag.isOnTagName && tag.posWord && !/^(wx|bind|catch):/.test(tag.posWord)) {
      markdown = await hoverComponentAttrMarkdown(tag.name, tag.posWord, language, co)
    }
    console.log('provideHover', markdown)

    return markdown ? new Hover(new MarkdownString(markdown)) : null
  }

  /**
   * 获取 {{ }} 表达式中变量的悬停提示
   */
  private getInterpolationHover(document: TextDocument, position: Position): Hover | null {
    // 匹配 {{ }} 表达式，支持多级属性访问
    const range = document.getWordRangeAtPosition(position, /\{\{[^}]*\}\}/)
    if (!range) return null

    const fullText = document.getText(range).replace(/^\{\{\s*|\s*\}\}$/g, '')
    
    // 获取光标在表达式中的具体位置
    const rangeStart = range.start
    const cursorOffset = document.offsetAt(position) - document.offsetAt(rangeStart) - 2 // 减去 '{{' 的长度
    
    // 提取光标位置的变量或属性路径
    const variableInfo = this.extractVariableAtPosition(fullText, cursorOffset)
    if (!variableInfo) return null

    console.log(`[HoverProvider] 表达式: ${fullText}, 光标位置: ${cursorOffset}, 提取变量: ${variableInfo.variable}`)

    // 查找变量定义
    const propInfos = getProp(document.fileName, 'prop', variableInfo.rootVariable)
    
    if (propInfos.length === 0) return null

    // 构建悬停提示内容
    const markdown = new MarkdownString()
    markdown.isTrusted = true
    markdown.supportHtml = true

    // 标题
    if (variableInfo.isPropertyAccess) {
      markdown.appendMarkdown(`### 🔍 \`${variableInfo.variable}\`\n\n`)
      markdown.appendMarkdown(`*属性访问，根变量: \`${variableInfo.rootVariable}\`*\n\n`)
    } else {
      markdown.appendMarkdown(`### 🔍 变量: \`${variableInfo.variable}\`\n\n`)
    }

    // 变量定义详情
    propInfos.forEach((info, index) => {
      if (index > 0) markdown.appendMarkdown('\n\n---\n\n')
      
      markdown.appendMarkdown(`**定义：** \`${info.detail}\`\n\n`)
      
      // 文件位置
      const fileName = info.loc.uri.fsPath.split('/').pop()
      const line = info.loc.range.start.line + 1
      markdown.appendMarkdown(`**位置：** ${fileName}:${line}\n\n`)
    })

    // 添加提示
    if (variableInfo.isPropertyAccess) {
      markdown.appendMarkdown('\n💡 *提示：点击可跳转到根变量定义*')
    } else {
      markdown.appendMarkdown('\n💡 *提示：点击 Cmd/Ctrl + Click 可跳转到定义*')
    }

    return new Hover(markdown, range)
  }

  /**
   * 获取属性值中变量的悬停提示（非 {{ }} 场景）
   */
  private getVariableHover(document: TextDocument, word: string): Hover | null {
    // 查找变量定义
    const propInfos = getProp(document.fileName, 'prop', word)
    
    if (propInfos.length === 0) return null

    // 构建悬停提示内容
    const markdown = new MarkdownString()
    markdown.isTrusted = true
    markdown.supportHtml = true

    markdown.appendMarkdown(`### 🔍 变量: \`${word}\`\n\n`)

    propInfos.forEach((info, index) => {
      if (index > 0) markdown.appendMarkdown('\n\n---\n\n')
      
      markdown.appendMarkdown(`**定义：** \`${info.detail}\`\n\n`)
      
      const fileName = info.loc.uri.fsPath.split('/').pop()
      const line = info.loc.range.start.line + 1
      markdown.appendMarkdown(`**位置：** ${fileName}:${line}\n\n`)
    })

    markdown.appendMarkdown('\n💡 *提示：点击 Cmd/Ctrl + Click 可跳转到定义*')

    return new Hover(markdown)
  }

  /**
   * 从表达式中提取光标位置的变量信息
   */
  private extractVariableAtPosition(
    expression: string,
    cursorOffset: number
  ): { variable: string; rootVariable: string; isPropertyAccess: boolean } | null {
    const trimmedExpression = expression.trim()
    const trimOffset = expression.indexOf(trimmedExpression)
    const adjustedOffset = cursorOffset - trimOffset
    
    if (adjustedOffset < 0 || adjustedOffset > trimmedExpression.length) {
      return null
    }
    
    // 匹配属性访问表达式：identifier.property.subProperty
    const propertyRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*/g
    let match
    
    while ((match = propertyRegex.exec(trimmedExpression)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      
      // 检查光标是否在这个属性范围内
      if (adjustedOffset >= start && adjustedOffset <= end) {
        const fullProperty = match[0]
        const parts = fullProperty.split('.')
        const rootVariable = parts[0]
        const isPropertyAccess = parts.length > 1
        
        console.log(`[extractVariableAtPosition] 完整属性: ${fullProperty}, 根变量: ${rootVariable}`)
        
        return {
          variable: fullProperty,
          rootVariable,
          isPropertyAccess
        }
      }
    }
    
    // 如果没有找到精确匹配，尝试找最近的单词
    const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g
    let closestMatch = null
    let closestDistance = Infinity
    
    while ((match = wordRegex.exec(trimmedExpression)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      const distance = Math.min(
        Math.abs(adjustedOffset - start),
        Math.abs(adjustedOffset - end)
      )
      
      if (distance < closestDistance) {
        closestDistance = distance
        closestMatch = match[0]
      }
    }
    
    if (closestMatch) {
      return {
        variable: closestMatch,
        rootVariable: closestMatch,
        isPropertyAccess: false
      }
    }
    
    return null
  }
}
