import * as fs from 'fs'
import * as path from 'path'
import { TextDocument, Position } from 'vscode'
import { quickParseStyle } from './quickParseStle'
import { config, Config } from './config'
import { getRoot } from './helper'

export interface Style {
  name: string
  pos: Position
  doc: string
}

export interface StyleFile {
  file: string
  styles: Style[]
  // 引入的样式文件列表
  imports: string[]
}

interface CachedStyleFile {
  mtime: Date
  value: StyleFile
  // 文件内容 hash，用于检测内容变化
  contentHash?: string
}

const fileCache: { [file: string]: CachedStyleFile } = {}

// 样式内容 hash 缓存，避免重复计算
function getContentHash(content: string): string {
  // 简单的 hash 函数（FNV-1a）
  let hash = 2166136261
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

// function isScss(file: string): boolean {
//   return /\.[ls][eac]ss/.test(file)
// }

function getAbsPath(doc: TextDocument, inputPath: string) {
  const rootPath = path.resolve(getRoot(doc) as string, config.rootPath)
  if (inputPath.startsWith('/')) {
    // 以根目录为基准
    return path.join(rootPath, inputPath)
  } else {
    // 以当前工作目录或指定目录为基准
    return path.resolve(path.dirname(doc.fileName), inputPath)
  }
}

export async function parseStyleFile(doc: TextDocument, file: string): Promise<StyleFile[]> {
  try {
    let cache = fileCache[file]
    // const editor = window.visibleTextEditors.find(e => e.document.fileName === file)
    // if (editor) {
    //   const content = isScss(file) ? loadScss({ data: editor.document.getText(), file }) : editor.document.getText()
    //   // 如果引入了其他样式文件，解析其他样式文件
    //   if (/@import\s+['"]([^'"]+)['"]/.test(content)) {
    //     const otherImporters = content.match(/@import\s+['"]([^'"]+)['"]/g)
    //     console.log('加载引入样式', otherImporters)
    //   }
    //   return [
    //     {
    //       file,
    //       styles: await quickParseStyle(content),
    //       imports: [],
    //     },
    //   ]
    // } else {
      // 文件是否修改（增强版：mtime + 内容 hash）
      const fileIsModified = (filePath: string): boolean => {
        try {
          const stat = fs.statSync(filePath)
          const c = fileCache[filePath]
          
          if (!c) return true // 无缓存
          
          // 时间戳未变化，检查引入文件
          if (stat.mtime <= c.mtime) {
            if (c.value.imports.length && c.value.imports.some(f => fileIsModified(f))) {
              return true
            }
            return false
          }
          
          // 时间戳变化，但可能只是 touch，检查内容 hash
          if (c.contentHash) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8')
              const newHash = getContentHash(content)
              if (newHash === c.contentHash) {
                // 内容未变，更新 mtime 避免重复检查
                c.mtime = stat.mtime
                return false
              }
            } catch (err) {
              // 读取失败，认为已修改
              return true
            }
          }
          
          return true
        } catch (err) {
          return true // 文件不存在或无法访问
        }
      }
      // 获得这个文件所有引入的样式文件缓存
      const getImportFiles = (filePath: string): StyleFile[] => {
        const c = fileCache[filePath]
        if (c) {
          return [c.value, ...c.value.imports.map(f => getImportFiles(f)).flat()]
        }
        return []
      }
      if (!fileIsModified(file)) {
        return getImportFiles(file)
      }

      const stat = fs.statSync(file)
      // 直接读取文件内容，不再使用 loadScss
      const rawContent = fs.readFileSync(file, 'utf-8')
      const contentHash = getContentHash(rawContent)
      
      try {
        cache = {
          mtime: stat.mtime,
          contentHash: contentHash,
          value: {
            file,
            styles: [],
            imports: [],
          },
        }
        // 这里先为解析过的文件设置一个空数组，防止循环依赖导致死循环
        fileCache[file] = cache
        // 如果引入了其他样式文件，解析其他样式文件
        let url: null | RegExpExecArray = null
        let otherImporters: StyleFile[] = []
        const regex = new RegExp(/@import\s+['"]([^'"]+)['"]/, 'g')
        while ((url = regex.exec(rawContent)) !== null) {
          const fileUrl = getAbsPath(doc, url[1])
          const a = await parseStyleFile(doc, fileUrl)
          console.log('读取引入样式')
          otherImporters = otherImporters.concat(a)
        }
        cache.value.imports = otherImporters.map(f => f.file)
        console.log('读取主样式')
        // 将原始内容包装成 quickParseStyle 所需的格式
        cache.value.styles = await quickParseStyle({ css: rawContent, map: undefined }, { unique: false })
        if (otherImporters.length) {
          return [cache.value, ...otherImporters]
        }
        
        return [cache.value]
      } catch (error) {
        delete fileCache[file]
        throw error
      }
    // }
  } catch (e) {
    return [
      {
        file,
        styles: [],
        imports: [],
      },
    ]
  }
}

export function getClass(doc: TextDocument, config: Config): Promise<StyleFile[]> {
  return Promise.all([getLocalClass(doc, config), getGlobalClass(doc, config)]).then(results => results.flat())
}

export async function getLocalClass(doc: TextDocument, config: Config): Promise<StyleFile[]> {
  const exts = config.styleExtensions || []
  const dir = path.dirname(doc.fileName)
  const basename = path.basename(doc.fileName, path.extname(doc.fileName))
  const localFile = exts.map(e => path.join(dir, basename + '.' + e)).find(f => fs.existsSync(f))
  return localFile ? await parseStyleFile(doc, localFile) : []
}

export async function getGlobalClass(doc: TextDocument, config: Config): Promise<StyleFile[]> {
  const root = getRoot(doc) as string
  if (!root) return []
  const files = (config.globalStyleFiles || []).map(f => path.resolve(root, f))
  const results = await Promise.all(files.map(file => parseStyleFile(doc, file)))
  return results.flat()
}
