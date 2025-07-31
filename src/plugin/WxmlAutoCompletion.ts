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
} from 'vscode'

import AutoCompletion from './AutoCompletion'

import { getLanguage, getLastChar } from './lib/helper'

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
    console.log('wxml AutoCompletion', char, getLastChar(document, new Position(position.line, position.character + 1)))
    // 打印wxml AutoCompletion和下一个字符
    switch (char) {
    // 根据当前字符执行不同的操作
      case '<':
        return this.createComponentSnippetItems(language, document, position)
        // 创建组件片段项
      case '\n': // 换行
      case ' ': // 空格
        // 如果后面紧跟字母数字或_不触发自动提示
        // (常用于手动调整缩进位置)
        // if (/[\w\d$_]/.test(getLastChar(document, new Position(position.line, position.character + 1)))) {
        //   return Promise.resolve([])
        // }
        // return [] as any
        return this.createComponentAttributeSnippetItems(language, document, position, true)
        // 创建组件属性片段项
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
        if (char >= 'a' && char <= 'z') {
        // 如果当前字符是字母，自动提示组件属性片段项
          // 输入属性时自动提示
          return this.createComponentAttributeSnippetItems(language, document, position)
        }
        return [] as any
    }
  }
}
