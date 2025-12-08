/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Mora <qiuzhongleiabc@126.com> (https://github.com/qiu8310)
*******************************************************************/

import { ExtensionContext, commands, languages, workspace } from 'vscode'

import HoverProvider from './plugin/HoverProvider'
import { PropDefinitionProvider } from './plugin/PropDefinitionProvider'
import WxmlAutoCompletion from './plugin/WxmlAutoCompletion'
import WxmlDocumentHighlight from './plugin/WxmlDocumentHighlight'
import ActiveTextEditorListener from './plugin/ActiveTextEditorListener'
import { config, configActivate, configDeactivate } from './plugin/lib/config'
import { createMiniprogramComponent } from './commands/createMiniprogramComponent'
import { COMMANDS, CONTEXT_KEYS } from './commands/constants'

/**
 * 插件激活入口函数
 * 
 * 此函数在 VSCode 插件激活时被调用，负责注册所有的语言服务提供者和命令
 * 
 * 主要功能包括：
 * 1. 初始化插件配置
 * 2. 自动配置 VSCode 工作区设置（文件关联、emmet 支持等）
 * 3. 注册 WXML 模板语言的各项语言服务：
 *    - 自动补全（标签、属性、属性值、样式类名）
 *    - 悬浮提示（Hover）- 显示组件和属性的文档说明
 *    - 跳转定义（Definition）- 跳转到函数、属性、样式定义
 *    - 代码高亮 - 匹配的开始/结束标签高亮
 *    - 变量装饰 - 模板中 JS 变量的自定义样式显示
 * 4. 注册小程序组件创建命令
 * 
 * @param context - VSCode 扩展上下文，用于管理插件的生命周期和订阅
 */
export function activate(context: ExtensionContext): void {
  // 激活配置监听，加载用户配置
  configActivate()

  // 如果未禁用自动配置，则执行 VSCode 工作区设置的自动配置
  if (!config.disableAutoConfig) {
    autoConfig()
  }

  // 初始化各个功能提供者实例
  const autoCompletionWxml = new WxmlAutoCompletion(config) // WXML 语法自动补全
  const hoverProvider = new HoverProvider(config) // 悬浮提示提供者，显示组件和属性文档
  const documentHighlight = new WxmlDocumentHighlight(config) // 文档高亮提供者，高亮匹配的标签对
  const propDefinitionProvider = new PropDefinitionProvider(config) // 属性定义提供者，支持跳转到变量/函数/样式定义

  // 配置支持的文档选择器
  const wxml = config.documentSelector.map(l => schemes(l)) // WXML 文档类型
  const enter = config.showSuggestionOnEnter ? ['\n'] : [] // 是否支持回车触发自动补全
  
  // 添加小写字母作为触发字符，支持在 class 属性中输入任意字母时触发补全
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')

  // 注册所有功能到 VSCode，添加到订阅列表中
  context.subscriptions.push(
    // 注册命令：创建小程序组件（右键菜单）
    commands.registerCommand(COMMANDS.createComponent, createMiniprogramComponent),

    // 注册活动文本编辑器监听器：为模板中的 JS 变量添加自定义样式装饰
    new ActiveTextEditorListener(config),

    // 注册 Hover 提供者：鼠标悬浮时显示组件、属性的文档说明和样式定义
    languages.registerHoverProvider(wxml, hoverProvider),

    // 注册文档高亮提供者：点击标签时高亮匹配的开始/结束标签
    languages.registerDocumentHighlightProvider(wxml, documentHighlight),

    // 注册定义提供者：支持跳转到函数、属性、样式类的定义
    languages.registerDefinitionProvider(wxml, propDefinitionProvider),

    // 注册 WXML 自动补全提供者
    // 触发字符：< 标签, 空格 属性, : @ . - 指令/事件修饰符, " ' 属性值, / 闭合标签, a-z 字母（用于 class 等属性值补全）
    languages.registerCompletionItemProvider(
      wxml,
      autoCompletionWxml,
      '<',  // 触发标签补全
      ' ',  // 触发属性补全和 class 内空格后补全
      ':',  // 触发绑定变量补全（wx:for, bind:tap 等）
      '@',  // 触发事件绑定补全
      '.',  // 触发修饰符补全
      '-',  // 触发连字符属性补全
      '"',  // 触发属性值补全
      "'",  // 触发属性值补全
      '/',  // 触发闭合标签补全
      '{',  // 触发 {{ }} 表达式内变量补全
      ...letters, // 触发字母补全（class 属性值等）
      ...enter // 可选的回车触发
    )
  )

  // 设置上下文变量，标记插件已激活
  // 用于控制右键菜单等功能的显示
  commands.executeCommand('setContext', CONTEXT_KEYS.init, true)
}

/**
 * 插件停用时的清理函数
 * 
 * 当插件被禁用或 VSCode 关闭时调用
 * 负责清理配置监听器和释放资源
 */
export function deactivate(): void {
  configDeactivate()
}

/**
 * 自动配置 VSCode 工作区设置
 * 
 * 此函数在插件首次激活时执行，用于自动配置 VSCode 的工作区设置
 * 配置完成后会自动设置 disableAutoConfig 为 true，避免重复配置
 * 
 * 配置内容包括：
 * 1. 文件关联（files.associations）：
 *    - *.cjson -> jsonc （小程序配置文件支持注释）
 *    - *.wxss -> css （小程序样式文件）
 *    - *.wxs -> javascript （小程序脚本文件）
 * 
 * 2. Emmet 语言支持（emmet.includeLanguages）：
 *    - wxml -> html （使 WXML 支持 Emmet 快捷输入）
 * 
 * @remarks
 * - 只会添加不存在的配置项，不会覆盖用户已有的配置
 * - 配置应用于全局用户设置（第三个参数为 true）
 */
function autoConfig() {
  // 获取 VSCode 配置对象
  const c = workspace.getConfiguration()
  
  // 定义需要更新的配置项
  const updates: { key: string; map: any }[] = [
    {
      // 文件关联配置：让 VSCode 正确识别小程序相关文件类型
      key: 'files.associations',
      map: {
        '*.cjson': 'jsonc',      // 小程序配置文件（支持注释的 JSON）
        '*.wxss': 'css',          // 小程序样式文件
        '*.wxs': 'javascript',    // 小程序脚本文件
      },
    },
    {
      // Emmet 支持配置：让 WXML 文件支持 Emmet 语法
      key: 'emmet.includeLanguages',
      map: {
        wxml: 'html',  // 将 wxml 映射为 html，启用 Emmet 功能
      },
    },
    {
      // 自动补全配置：在 WXML 的字符串（属性值）中启用持续建议
      key: '[wxml]',
      map: {
        'editor.quickSuggestions': {
          strings: true  // 在字符串中启用自动补全（用于 class 属性等）
        }
      },
    },
  ]

  // 遍历配置项，合并到现有配置中
  updates.forEach(({ key, map }) => {
    const oldMap = c.get(key, {}) as any // 获取当前配置
    
    // 特殊处理：语言特定配置 [wxml]
    if (key === '[wxml]') {
      // 合并嵌套的 editor.quickSuggestions 配置
      const oldQuickSuggestions = oldMap['editor.quickSuggestions'] || {}
      const newQuickSuggestions = {
        ...oldQuickSuggestions,
        ...map['editor.quickSuggestions']
      }
      c.update(key, {
        ...oldMap,
        'editor.quickSuggestions': newQuickSuggestions
      }, true)
    } else {
      // 普通配置项处理
      const appendMap: any = {} // 用于存储需要新增的配置
      
      // 找出需要新增的配置项（不覆盖已有配置）
      Object.keys(map).forEach(k => {
        if (!oldMap.hasOwnProperty(k)) appendMap[k] = map[k]
      })
      
      // 如果有新增的配置项，则更新配置
      if (Object.keys(appendMap).length) {
        c.update(key, { ...oldMap, ...appendMap }, true) // true 表示全局配置
      }
    }
  })

  // 配置完成后，设置 disableAutoConfig 为 true，避免下次启动重复配置
  c.update('minapp-vscode.disableAutoConfig', true, true)
}

/**
 * 创建文档选择器对象
 * 
 * 用于指定语言服务提供者支持的文档类型
 * 
 * @param key - 语言标识符（如 'wxml', 'wxml-pug', 'vue'）
 * @returns 文档选择器对象，包含 scheme 和 language 属性
 * 
 * @example
 * schemes('wxml') // => { scheme: 'file', language: 'wxml' }
 */
export function schemes(key: string): any {
  return { scheme: 'file', language: key }
}
