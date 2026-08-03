import { getFileContent, getPositionFromIndex } from './helper'
import * as path from 'path'
import * as fs from 'fs'
import { Location, Uri, Position, Range, window } from 'vscode'
import * as ts from 'typescript'
import { collectAllIdentifiers, CollectedHit, rankAndDedupe } from './identifierCollector'
import { detectConfigObjects, extractSectionObject, DEFAULT_HEURISTIC } from './configObjectHeuristics'

interface PropInfo {
  loc: Location
  name: string
  detail: string
  typeInfo?: string // TypeScript 类型信息
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
  let foundInSpecialContext = false // 标记是否在特殊场景中找到

  // 创建正则表达式用于匹配
  // prop 可能是精确字符串（如 "curPopup"）或正则模式（如 "cur[\\w\\d_$]*"）
  const propRegex = new RegExp(`^${prop}$`)
  console.log(`[ScriptFile] 创建正则表达式: /^${prop}$/`)

  // 辅助函数：判断名称是否匹配 prop 模式
  function matchesProp(name: string): boolean {
    const result = propRegex.test(name)
    if (result) {
      console.log(`[ScriptFile] ✓ 匹配成功: ${name} 符合模式 ${prop}`)
    }
    return result
  }

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

    console.log(`[ScriptFile] 开始解析文件: ${file}, 查找 ${type}: ${prop}`)

