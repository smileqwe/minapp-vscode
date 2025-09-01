import { getFileContent, getPositionFromIndex } from './helper'
import * as path from 'path'
import * as fs from 'fs'
import { Location, Uri, Position, Range, window } from 'vscode'
import * as ts from 'typescript'

interface PropInfo {
  loc: Location
  name: string
  detail: string
}
/**
 * js/ts 文件映射缓存
 */
const wxJsMapCache = new Map<string, string>()
/**
 * 结果缓存
 */
const resultCache = new Map<string, { version: number; data: PropInfo[] }>()

/**
 * 保留字段,
 * 用于无限制匹配式函数过滤
 * `if(x){}` 等满足函数正
 */
// const reservedWords = ['if', 'switch', 'catch', 'while', 'for', 'constructor']

function parseScriptFile(file: string, type: string, prop: string) {
  const content = getFileContent(file)
  const locs: PropInfo[] = []

  try {
    // 创建TypeScript源文件
    const sourceFile = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') || file.endsWith('.jsx')
        ? ts.ScriptKind.TSX
        : file.endsWith('.ts')
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS
    )

    // 遍历AST节点
    function visit(node: ts.Node) {
      if (type === 'prop') {
        // 查找属性定义
        if (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
          const name = getPropertyName(node)
          if (name === prop) {
            addLocation(node, name, getPropertyDetail(node))
          }
        }
        // 查找变量声明
        // else if (ts.isVariableDeclaration(node)) {
        //   // 处理解构赋值和普通变量声明
        //   const bindingNames = getBindingNames(node.name)
        //   bindingNames.forEach(bindingName => {
        //     if (bindingName === prop) {
        //       addLocation(node, bindingName, `${ts.SyntaxKind[node.kind]}: ${bindingName}`)
        //     }
        //   })
        // }
        // 查找参数声明（函数参数中的解构）
        else if (ts.isParameter(node)) {
          const bindingNames = getBindingNames(node.name)
          bindingNames.forEach(bindingName => {
            if (bindingName === prop) {
              addLocation(node, bindingName, `parameter: ${bindingName}`)
            }
          })
        }
        // 查找绑定元素（解构赋值中的具体元素）
        else if (ts.isBindingElement(node)) {
          const bindingNames = getBindingNames(node.name)
          bindingNames.forEach(bindingName => {
            if (bindingName === prop) {
              addLocation(node, bindingName, `binding: ${bindingName}`)
            }
          })
        } else if (ts.isIdentifier(node)) {
          const name = node.getText(sourceFile)
          if (name === prop) {
            addLocation(node, name, `${ts.SyntaxKind[node.kind]}: ${name}`)
          }
        }
      } else if (type === 'method') {
        // 查找方法定义
        if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
          const name = getPropertyName(node)
          if (name === prop) {
            addLocation(node, name, getMethodDetail(node))
          }
        }
        // 查找函数式属性
        else if (ts.isPropertyAssignment(node)) {
          const name = getPropertyName(node)
          if (name === prop && isFunctionLikeExpression(node.initializer)) {
            addLocation(node, name, getFunctionDetail(node))
          }
        }
        // 查找函数声明
        else if (ts.isFunctionDeclaration(node)) {
          const name = node.name?.getText(sourceFile)
          if (name === prop) {
            addLocation(node, name, getFunctionDeclarationDetail(node))
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    function getPropertyName(
      node:
        | ts.PropertyAssignment
        | ts.PropertyDeclaration
        | ts.PropertySignature
        | ts.MethodDeclaration
        | ts.MethodSignature
    ): string {
      if (ts.isIdentifier(node.name)) {
        return node.name.text
      } else if (ts.isStringLiteral(node.name)) {
        return node.name.text
      } else if (ts.isComputedPropertyName(node.name)) {
        return node.name.getText(sourceFile)
      }
      return node.name?.getText(sourceFile) || ''
    }

    function isFunctionLikeExpression(node: ts.Expression): boolean {
      return (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        (ts.isCallExpression(node) && node.expression.getText(sourceFile).includes('function'))
      )
    }

    function getPropertyDetail(node: ts.PropertyAssignment | ts.PropertyDeclaration | ts.PropertySignature): string {
      const name = getPropertyName(node)
      if (ts.isPropertyAssignment(node)) {
        return `${name}: ${node.initializer.getText(sourceFile).substring(0, 50)}...`
      }
      return `${name}: ${node.type?.getText(sourceFile) || 'any'}`
    }

    function getMethodDetail(node: ts.MethodDeclaration | ts.MethodSignature): string {
      const name = getPropertyName(node)
      const params = node.parameters.map(p => p.getText(sourceFile)).join(', ')
      const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : ''
      return `${name}(${params})${returnType}`
    }

    function getFunctionDetail(node: ts.PropertyAssignment): string {
      const name = getPropertyName(node)
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        const func = node.initializer as ts.ArrowFunction | ts.FunctionExpression
        const params = func.parameters.map(p => p.getText(sourceFile)).join(', ')
        const returnType = func.type ? `: ${func.type.getText(sourceFile)}` : ''
        return `${name}: (${params})${returnType} => {...}`
      }
      return `${name}: ${node.initializer.getText(sourceFile).substring(0, 50)}...`
    }

    function getFunctionDeclarationDetail(node: ts.FunctionDeclaration): string {
      const name = node.name?.getText(sourceFile) || ''
      const params = node.parameters.map(p => p.getText(sourceFile)).join(', ')
      const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : ''
      return `function ${name}(${params})${returnType}`
    }

    function addLocation(node: ts.Node, name: string, detail: string) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      const end = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile) + name.length)
      const startOffset = sourceFile.getPositionOfLineAndCharacter(start.line, start.character)
      const endOffset = sourceFile.getPositionOfLineAndCharacter(end.line, end.character)
      const text = sourceFile.text.substring(startOffset, endOffset)
      if (text !== name) return
      locs.push({
        loc: new Location(
          Uri.file(file),
          new Range(new Position(start.line, start.character), new Position(end.line, end.character))
        ),
        name,
        detail,
      })
    }

    visit(sourceFile)
  } catch (error) {
    console.warn('AST parsing failed, falling back to string search:', error)
    // 如果AST解析失败，回退到简单的字符串搜索
    if (content && content.indexOf(prop) !== -1) {
      const pos = getPositionFromIndex(content, content.indexOf(prop))
      const endPos = new Position(pos.line, pos.character + prop.length)
      locs.push({
        loc: new Location(Uri.file(file), new Range(pos, endPos)),
        name: prop,
        detail: prop,
      })
    }
  }

  return locs
}
/**
 * 解析文件映射关系
 * @param wxmlFile
 */
