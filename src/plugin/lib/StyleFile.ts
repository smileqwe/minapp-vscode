import * as fs from 'fs'
import * as path from 'path'
import { TextDocument, window, Position } from 'vscode'
import { quickParseStyle } from './quickParseStle'
import { config, Config } from './config'
import { getRoot } from './helper'
import loadScss from './loadScss'

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

const fileCache: { [file: string]: { mtime: Date; value: StyleFile } } = {}

function isScss(file: string): boolean {
  return /\.[ls][eac]ss/.test(file)
}

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

export function parseStyleFile(doc: TextDocument, file: string): StyleFile[] {
  try {
    let cache = fileCache[file]
    const editor = window.visibleTextEditors.find(e => e.document.fileName === file)
    if (editor) {
      const content = isScss(file) ? loadScss({ data: editor.document.getText(), file }) : editor.document.getText()
      // 如果引入了其他样式文件，解析其他样式文件
      if (/@import\s+['"]([^'"]+)['"]/.test(content)) {
        const otherImporters = content.match(/@import\s+['"]([^'"]+)['"]/g)
        console.log('加载引入样式', otherImporters)
      }
      return [
        {
          file,
          styles: quickParseStyle(content),
          imports: [],
        },
      ]
    } else {
      // 文件是否修改
      const fileIsModified = (filePath: string) => {
        const stat = fs.statSync(filePath)
        const c = fileCache[filePath]
        if (
          c &&
          stat.mtime <= c.mtime &&
          (!c.value.imports.length || c.value.imports.every(f => !fileIsModified(f)))
        ) {
          return false
        }
        return true
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
      try {
        cache = {
          mtime: stat.mtime,
          value: {
            file,
            styles: [],
            imports: [],
          },
        }
        // 这里先为解析过的文件设置一个空数组，防止循环依赖导致死循环
        fileCache[file] = cache
        const content = loadScss({ file })
        // 如果引入了其他样式文件，解析其他样式文件
        let url: null | RegExpExecArray = null
        let otherImporters: StyleFile[] = []
        const regex = new RegExp(/@import\s+['"]([^'"]+)['"]/, 'g')
        while ((url = regex.exec(content)) !== null) {
          const fileUrl = getAbsPath(doc, url[1])
          const a = parseStyleFile(doc, fileUrl)
          console.log('读取引入样式')
          otherImporters = otherImporters.concat(a)
        }
        cache.value.imports = otherImporters.map(f => f.file)
        console.log('读取主样式')
        cache.value.styles = quickParseStyle(content, { unique: false })
        if (otherImporters.length) {
          return [cache.value, ...otherImporters]
        }
      } catch (error) {
        delete fileCache[file]
      }

      return [cache.value]
    }
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

export function getClass(doc: TextDocument, config: Config) {
  return [...getLocalClass(doc, config), ...getGlobalClass(doc, config)]
}

export function getLocalClass(doc: TextDocument, config: Config) {
  const exts = config.styleExtensions || []
  const dir = path.dirname(doc.fileName)
  const basename = path.basename(doc.fileName, path.extname(doc.fileName))
  const localFile = exts.map(e => path.join(dir, basename + '.' + e)).find(f => fs.existsSync(f))
  return localFile ? parseStyleFile(doc, localFile) : []
}

export function getGlobalClass(doc: TextDocument, config: Config) {
  const root = getRoot(doc) as string
  if (!root) return []
  const files = (config.globalStyleFiles || []).map(f => path.resolve(root, f))
  return files.map(file => parseStyleFile(doc, file)).flat()
}