    // 遍历AST节点
    function visit(node: ts.Node) {
      // 1. 检查是否是小程序特殊结构调用
      if (ts.isCallExpression(node)) {
        const callName = node.expression.getText(sourceFile)

        // Vue3 Composition API: definePage / defineComponent
        if ((callName === 'definePage' || callName === 'defineComponent') && node.arguments.length > 0) {
          const configArg = node.arguments[0]
          if (ts.isObjectLiteralExpression(configArg)) {
            console.log(`[ScriptFile] 找到 ${callName} 调用`)
            const found = visitMiniProgramConfig(configArg, 'composition')
            if (found) {
              foundInSpecialContext = true
              console.log(`[ScriptFile] 在 ${callName} 中找到定义，跳过通用搜索`)
            }
          }
        }

        // 原生小程序: Component / Page
        else if ((callName === 'Component' || callName === 'Page') && node.arguments.length > 0) {
          const configArg = node.arguments[0]
          if (ts.isObjectLiteralExpression(configArg)) {
            console.log(`[ScriptFile] 找到 ${callName} 调用`)
            const found = visitMiniProgramConfig(configArg, 'native')
            if (found) {
              foundInSpecialContext = true
              console.log(`[ScriptFile] 在 ${callName} 中找到定义，跳过通用搜索`)
            }
          }
        }
      }

      // 2. 通用搜索（兜底）- 只在特殊场景中没找到时才执行
      if (!foundInSpecialContext) {
        if (type === 'prop') {
          // 查找属性定义
          if (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
            const name = getPropertyName(node)
            if (matchesProp(name)) {
              console.log(`[ScriptFile] 找到属性: ${name}`)
              addLocation(node, name, getPropertyDetail(node))
            }
          }
          // 查找变量声明
          else if (ts.isVariableDeclaration(node)) {
            const bindingNames = getBindingNames(node.name)
            bindingNames.forEach(bindingName => {
              if (matchesProp(bindingName)) {
                console.log(`[ScriptFile] 找到变量声明: ${bindingName}`)
                addLocation(node, bindingName, `变量: ${bindingName}`)
              }
            })
          }
          // 查找参数声明（函数参数中的解构）
          else if (ts.isParameter(node)) {
            const bindingNames = getBindingNames(node.name)
            bindingNames.forEach(bindingName => {
              if (matchesProp(bindingName)) {
                console.log(`[ScriptFile] 找到参数: ${bindingName}`)
                addLocation(node, bindingName, `参数: ${bindingName}`)
              }
            })
          }
          // 查找绑定元素（解构赋值中的具体元素）
          else if (ts.isBindingElement(node)) {
            const bindingNames = getBindingNames(node.name)
            bindingNames.forEach(bindingName => {
              if (matchesProp(bindingName)) {
                console.log(`[ScriptFile] 找到绑定元素: ${bindingName}`)
                addLocation(node, bindingName, `绑定: ${bindingName}`)
              }
            })
          }
        } else if (type === 'method') {
          // 查找方法定义
          if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
            const name = getPropertyName(node)
            if (matchesProp(name)) {
              console.log(`[ScriptFile] 找到方法: ${name}`)
              addLocation(node, name, getMethodDetail(node))
            }
          }
          // 查找函数式属性
          else if (ts.isPropertyAssignment(node)) {
            const name = getPropertyName(node)
            if (matchesProp(name) && isFunctionLikeExpression(node.initializer)) {
              console.log(`[ScriptFile] 找到函数式属性: ${name}`)
              addLocation(node, name, getFunctionDetail(node))
            }
          }
          // 查找函数声明
          else if (ts.isFunctionDeclaration(node)) {
            const name = node.name?.getText(sourceFile)
            if (name && matchesProp(name)) {
              console.log(`[ScriptFile] 找到函数声明: ${name}`)
              addLocation(node, name, getFunctionDeclarationDetail(node))
            }
          }
          // 查找变量声明中的函数
          else if (ts.isVariableDeclaration(node) && node.initializer) {
            if (ts.isIdentifier(node.name)) {
              const name = node.name.getText(sourceFile)
              if (matchesProp(name) && isFunctionLikeExpression(node.initializer)) {
                console.log(`[ScriptFile] 找到变量函数: ${name}`)
                addLocation(node, name, `const ${name} = (...)`)
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    /**
     * 解析函数返回的对象（用于处理动态生成的 properties）
     * @param funcCall 函数调用表达式
     * @returns 解析出的属性列表
     */
    function resolveFunctionReturnProperties(funcCall: ts.CallExpression): ts.ObjectLiteralElementLike[] {
      console.log(`[ScriptFile] 尝试解析函数调用: ${funcCall.getText(sourceFile).substring(0, 100)}`)

      const funcName = funcCall.expression.getText(sourceFile)
      console.log(`[ScriptFile] 函数名: ${funcName}`)

      // 查找函数定义
      let funcDef: ts.FunctionDeclaration | ts.VariableDeclaration | undefined

      function findFunction(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name?.getText(sourceFile) === funcName) {
          funcDef = node
        } else if (ts.isVariableStatement(node)) {
          node.declarationList.declarations.forEach(decl => {
            if (ts.isIdentifier(decl.name) && decl.name.getText(sourceFile) === funcName) {
              funcDef = decl
            }
          })
        }
        ts.forEachChild(node, findFunction)
      }

      findFunction(sourceFile)

      if (!funcDef) {
        console.log(`[ScriptFile] 未找到函数定义: ${funcName}`)
        return []
      }

      console.log(`[ScriptFile] 找到函数定义: ${funcName}`)

      // 获取函数体
      let funcBody: ts.Block | ts.Expression | undefined

      if (ts.isFunctionDeclaration(funcDef)) {
        funcBody = funcDef.body
      } else if (funcDef.initializer) {
        if (ts.isArrowFunction(funcDef.initializer) || ts.isFunctionExpression(funcDef.initializer)) {
          funcBody = funcDef.initializer.body
        }
      }

      if (!funcBody) {
        console.log(`[ScriptFile] 函数没有 body`)
        return []
      }

      // 查找 return 语句
      let returnObj: ts.ObjectLiteralExpression | undefined

      if (ts.isBlock(funcBody)) {
        funcBody.statements.forEach(stmt => {
          if (ts.isReturnStatement(stmt) && stmt.expression) {
            if (ts.isObjectLiteralExpression(stmt.expression)) {
              returnObj = stmt.expression
            } else if (
              ts.isParenthesizedExpression(stmt.expression) &&
              ts.isObjectLiteralExpression(stmt.expression.expression)
            ) {
              returnObj = stmt.expression.expression
            }
          }
        })
      } else if (ts.isObjectLiteralExpression(funcBody)) {
        // 箭头函数直接返回对象: () => ({ ... })
        returnObj = funcBody
      } else if (ts.isParenthesizedExpression(funcBody) && ts.isObjectLiteralExpression(funcBody.expression)) {
        returnObj = funcBody.expression
      }

      if (returnObj) {
        console.log(`[ScriptFile] 函数返回对象，包含 ${returnObj.properties.length} 个属性`)
        return Array.from(returnObj.properties)
      }

      console.log(`[ScriptFile] 未找到函数返回的对象`)
      return []
    }

    /**
     * 展开 Object.assign() 或扩展运算符中的所有属性
     * @param expr 表达式（可能是 Object.assign 或包含扩展运算符的对象字面量）
     * @returns 所有展开后的属性列表
     */
    function expandObjectExpression(expr: ts.Expression): ts.ObjectLiteralElementLike[] {
      const properties: ts.ObjectLiteralElementLike[] = []

      // 处理 Object.assign({}, a, b, c)
      if (ts.isCallExpression(expr)) {
        const callName = expr.expression.getText(sourceFile)
        console.log(`[ScriptFile] 检查函数调用: ${callName}`)

        if (callName === 'Object.assign' || callName.endsWith('.assign')) {
          console.log(`[ScriptFile] 找到 Object.assign，参数数量: ${expr.arguments.length}`)
          // 遍历所有参数（跳过第一个目标对象）
          expr.arguments.forEach((arg, idx) => {
            console.log(`[ScriptFile] Object.assign 参数 ${idx}: ${arg.getText(sourceFile).substring(0, 50)}`)
            properties.push(...expandObjectExpression(arg))
          })
        } else {
          // 尝试解析函数返回值
          const funcProps = resolveFunctionReturnProperties(expr)
          properties.push(...funcProps)
        }
      }
      // 处理对象字面量: { a: 1, ...b, ...c() }
      else if (ts.isObjectLiteralExpression(expr)) {
        console.log(`[ScriptFile] 对象字面量，属性数: ${expr.properties.length}`)
        expr.properties.forEach((prop, idx) => {
          console.log(`[ScriptFile] 属性 ${idx} 类型: ${ts.SyntaxKind[prop.kind]}`)

          // 处理扩展运算符: ...someObject 或 ...someFunction()
          if (ts.isSpreadAssignment(prop)) {
            console.log(`[ScriptFile] 扩展运算符: ${prop.expression.getText(sourceFile).substring(0, 50)}`)
            properties.push(...expandObjectExpression(prop.expression))
          } else {
            properties.push(prop)
          }
        })
      }
      // 处理标识符引用（变量名）
      else if (ts.isIdentifier(expr)) {
        const varName = expr.getText(sourceFile)
        console.log(`[ScriptFile] 标识符引用: ${varName}`)
        // 查找变量定义
        // TODO: 实现变量追踪
      }

      return properties
    }

    /**
     * 访问小程序配置对象（definePage/defineComponent/Component/Page）
     * @param config 配置对象字面量
     * @param mode 模式：composition 或 native
     * @returns 是否找到目标定义
     */
    function visitMiniProgramConfig(config: ts.ObjectLiteralExpression, mode: 'composition' | 'native'): boolean {
      console.log(`[ScriptFile] visitMiniProgramConfig，属性总数: ${config.properties.length}`)
      let found = false

      config.properties.forEach((property, index) => {
        if (found) return // 已找到，跳过后续检查

        console.log(`[ScriptFile] 属性 ${index} 类型: ${ts.SyntaxKind[property.kind]}`)

        // 处理方法简写: setup() {} 或 setup: function() {}
        if (ts.isMethodDeclaration(property)) {
          const propName = getPropertyName(property)
          console.log(`[ScriptFile] 方法声明: ${propName}, mode: ${mode}`)

          if (mode === 'composition' && propName === 'setup') {
            console.log('[ScriptFile] 找到 setup 方法声明，开始解析')
            found = visitSetupReturn(property as any)
            return
          }
        }

        if (!ts.isPropertyAssignment(property)) {
          console.log(`[ScriptFile] 跳过非 PropertyAssignment: ${ts.SyntaxKind[property.kind]}`)
          return
        }

        const propName = getPropertyName(property)
        console.log(`[ScriptFile] 检查属性: ${propName}, mode: ${mode}`)

        if (mode === 'composition') {
          // Vue3 Composition API: 查找 setup 函数
          if (propName === 'setup') {
            console.log(`[ScriptFile] 找到 setup 属性，initializer 类型: ${ts.SyntaxKind[property.initializer.kind]}`)
            if (ts.isFunctionExpression(property.initializer) || ts.isArrowFunction(property.initializer)) {
              const setupFunc = property.initializer as ts.FunctionExpression | ts.ArrowFunction
              console.log('[ScriptFile] 确认为 setup 函数，开始解析 return')

              // 查找 setup 函数的返回语句
              found = visitSetupReturn(setupFunc)
            } else {
              console.log('[ScriptFile] setup 不是函数表达式或箭头函数')
            }
          }
        } else if (mode === 'native') {
          // 原生小程序: properties, data, methods
          if (propName === 'properties' && type === 'prop') {
            console.log('[ScriptFile] 检查 properties')
            visitObjectProperties(property.initializer)
          } else if (propName === 'data' && type === 'prop') {
            console.log('[ScriptFile] 检查 data')
            visitObjectProperties(property.initializer)
          } else if (propName === 'methods' && type === 'method') {
            console.log('[ScriptFile] 检查 methods')
            visitObjectProperties(property.initializer)
          }
          // 原生小程序还可以直接在顶层定义方法
          else if (type === 'method' && matchesProp(propName) && isFunctionLikeExpression(property.initializer)) {
            console.log(`[ScriptFile] 找到原生小程序方法: ${propName}`)
            addLocation(property, propName, `${propName}()`)
          }
        }

        // 对于 properties，需要展开所有可能的动态属性（Object.assign、扩展运算符、函数调用等）
        if (propName === 'properties' && type === 'prop') {
          console.log(`[ScriptFile] 检查 properties，initializer 类型: ${ts.SyntaxKind[property.initializer.kind]}`)

          // 展开所有属性（包括动态生成的）
          const allProperties = expandObjectExpression(property.initializer)
          console.log(`[ScriptFile] 展开后的 properties 总数: ${allProperties.length}`)

          allProperties.forEach(innerProp => {
            if (ts.isPropertyAssignment(innerProp) || ts.isShorthandPropertyAssignment(innerProp)) {
              const innerPropName = getPropertyName(innerProp)
              console.log(`[ScriptFile] 检查属性: ${innerPropName}`)

              if (matchesProp(innerPropName)) {
                console.log(`[ScriptFile] ✓ 找到 properties.${innerPropName}`)
                addLocation(innerProp, innerPropName, `property: ${innerPropName}`)
              }
            }
          })
        }
      })

      return found
    }

    /**
     * 访问 setup 函数的返回对象
     * @returns 是否找到目标定义
     */
    function visitSetupReturn(setupFunc: ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration): boolean {
      const body = setupFunc.body
      console.log(`[ScriptFile] setup body 类型: ${body ? ts.SyntaxKind[body.kind] : 'undefined'}`)

      if (!body) {
        console.log('[ScriptFile] setup 没有 body')
        return false
      }

      let found = false

      if (ts.isBlock(body)) {
        console.log(`[ScriptFile] setup body 有 ${body.statements.length} 个语句`)
        // 查找 return 语句
        body.statements.forEach((statement, index) => {
          if (found) return // 已找到，跳过后续检查

          console.log(`[ScriptFile] 语句 ${index}: ${ts.SyntaxKind[statement.kind]}`)
          if (ts.isReturnStatement(statement) && statement.expression) {
            console.log(`[ScriptFile] 找到 return 语句，表达式类型: ${ts.SyntaxKind[statement.expression.kind]}`)
            if (ts.isObjectLiteralExpression(statement.expression)) {
              console.log(`[ScriptFile] 找到 setup return 对象，有 ${statement.expression.properties.length} 个属性`)

              // 遍历返回对象的属性
              statement.expression.properties.forEach(property => {
                if (found) return // 已找到，跳过后续检查

                if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
                  const name = getPropertyName(property)
                  console.log(`[ScriptFile] return 属性: ${name}, 类型: ${ts.SyntaxKind[property.kind]}`)

                  if (type === 'prop' && matchesProp(name)) {
                    console.log(`[ScriptFile] ✅ setup 返回属性: ${name}`)
                    // 对于简写属性，不在这里添加 location，而是去找变量定义
                    if (ts.isShorthandPropertyAssignment(property)) {
                      console.log(`[ScriptFile] 简写属性，查找变量定义`)
                      found = findVariableInSetup(body, name)
                    } else {
                      addLocation(property, name, `setup返回: ${name}`)
                      found = true
                    }
                  } else if (type === 'method' && matchesProp(name)) {
                    // 对于方法，需要判断是否为简写引用
                    if (ts.isPropertyAssignment(property) && isFunctionLikeExpression(property.initializer)) {
                      console.log(`[ScriptFile] ✅ setup 返回方法（直接定义）: ${name}`)
                      addLocation(property, name, `setup方法: ${name}()`)
                      found = true
                    } else if (ts.isShorthandPropertyAssignment(property)) {
                      // 简写属性，可能引用了一个函数变量，去找变量定义
                      console.log(`[ScriptFile] 简写属性，查找方法定义`)
                      found = findVariableInSetup(body, name)
                    } else {
                      console.log(`[ScriptFile] ${name} 不是函数定义`)
                    }
                  }
                }
              })
            }
          }
        })
      } else {
        console.log('[ScriptFile] setup body 不是 Block，可能是箭头函数直接返回')
        // 处理箭头函数直接返回对象的情况: setup() => ({ ... })
        if (ts.isObjectLiteralExpression(body)) {
          console.log(`[ScriptFile] setup 直接返回对象，有 ${body.properties.length} 个属性`)
          // TODO: 处理直接返回的情况
        }
      }

      return found
    }

    /**
     * 在 setup 函数体中查找变量定义
     * @returns 是否找到定义
     */
    function findVariableInSetup(block: ts.Block, varName: string): boolean {
      console.log(`[ScriptFile] 在 setup 中查找变量: ${varName}`)
      const found = false

      for (let i = 0; i < block.statements.length; i++) {
        const statement = block.statements[i]
        if (ts.isVariableStatement(statement)) {
          console.log(`[ScriptFile] 检查语句 ${i}，是变量声明`)
          for (const declaration of statement.declarationList.declarations) {
            // 处理普通变量声明: const varName = ...
            const declName = declaration.name.getText(sourceFile)
            console.log(`[ScriptFile] 变量名: ${declName}`)
            if (declName === varName) {
              console.log(`[ScriptFile] ✅ 找到 setup 内变量: ${declName}`)
              addLocation(declaration, declName, `const ${declName}`)
              return true
            }

            // 处理解构声明: const { a, b, c } = useHook()
            if (ts.isObjectBindingPattern(declaration.name)) {
              console.log(`[ScriptFile] 是对象解构，元素数: ${declaration.name.elements.length}`)
              for (const element of declaration.name.elements) {
                if (ts.isBindingElement(element)) {
                  const bindingName = element.name.getText(sourceFile)
                  console.log(`[ScriptFile] 解构属性: ${bindingName}`)
                  if (bindingName === varName) {
                    console.log(`[ScriptFile] ✅ 找到 setup 内解构变量: ${bindingName}`)
                    // 定位到具体的解构属性名
                    addLocation(element.name as ts.Identifier, bindingName, `const { ${bindingName} } = ...`)
                    return true
                  }
                }
              }
            }

            // 处理数组解构: const [a, b] = useState()
            if (ts.isArrayBindingPattern(declaration.name)) {
              console.log(`[ScriptFile] 是数组解构`)
              for (let j = 0; j < declaration.name.elements.length; j++) {
                const element = declaration.name.elements[j]
                if (element && ts.isBindingElement(element)) {
                  const bindingName = element.name.getText(sourceFile)
                  console.log(`[ScriptFile] 数组解构[${j}]: ${bindingName}`)
                  if (bindingName === varName) {
                    console.log(`[ScriptFile] ✅ 找到 setup 内数组解构变量: ${bindingName}`)
                    addLocation(element.name as ts.Identifier, bindingName, `const [${bindingName}] = ...`)
                    return true
                  }
                }
              }
            }
          }
        }
      }

      console.log(`[ScriptFile] ❌ 未找到变量定义: ${varName}`)
      return found
    }

    /**
     * 访问对象字面量的属性
     */
    function visitObjectProperties(node: ts.Expression) {
      if (ts.isObjectLiteralExpression(node)) {
        node.properties.forEach(property => {
          if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            const name = getPropertyName(property)

            if (type === 'prop' && matchesProp(name)) {
              console.log(`[ScriptFile] 对象属性: ${name}`)
              addLocation(property, name, `${name}`)
            } else if (type === 'method' && matchesProp(name)) {
              if (ts.isPropertyAssignment(property) && isFunctionLikeExpression(property.initializer)) {
                console.log(`[ScriptFile] 对象方法: ${name}`)
                addLocation(property, name, `${name}()`)
              }
            }
          } else if (ts.isMethodDeclaration(property)) {
            const name = getPropertyName(property)
            if (type === 'method' && matchesProp(name)) {
              console.log(`[ScriptFile] 对象方法声明: ${name}`)
              addLocation(property, name, `${name}()`)
            }
          }
        })
      }
    }

    function getPropertyName(
      node:
        | ts.PropertyAssignment
        | ts.ShorthandPropertyAssignment
        | ts.PropertyDeclaration
        | ts.PropertySignature
        | ts.MethodDeclaration
        | ts.MethodSignature
    ): string {
      // 处理简写属性：{ name } 等价于 { name: name }
      if (ts.isShorthandPropertyAssignment(node)) {
        return node.name.text
      }

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

    function addLocation(node: ts.Node, name: string, detail: string, typeInfo?: string) {
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
        typeInfo: typeInfo || inferTypeFromNode(node),
      })
    }

    /**
     * 从 AST 节点推断类型信息
     */
    function inferTypeFromNode(node: ts.Node): string | undefined {
      // 1. 变量声明：const/let/var
      if (ts.isVariableDeclaration(node)) {
        // 有显式类型标注
        if (node.type) {
          return node.type.getText(sourceFile)
        }
        // 从初始化器推断类型
        if (node.initializer) {
          return inferTypeFromExpression(node.initializer)
        }
      }

      // 2. 属性声明
      if (ts.isPropertyAssignment(node)) {
        // 从值推断类型
        return inferTypeFromExpression(node.initializer)
      }

      if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
        // 有显式类型标注
        if (node.type) {
          return node.type.getText(sourceFile)
        }
        // 从初始化器推断（仅 PropertyDeclaration）
        if (ts.isPropertyDeclaration(node) && node.initializer) {
          return inferTypeFromExpression(node.initializer)
        }
      }

      // 3. 参数
      if (ts.isParameter(node)) {
        if (node.type) {
          return node.type.getText(sourceFile)
        }
      }

      // 4. 绑定元素（解构）
      if (ts.isBindingElement(node)) {
        // 解构时通常没有类型信息，需要从父级推断
        return undefined
      }

      return undefined
    }

