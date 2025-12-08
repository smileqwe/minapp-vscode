/******************************************************************
 MIT License http://www.opensource.org/licenses/mit-license.php
 Author Mora <qiuzhongleiabc@126.com> (https://github.com/qiu8310)
*******************************************************************/

import { MarkdownString, TextDocument } from 'vscode'
import { CustomOptions, getCustomComponents } from './custom'
import { components, getComponentMarkdown, getComponentAttrMarkdown, ComponentAttr, LanguageConfig } from './dev'
import { getClass } from '../../plugin/lib/StyleFile'
import { config } from '../../plugin/lib/config'
import { getRoot } from '../../plugin/lib/helper'
import * as path from 'path'

export async function hoverComponentMarkdown(tag: string, lc: LanguageConfig, co?: CustomOptions) {
  const comp = await getComponent(tag, lc, co)
  return comp ? getComponentMarkdown(comp) : undefined
}

export async function hoverComponentAttrMarkdown(tag: string, name: string, lc: LanguageConfig, co?: CustomOptions) {
  const comp = await getComponent(tag, lc, co)
  if (!comp) return
  const attrs = comp.attrs || []

  let attr: ComponentAttr | undefined
  attrs.find(a => {
    if (a.name === name) {
      attr = a
    } else if (a.subAttrs) {
      a.subAttrs.some(s =>
        s.attrs.some(sa => {
          if (sa.name === name) {
            attr = a
          }
          return !!attr
        })
      )
    }
    return !!attr
  })

  return attr ? getComponentAttrMarkdown(attr) : undefined
}

async function getComponent(tagName: string, lc: LanguageConfig, co?: CustomOptions) {
  let comp = [...lc.components, ...components].find(c => c.name === tagName)
  if (!comp) {
    comp = (await getCustomComponents(co)).find(c => c.name === tagName)
  }
  return comp
}

/**
 * 检查选择器是否匹配当前元素的所有类名
 * 
 * 示例：
 * - .fixed-bg 匹配 ["fixed-bg"] ✓
 * - .fixed-bg.top 匹配 ["fixed-bg"] ✗ (缺少 top)
 * - .fixed-bg.top 匹配 ["fixed-bg", "top"] ✓
 * - .parent .fixed-bg 匹配 ["fixed-bg"] ✓ (忽略祖先选择器)
 * 
 * @param selector - CSS 选择器（可能包含多个类名、伪类等）
 * @param hoveredClass - 鼠标悬停的类名
 * @param allClasses - 当前元素的所有类名
 * @returns 是否匹配
 */
function isSelectorMatch(selector: string, hoveredClass: string, allClasses: string[]): boolean {
  // 如果没有提供所有类名，使用旧的简单匹配（向后兼容）
  if (!allClasses || allClasses.length === 0) {
    return selector.includes(hoveredClass)
  }
  
  // 提取选择器中最后一个元素的类名（忽略祖先选择器如 .parent .child）
  // 示例：".parent > .child.active:hover" → "child.active:hover"
  const lastPart = selector.split(/\s+/).pop() || ''
  
  // 提取所有类名（去除伪类、伪元素、属性选择器等）
  // 示例："div.a.b:hover::before[data-x]" → ["a", "b"]
  const classMatches = lastPart.match(/\.[\w-]+/g)
  if (!classMatches) return false
  
  const requiredClasses = classMatches.map(c => c.slice(1)) // 去掉前面的 .
  
  // 必须包含悬停的类名
  if (!requiredClasses.includes(hoveredClass)) {
    return false
  }
  
  // 检查当前元素是否包含所有必需的类名
  return requiredClasses.every(rc => allClasses.includes(rc))
}

export async function classHover(
  doc: TextDocument, 
  classname: string, 
  allClasses?: string[]
): Promise<MarkdownString | null> {
  const styleFile = await getClass(doc, config)
  const root = getRoot(doc)
  const hoverText = new MarkdownString()
  
  console.log(`[classHover] 悬停类名: ${classname}, 元素所有类名: [${(allClasses || []).join(', ')}]`)
  
  styleFile.forEach((styleFile, sfi) => {
    styleFile.styles.forEach((style, sty) => {
      const selector = style.doc.split('{')[0].trim()
      const isMatch = isSelectorMatch(selector, classname, allClasses || [])
      
      console.log(`[classHover] 检查选择器: "${selector}", 匹配结果: ${isMatch}`)
      
      // 只有当类名匹配且选择器也匹配当前元素时才显示
      if (style.name === classname && isMatch) {
        const filePath = root ? path.relative(root, styleFile.file) : path.basename(styleFile.file)
        hoverText.appendMarkdown(`<span style="color:#999">${filePath}</span>`).appendCodeblock(style.doc, 'css')
      }
    })
  })
  
  return hoverText.value ? hoverText : null
}
