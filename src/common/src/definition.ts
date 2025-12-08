/******************************************************************
 MIT License http://www.opensource.org/licenses/mit-license.php
 Author Mora <qiuzhongleiabc@126.com> (https://github.com/qiu8310)
*******************************************************************/

import { Component, CustomOptions, getCustomComponents } from "./custom";
import { LanguageConfig } from "./dev";

export async function definitionTagName(tagName: string, lc: LanguageConfig, co?: CustomOptions): Promise<Component | undefined> {
  console.log(`[definitionTagName] 查找组件: ${tagName}`)
  console.log(`[definitionTagName] CustomOptions:`, co ? `文件: ${co.filename}` : '无')
  
  // 忽略原生标签和内置标签
  if (['wxs', 'include'].indexOf(tagName) !== -1 || lc.components.some(item => item.name === tagName)) {
    console.log(`[definitionTagName] ${tagName} 是原生/内置标签，跳过`)
    return undefined;
  }

  const components: Component[] = await getCustomComponents(co);
  console.log(`[definitionTagName] 找到 ${components.length} 个自定义组件:`, components.map(c => c.name).join(', '))
  
  for (const component of components) {
    if (component.name === tagName) {
      console.log(`[definitionTagName] ✓ 匹配到组件 ${tagName}, 路径: ${component.path}`)
      return component;
    }
  }

  console.log(`[definitionTagName] 未找到组件 ${tagName}`)
  return undefined;
}