    /**
     * 从表达式推断类型
     */
    function inferTypeFromExpression(expr: ts.Expression): string | undefined {
      // 字面量类型
      if (ts.isStringLiteral(expr)) {
        return 'string'
      }
      if (ts.isNumericLiteral(expr)) {
        return 'number'
      }
      if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) {
        return 'boolean'
      }
      if (expr.kind === ts.SyntaxKind.NullKeyword) {
        return 'null'
      }
      if (expr.kind === ts.SyntaxKind.UndefinedKeyword) {
        return 'undefined'
      }

      // 数组字面量
      if (ts.isArrayLiteralExpression(expr)) {
        if (expr.elements.length > 0) {
          const firstType = inferTypeFromExpression(expr.elements[0])
          return firstType ? `${firstType}[]` : 'any[]'
        }
        return 'any[]'
      }

      // 对象字面量
      if (ts.isObjectLiteralExpression(expr)) {
        return 'object'
      }

      // 箭头函数/函数表达式
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        const params = expr.parameters
          .map(p => {
            const paramName = p.name.getText(sourceFile)
            const paramType = p.type ? p.type.getText(sourceFile) : 'any'
            return `${paramName}: ${paramType}`
          })
          .join(', ')
        const returnType = expr.type ? expr.type.getText(sourceFile) : 'any'
        return `(${params}) => ${returnType}`
      }

      // 调用表达式 - 尝试识别常见的 API
      if (ts.isCallExpression(expr)) {
        const callText = expr.expression.getText(sourceFile)

        // Vue3 响应式 API
        if (callText === 'ref') {
          const arg = expr.arguments[0]
          if (arg) {
            const argType = inferTypeFromExpression(arg)
            return argType ? `Ref<${argType}>` : 'Ref<any>'
          }
          return 'Ref<any>'
        }

        if (callText === 'reactive') {
          return 'UnwrapRef<object>'
        }

        if (callText === 'computed') {
          return 'ComputedRef<any>'
        }

        if (callText === 'toRef') {
          return 'Ref<any>'
        }

        if (callText === 'toRefs') {
          return 'ToRefs<object>'
        }

        // 小程序特殊 API
        if (callText === 'getCurrentInstance') {
          return 'ComponentInternalInstance | null'
        }

        // 通用函数调用
        return 'any'
      }

      // 其他表达式
      return undefined
    }

    visit(sourceFile)

    /**
     * 用启发式探测处理非白名单入口的配置对象
     * 返回是否找到目标定义
     */
    function visitWithHeuristic(): boolean {
      const candidates = detectConfigObjects(sourceFile, DEFAULT_HEURISTIC)
      if (candidates.length === 0) return false

      // 取得分最高的候选
      const best = candidates[0]
      console.log(`[ScriptFile] 启发式探测命中: ${best.functionName}(得分=${best.score})`)

      const dataKeys = DEFAULT_HEURISTIC.dataKeys
      const methodKeys = DEFAULT_HEURISTIC.methodKeys
      const propKeys = DEFAULT_HEURISTIC.propKeys

      let found = false

      if (type === 'prop') {
        // 依次尝试 data / properties section
        const dataObj = extractSectionObject(best.config, dataKeys, sourceFile)
        if (dataObj) {
          visitObjectProperties(dataObj)
          found = locs.length > 0
        }
        if (!found) {
          const propObj = extractSectionObject(best.config, propKeys, sourceFile)
          if (propObj) {
            visitObjectProperties(propObj)
            found = locs.length > 0
          }
        }
      } else if (type === 'method') {
        const methodObj = extractSectionObject(best.config, methodKeys, sourceFile)
        if (methodObj) {
          visitObjectProperties(methodObj)
          found = locs.length > 0
        }
        // 原生 Page 风格：方法直接定义在顶层
        if (!found) {
          best.config.properties.forEach(prop => {
            if (found) return
            if (ts.isMethodDeclaration(prop)) {
              const name = getPropertyName(prop)
              if (name && matchesProp(name)) {
                addLocation(prop, name, `${name}()`)
                found = true
              }
            } else if (ts.isPropertyAssignment(prop)) {
              const name = getPropertyName(prop)
              if (name && matchesProp(name) && isFunctionLikeExpression(prop.initializer)) {
                addLocation(prop, name, `${name}()`)
                found = true
              }
            }
          })
        }
      }

      return found
    }

    // ========== 阶段3: 启发式探测兜底 ==========
    // 特殊入口(Page/Component/definePage/defineComponent)已命中则不走兜底,避免混入顶层同名
    if (!foundInSpecialContext && locs.length === 0 && (type === 'prop' || type === 'method')) {
      // 先尝试启发式探测（识别三方框架的配置对象）
      const heuristicFound = visitWithHeuristic()
      if (heuristicFound) {
        console.log('[ScriptFile] 启发式探测命中，跳过通用兜底')
      }
    }

    // ========== 阶段4: 通用兜底 + 去重优先级 ==========
    // 启发式和特殊入口都没命中才走全文件同名搜索
    if (!foundInSpecialContext && locs.length === 0 && (type === 'prop' || type === 'method')) {
      try {
        const allHits = collectAllIdentifiers(sourceFile, type, matchesProp)
        const merged = mergeAndRank(allHits, file, sourceFile)
        locs.push(...merged)
        if (merged.length > 0) {
          console.log(`[ScriptFile] 通用兜底命中 ${merged.length} 个: ${merged.map(m => m.name).join(', ')}`)
        }
      } catch (e) {
        console.warn('[ScriptFile] 兜底收集器异常,忽略:', e)
      }
    }
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

/**
 * 阶段4: 把 CollectedHit[] 按优先级去重排序,包装为 PropInfo[]
 */
function mergeAndRank(hits: CollectedHit[], file: string, sourceFile: ts.SourceFile): PropInfo[] {
  const ranked = rankAndDedupe(hits)
  return ranked.map(h => {
    const startLc = sourceFile.getLineAndCharacterOfPosition(h.start)
    const endLc = sourceFile.getLineAndCharacterOfPosition(h.end)
    return {
      loc: new Location(
        Uri.file(file),
        new Range(new Position(startLc.line, startLc.character), new Position(endLc.line, endLc.character))
      ),
      name: h.name,
      detail: h.detail,
    }
  })
}
