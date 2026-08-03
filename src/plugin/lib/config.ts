/******************************************************************
 MIT License http://www.opensource.org/licenses/mit-license.php
 Author Mora <qiuzhongleiabc@126.com> (https://github.com/qiu8310)
*******************************************************************/

import * as vscode from 'vscode'
import * as path from 'path'
import type { HTMLBeautifyOptions } from 'js-beautify'

import { Snippets } from '../res/snippets'
import { Options } from 'sass'

let listener: vscode.Disposable

export interface Config {
  getResolveRoots: (doc: vscode.TextDocument) => string[]
  /** wxml 格式化时一行中允许的最长的字符串长度 */
  formatMaxLineCharacters: number
  /** 是否在按下 Enter 键后出自动补全 */
  showSuggestionOnEnter: boolean
  /** 是否禁用自定义的组件补全 */
  disableCustomComponentAutocomponent: boolean
  /** 解析自定义组件的根目录 */
  resolveRoots: string[]
  /** 使用 LinkProvider 处理的标签属性 */
  linkAttributeNames: string[]
  /** 是否禁用颜色高亮 */
  disableDecorate: boolean
  /** 是否高亮复杂的语句 */
  decorateComplexInterpolation: boolean
  /** 自定义高亮样式 */
  decorateType: any
  /** 用户自定义的 snippets */
  snippets: { wxml?: Snippets; pug?: Snippets }

  /** 自我闭合的标签 */
  selfCloseTags: string[]

  /** 默认在启动时会自动相关文件关联的配置项，配置成功后会将此配置自动设置成 true，避免下次启动再重新配置 */
  disableAutoConfig: boolean

  /**
   * 禁止插件的format功能，防止设置"editor.formatOnSave": true了的同学format产生不可预期的错误
   *
   * https://github.com/wx-minapp/minapp-vscode/issues/83#issuecomment-958626391
   */
  disableFormat: boolean

  wxmlQuoteStyle: string
  pugQuoteStyle: string

  reserveTags: string[]

  /**
   * 创建组件时文件后缀类型
   */
  /** css文件 */
  cssExtname: 'wxss' | 'css' | 'styl' | 'less' | 'sass' | 'scss'
  /** js文件 */
  jsExtname: 'js' | 'coffee' | 'ts'
  /** wxml文件 */
  wxmlExtname: 'wxml' | 'vue' | 'wpy'


  /** 全局的样式文件 */
  globalStyleFiles: string[]
  /** 支持解析的样式文件后缀名 */
  styleExtensions: string[]
  /** wxml 格式化工具 */
  wxmlFormatter: 'wxml' | 'prettier' | 'prettyHtml' | 'jsBeautifyHtml'
  /** prettyHtml 格式化 */
  prettyHtml: Record<string, any>
  /** js-beautify.html 格式化 */
  jsBeautifyHtml: 'useCodeBuiltInHTML' | HTMLBeautifyOptions
  /** prettier 格式化 */
  prettier: Record<string, any>
  /** 关联类型 */
  documentSelector: string[]
  /** */
  sass: Options
  /** 当前项目根目录 (主要为了多仓库项目设置) */
  rootPath: string
  /**
   * 自定义组件属性名在补全时的命名风格
   * - camel: 补全用驼峰（如 userName）
   * - kebab: 补全用中划线（如 user-name）
   * - auto: 根据当前文件已有写法自动判断
   * 无论哪种风格，识别（hover/定义跳转/去重）都兼容驼峰与中划线互通
   */
  attrNameStyle: 'auto' | 'camel' | 'kebab'
}