function getScriptFile(wxmlFile: string): string | undefined {
  if (wxJsMapCache.has(wxmlFile)) {
    return wxJsMapCache.get(wxmlFile)
  }
  const dir = path.dirname(wxmlFile)
  const base = path.basename(wxmlFile, path.extname(wxmlFile))

  const exts = ['ts', 'js'] // 先ts 再js 防止读取编译后的
  for (const ext of exts) {
    const file = path.join(dir, base + '.' + ext)
    if (fs.existsSync(file)) {
      wxJsMapCache.set(wxmlFile, file)
      return file
    }
  }
  return undefined
}

/**
 * 获取文件版本信息,
 * 编辑器 和 文件系统
 * 只能用===判断
 * @param file
 */
function getVersion(file: string): number {
  const editor = window.visibleTextEditors.find(e => e.document.fileName === file)
  if (editor) {
    return editor.document.version
  } else {
    return fs.statSync(file).mtimeMs
  }
}

/**
 * 提取脚本文件中的定义
 * @param wxmlFile
 * @param type
 * @param prop
 */
export function getProp(wxmlFile: string, type: string, prop: string): PropInfo[] {
  const scriptFile = getScriptFile(wxmlFile)
  if (!scriptFile) return []

  const key = `${scriptFile}?${type}&${prop}`
  const cache = resultCache.get(key)
  const version = getVersion(scriptFile)
  if (cache && cache.version === version) {
    return cache.data
  }
  const result = parseScriptFile(scriptFile, type, prop)
  if (result && result.length > 0) {
    resultCache.set(key, { version, data: result })
  }
  return result
}

/**
 * 从绑定名称中提取所有标识符
 * 处理解构赋值、数组解构、对象解构等情况
 */
function getBindingNames(name: ts.BindingName): string[] {
  const names: string[] = []

  function collectNames(node: ts.BindingName) {
    if (ts.isIdentifier(node)) {
      // 普通标识符: const a = 1
      names.push(node.text)
    } else if (ts.isObjectBindingPattern(node)) {
      // 对象解构: const { a, b, c: d } = obj
      node.elements.forEach(element => {
        if (ts.isBindingElement(element)) {
          collectNames(element.name)
        }
      })
    } else if (ts.isArrayBindingPattern(node)) {
      // 数组解构: const [a, b, ...rest] = arr
      node.elements.forEach(element => {
        if (element && ts.isBindingElement(element)) {
          collectNames(element.name)
        }
      })
    }
  }

  collectNames(name)
  return names
}
