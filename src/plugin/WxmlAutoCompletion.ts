/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Mora <qiuzhongleiabc@126.com> (https://github.com/qiu8310)
*******************************************************************/

import {
  Position,
  CancellationToken,
  CompletionItemProvider,
  TextDocument,
  CompletionItem,
  CompletionContext,
  CompletionTriggerKind,
} from 'vscode'

import AutoCompletion from './AutoCompletion'

import { getLanguage, getLastChar } from './lib/helper'
import { getTagAtPosition } from './getTagAtPosition/'

// 导出一个默认类，继承自AutoCompletion，并实现CompletionItemProvider接口
export default class extends AutoCompletion implements CompletionItemProvider {
  id = 'wxml' as const

  provideCompletionItems(
  // 提供自动完成项
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: CompletionContext
  ): Promise<CompletionItem[]> {
    if (token.isCancellationRequested) {
    // 如果取消请求，返回空数组
      return Promise.resolve([])
    }
    const language = getLanguage(document, position)
    // 获取当前语言
    if (!language) return [] as any
    // 如果没有语言，返回空数组

    const char = context.triggerCharacter || getLastChar(document, position)
    // 获取当前字符
    
    // 调试日志
    console.log('wxml AutoCompletion 触发字符:', char, '| triggerKind:', context.triggerKind, '(1=手动 2=触发字符 0=重新触发)')
    
    // 重要：当 triggerKind 为 Invoke (手动触发或输入字母时的默认触发)
    // 这种情况下 triggerCharacter 为 undefined，我们需要根据当前位置判断
    if (context.triggerKind === CompletionTriggerKind.Invoke || 
        context.triggerKind === CompletionTriggerKind.TriggerForIncompleteCompletions) {
      // 检查是否在 {{ }} 表达式内
      const range = document.getWordRangeAtPosition(position, /\{\{[^}]*\}\}/)
      if (range) {
        console.log('[WxmlAutoCompletion] 检测到在 {{ }} 表达式内，触发变量补全')
        const fullText = document.getText(range)
        const cursorOffset = document.offsetAt(position) - document.offsetAt(range.start) - 2 // 减去 '{{'
        const beforeCursor = fullText.substring(2, 2 + cursorOffset) // 跳过 '{{'
        // 提取当前输入的单词作为前缀
        const match = beforeCursor.match(/[a-zA-Z_$][a-zA-Z0-9_$]*$/)
        const prefix = match ? match[0] : ''
        console.log('[WxmlAutoCompletion] 提取前缀:', prefix, '| beforeCursor:', beforeCursor)
        return Promise.resolve(this.autoCompleteProps(document, prefix))
      }
      
      // 尝试提供补全（会自动判断是否在 class 属性中）
      return this.createComponentAttributeSnippetItems(language, document, position)
    }
    
    switch (char) {
    // 根据当前字符执行不同的操作
      case '<':
        return this.createComponentSnippetItems(language, document, position)
        // 创建组件片段项
      case '{': { // {{ 表达式
        // 检查前一个字符是否也是 {
        const prevChar = getLastChar(document, new Position(position.line, position.character - 1))
        if (prevChar === '{') {
          console.log('[WxmlAutoCompletion] 检测到 {{ 开始，触发变量补全')
          return Promise.resolve(this.autoCompleteProps(document, ''))
        }
        return [] as any
      }
      case '\n': // 换行
      case ' ': { // 空格
        // 智能判断：如果在 class 属性值里，只触发 class 补全；否则触发属性名补全
        const tag = getTagAtPosition(document, position)
        const isInClassAttr = !!(tag && tag.isOnAttrValue && 
                              (tag.attrName === 'class' || /^[\w\d-]+-class$/.test(tag.attrName || '')))
        return this.createComponentAttributeSnippetItems(language, document, position, isInClassAttr)
        // 创建组件属性片段项
      }
      case '"':
      case "'":
        return this.createComponentAttributeSnippetItems(language, document, position)
        // 创建组件属性片段项
      case ':': // 绑定变量 （也可以是原生小程序的控制语句或事件，如 wx:for, bind:tap）
      case '@': // 绑定事件
      case '-': // v-if
      case '.': // 变量或事件的修饰符
        return this.createSpecialAttributeSnippetItems(language, document, position)
        // 创建特殊属性片段项
      case '/': // 闭合标签
        return this.createCloseTagCompletionItem(document, position)
        // 创建闭合标签完成项
      default:
        // 如果当前字符是小写字母（a-z），尝试触发补全
        // 这包括：class 属性值补全、属性名补全等
        if (char >= 'a' && char <= 'z') {
          // 输入属性名或属性值时自动提示
          // onlyClass=false 表示会尝试多种补全：属性名、class 值、方法名等
          return this.createComponentAttributeSnippetItems(language, document, position)
        }
        return [] as any
    }
  }
}