export const config: Config = {
  formatMaxLineCharacters: 100,
  disableCustomComponentAutocomponent: false,
  showSuggestionOnEnter: false,
  resolveRoots: [],
  getResolveRoots,
  linkAttributeNames: [],
  disableDecorate: false,
  decorateComplexInterpolation: true,
  decorateType: {},
  snippets: {},
  selfCloseTags: [],
  disableAutoConfig: false,
  disableFormat: false,
  wxmlQuoteStyle: '"',
  pugQuoteStyle: '\'',
  reserveTags: [],
  globalStyleFiles: [],
  cssExtname: 'wxss',
  jsExtname: 'js',
  wxmlExtname: 'wxml',
  styleExtensions: [],
  wxmlFormatter: 'wxml',
  prettyHtml: {},
  jsBeautifyHtml: {},
  prettier: {},
  documentSelector: ['wxml'],
  sass: {},
  rootPath: '',
  attrNameStyle: 'auto',
}


function getConfig() {
  const minapp = vscode.workspace.getConfiguration('minapp-vscode')
  config.disableCustomComponentAutocomponent = minapp.get('disableCustomComponentAutocomponent', false)
  config.showSuggestionOnEnter = minapp.get('showSuggestionOnEnter', false)
  config.resolveRoots = minapp.get('resolveRoots', ['src', 'node_modules', 'miniprogram_npm'])
  config.linkAttributeNames = minapp.get('linkAttributeNames', ['src'])
  config.formatMaxLineCharacters = minapp.get('formatMaxLineCharacters', 100)
  config.disableDecorate = minapp.get('disableDecorate', true)
  config.decorateComplexInterpolation = minapp.get('decorateComplexInterpolation', true)
  config.decorateType = minapp.get('decorateType', {})
  config.snippets = minapp.get('snippets', {})
  config.selfCloseTags = minapp.get('selfCloseTags', [])
  config.disableAutoConfig = minapp.get('disableAutoConfig', false)
  config.disableFormat = minapp.get('disableFormat', false)
  config.wxmlQuoteStyle = minapp.get('wxmlQuoteStyle', '"')
  config.pugQuoteStyle = minapp.get('pugQuoteStyle', '\'')
  config.reserveTags = minapp.get('reserveTags', [])
  config.globalStyleFiles = minapp.get('globalStyleFiles', [])
  config.styleExtensions = minapp.get('styleExtensions', [])
  config.cssExtname = minapp.get('cssExtname', 'wxss')
  config.jsExtname = minapp.get('jsExtname', 'js')
  config.wxmlExtname = minapp.get('wxmlExtname', 'wxml')
  config.wxmlFormatter = minapp.get('wxmlFormatter', 'wxml')
  config.prettyHtml = minapp.get('prettyHtml', {})
  config.prettier = minapp.get('prettier', {})
  config.jsBeautifyHtml = minapp.get('jsBeautifyHtml', {})
  config.documentSelector = minapp.get('documentSelector', ['wxml'])
  config.sass = minapp.get('sass', {})
  config.rootPath = minapp.get('rootPath', '')
  config.attrNameStyle = minapp.get('attrNameStyle', 'auto')
}

function getResolveRoots(doc: vscode.TextDocument): string[] {
  const root = vscode.workspace.getWorkspaceFolder(doc.uri) as vscode.WorkspaceFolder
  if (!root) return []
  
  let roots = config.resolveRoots
  const workspaceRoot = root.uri.fsPath
  
  // 如果配置了 rootPath，使用它作为项目根目录
  const projectRoot = config.rootPath ? path.resolve(workspaceRoot, config.rootPath) : workspaceRoot
  
  if (config.rootPath) {
    // console.log(config, roots.map(r => path.resolve(config.rootPath, r)))
    roots = [...roots, ...roots.map(r => config.rootPath+ '/'+  r)]
  }
  
  // 解析所有配置的根目录
  const resolvedRoots = roots.map(r => path.resolve(workspaceRoot, r))
  
  // 将项目根目录添加到第一位，这样 /components/xxx 这样的绝对路径就能正确解析
  // 去重，避免重复添加
  return [projectRoot, ...resolvedRoots.filter(r => r !== projectRoot)]
}

export function configActivate(): void {
  listener = vscode.workspace.onDidChangeConfiguration(getConfig)
  getConfig()
}

export function configDeactivate(): void {
  listener.dispose()
}
