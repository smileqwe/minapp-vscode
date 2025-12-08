/******************************************************************
 MIT License http://www.opensource.org/licenses/mit-license.php
 Author Mora <qiuzhongleiabc@126.com> (https://github.com/qiu8310)
*******************************************************************/

import { ConditionalCacheableFile, readdir, readFile, exists, stat } from './lib/'
import { JSON_REGEXP, Component } from './dev/'
import { map, series } from './mora/async';
import { parseAttrs } from './parseAttrs'
import { parseAttrsWithAST } from './parseAttrsAST'
import * as JSON5 from 'json5'
import * as path from 'path'
import { noderequire } from '../../utils/noderequire';

const JSON_CACHE: { [key: string]: ConditionalCacheableFile } = {}

export interface CustomOptions {
  filename: string
  resolves?: string[]
}

export { Component }

export async function getCustomComponents(co?: CustomOptions): Promise<Component[]> {
  if (!co) {
    console.log('[getCustomComponents] 无 CustomOptions，返回空数组')
    return []
  }
  console.log(`[getCustomComponents] 解析文件: ${co.filename}`)
  console.log(`[getCustomComponents] resolves 路径:`, co.resolves)
  
  const f = getCachedJsonFile(co.filename)
  try {
    const data = await f.getContent()
    const jsonfile = f.filename as string
    console.log(`[getCustomComponents] JSON 文件路径: ${jsonfile}`)
    
    if (data && data.usingComponents) {
      console.log(`[getCustomComponents] usingComponents 配置:`, data.usingComponents)
      return await map(
        Object.keys(data.usingComponents),
        async name => {
          const filepath = data.usingComponents[name]
          console.log(`[getCustomComponents] 解析组件: ${name} -> ${filepath}`)
          try {
            const comp = await parseComponentFile(filepath, jsonfile, co.resolves)
            comp.name = name
            console.log(`[getCustomComponents] ✓ 组件解析成功: ${name}, 路径: ${comp.path}`)
            return comp
          } catch (e) {
            console.log(`[getCustomComponents] ✗ 组件解析失败: ${name}`, e)
            return { name } as Component
          }
        },
        0
      )
    } else {
      console.log('[getCustomComponents] 未找到 usingComponents 配置')
    }
  } catch (e) {
    console.log('[getCustomComponents] 读取 JSON 文件失败:', e)
  }

  return []
}

async function parseComponentFile(
  filepath: string,
  refFile: string,
  resolves: string[] | undefined
): Promise<Component> {
  console.log(`[parseComponentFile] 开始解析: ${filepath}`)
  console.log(`[parseComponentFile] 参考文件: ${refFile}`)
  console.log(`[parseComponentFile] resolves:`, resolves)
  
  if (filepath.startsWith('~')) filepath = filepath.substr(1)
  resolves = resolves || []
  
  const localResolves = filepath.startsWith('.')
    ? [path.dirname(refFile)] // 只使用相对目录
    : filepath.startsWith('/')
    ? resolves // 只使用绝对目录
    : [path.dirname(refFile), ...resolves] // 使用相对和绝对目录

  console.log(`[parseComponentFile] 使用的搜索根目录 (${localResolves.length}):`, localResolves)

  let found: string | undefined
  await series(localResolves, async root => {
    if (found) return

    await series(['', '.js', '.ts'], async ext => {
      if (found) return
      const f = path.join(root, filepath + ext)
      console.log(`[parseComponentFile] 尝试路径: ${f}`)
      try {
        const stats = await stat(f)
        if (stats.isFile()) {
          console.log(`[parseComponentFile] ✓ 找到文件: ${f}`)
          found = f
        } else if (stats.isDirectory() && ext === '') {
          console.log(`[parseComponentFile] 发现目录: ${f}，查找 index 文件`)
          // 解析 index 文件 或 package.json 中的 main 文件
          if (f.includes('node_modules')) {
            try {
              const pkg = noderequire(path.join(f, 'package.json'))
              if (pkg.main) {
                found = path.resolve(f, pkg.main)
                console.log(`[parseComponentFile] ✓ 从 package.json 找到: ${found}`)
              }
            } catch (e) {}
          }

          if (!found) {
            // 看看有没有 index.ts 或 index.js
            const f1 = path.join(f, 'index.js')
            const f2 = path.join(f, 'index.ts')
            console.log(`[parseComponentFile] 检查 index 文件: ${f1}, ${f2}`)
            if (await exists(f1)) {
              found = f1
              console.log(`[parseComponentFile] ✓ 找到 index.js: ${found}`)
            } else if (await exists(f2)) {
              found = f2
              console.log(`[parseComponentFile] ✓ 找到 index.ts: ${found}`)
            }
          }
        }
      } catch (e) {
        console.log(`[parseComponentFile] ✗ 路径不存在或无法访问: ${f}`)
      }
    })
  })

  if (found) {
    console.log(`[parseComponentFile] 最终找到文件: ${found}`)
    const f = getCachedJsonFile(found)
    const data = await f.getContent()
    if (data && data.minapp && data.minapp.component) {
      console.log(`[parseComponentFile] 使用 minapp.component 配置`)
      return data.minapp.component
    }
    // 实时解析
    const content = (await readFile(found)).toString()
    
    // 优先使用 AST 解析（支持 Object.assign、扩展运算符等）
    let attrs = parseAttrsWithAST(content)
    console.log(`[parseComponentFile] AST 解析结果: ${attrs.length} 个属性`)
    
    // 如果 AST 解析失败，回退到旧的正则表达式解析
    if (!attrs.length) {
      console.log(`[parseComponentFile] AST 解析为空，尝试正则表达式解析`)
      attrs = parseAttrs(content)
      console.log(`[parseComponentFile] 正则解析结果: ${attrs.length} 个属性`)
    }
    
    if (attrs.length) {
      console.log(`[parseComponentFile] 解析到 ${attrs.length} 个属性`)
      return { attrs, path: found } as any
    }
    console.log(`[parseComponentFile] 返回基本组件信息`)
    return { path: found } as any;
  }
  console.log(`[parseComponentFile] ✗ 未找到组件文件`)
  return {} as any
}

function getCachedJsonFile(filename: string) {
  const dir = path.dirname(filename)
  const base = path.basename(filename, path.extname(filename))
  const cacheKey = path.join(dir, base)
  if (!JSON_CACHE[cacheKey]) {
    JSON_CACHE[cacheKey] = new ConditionalCacheableFile(
      () => getJsonFilePath(dir, base),
      (name, buf) => JSON5.parse(buf.toString())
    )
  }
  return JSON_CACHE[cacheKey]
}

/**
 * 根据目录中的某个文件来获取当前目录中同名的 json 文件
 *
 * @export
 * @param {string} filename 目录中的某个文件
 */
async function getJsonFilePath(dir: string, base: string) {
  base += '.'
  const names = await readdir(dir)
  const name = names.find(n => n.startsWith(base) && !n.substr(base.length).includes('.') && JSON_REGEXP.test(n))
  return name ? path.join(dir, name) : undefined
}
