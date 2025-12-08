import * as ts from 'typescript'
import { ComponentAttr } from './dev'

/**
 * 使用 TypeScript AST 解析组件的 properties
 * 支持 Object.assign、扩展运算符、函数调用等复杂语法
 */
export function parseAttrsWithAST(content: string): ComponentAttr[] {
  console.log(`[parseAttrsAST] 开始解析，内容长度: ${content.length}`)
  
  try {
    // 创建 TypeScript 源文件
    const sourceFile = ts.createSourceFile(
      'temp.js',
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    )
    
    const attrs: ComponentAttr[] = []
    
    // 遍历 AST 查找 properties
    function visit(node: ts.Node) {
      // 查找 defineComponent / Component / Page 调用
      if (ts.isCallExpression(node)) {
        const callName = node.expression.getText(sourceFile)
        
        // 匹配多种调用格式：
        // 1. defineComponent({...})
        // 2. (0, core_1.defineComponent)({...}) - CommonJS 编译后
        // 3. Component({...})
        // 4. Page({...})
        const isComponentCall = 
          callName === 'defineComponent' || 
          callName === 'Component' || 
          callName === 'Page' ||
          callName.includes('defineComponent') ||
          callName.includes('Component') ||
          callName.includes('Page')
        
        if (isComponentCall && node.arguments.length > 0) {
          const configArg = node.arguments[0]
          if (ts.isObjectLiteralExpression(configArg)) {
            console.log(`[parseAttrsAST] 找到组件定义调用: ${callName}`)
            extractProperties(configArg)
            return // 找到后不再继续
          }
        }
      }
      
      ts.forEachChild(node, visit)
    }
    
    /**
     * 从配置对象中提取 properties
     */
    function extractProperties(config: ts.ObjectLiteralExpression) {
      console.log(`[parseAttrsAST] 检查配置对象，属性数: ${config.properties.length}`)
      
      config.properties.forEach((property, idx) => {
        if (!ts.isPropertyAssignment(property)) {
          console.log(`[parseAttrsAST] 属性 ${idx} 不是 PropertyAssignment，类型: ${ts.SyntaxKind[property.kind]}`)
          return
        }
        
        const propName = getPropertyName(property)
        console.log(`[parseAttrsAST] 属性 ${idx}: ${propName}`)
        
        if (propName !== 'properties') return
        
        console.log(`[parseAttrsAST] 找到 properties，类型: ${ts.SyntaxKind[property.initializer.kind]}`)
        
        // 展开所有属性（包括 Object.assign、扩展运算符等）
        const allProperties = expandObjectExpression(property.initializer)
        console.log(`[parseAttrsAST] 展开后共 ${allProperties.length} 个属性`)
        
        allProperties.forEach(prop => {
          if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
            const attr = parseProperty(prop)
            if (attr) {
              console.log(`[parseAttrsAST] ✓ 添加属性: ${attr.name}`)
              attrs.push(attr)
            }
          }
        })
      })
    }
    
    /**
     * 展开对象表达式（处理 Object.assign、扩展运算符等）
     */
    function expandObjectExpression(expr: ts.Expression): ts.ObjectLiteralElementLike[] {
      const properties: ts.ObjectLiteralElementLike[] = []
      
      // 处理 Object.assign({}, a, b, c)
      if (ts.isCallExpression(expr)) {
        const callName = expr.expression.getText(sourceFile)
        console.log(`[parseAttrsAST] 检查函数调用: ${callName}`)
        
        if (callName === 'Object.assign' || callName.endsWith('.assign')) {
          console.log(`[parseAttrsAST] 展开 Object.assign，参数: ${expr.arguments.length}`)
          expr.arguments.forEach((arg, idx) => {
            console.log(`[parseAttrsAST] Object.assign 参数 ${idx}, 类型: ${ts.SyntaxKind[arg.kind]}`)
            properties.push(...expandObjectExpression(arg))
          })
        } else {
          // 其他函数调用 - 跨文件的函数无法解析
          console.log(`[parseAttrsAST] 跳过跨文件函数调用: ${callName}`)
          // 尝试解析函数返回值（仅当函数在当前文件中定义时）
          const funcProps = resolveFunctionReturnProperties(expr)
          if (funcProps.length > 0) {
            properties.push(...funcProps)
          }
        }
      }
      // 处理对象字面量
      else if (ts.isObjectLiteralExpression(expr)) {
        console.log(`[parseAttrsAST] 对象字面量，属性数: ${expr.properties.length}`)
        expr.properties.forEach(prop => {
          if (ts.isSpreadAssignment(prop)) {
            console.log(`[parseAttrsAST] 扩展运算符: ${prop.expression.getText(sourceFile).substring(0, 50)}`)
            properties.push(...expandObjectExpression(prop.expression))
          } else {
            properties.push(prop)
          }
        })
      }
      
      return properties
    }
    
    /**
     * 解析函数返回的属性（支持动态执行函数获取真实结果）
     */
    function resolveFunctionReturnProperties(funcCall: ts.CallExpression): ts.ObjectLiteralElementLike[] {
      const funcName = funcCall.expression.getText(sourceFile)
      console.log(`[parseAttrsAST] 尝试解析函数: ${funcName}`)
      
      // 方案1: 尝试动态执行函数（如果是纯函数）
      try {
        // 获取完整的函数代码
        let funcCode = ''
        
        function findFunctionCode(node: ts.Node) {
          if (ts.isFunctionDeclaration(node) && node.name?.getText(sourceFile) === funcName) {
            funcCode = node.getText(sourceFile)
          } else if (ts.isVariableStatement(node)) {
            node.declarationList.declarations.forEach(decl => {
              if (ts.isIdentifier(decl.name) && decl.name.getText(sourceFile) === funcName) {
                funcCode = decl.getText(sourceFile)
              }
            })
          }
          if (!funcCode) {
            ts.forEachChild(node, findFunctionCode)
          }
        }
        
        findFunctionCode(sourceFile)
        
        if (funcCode) {
          console.log(`[parseAttrsAST] 找到函数代码，尝试执行`)
          
          // 获取函数调用的参数
          const callArgs = funcCall.arguments.map(arg => {
            if (ts.isStringLiteral(arg)) {
              return `"${arg.text}"`
            } else if (ts.isNumericLiteral(arg)) {
              return arg.text
            }
            return arg.getText(sourceFile)
          }).join(', ')
          
          console.log(`[parseAttrsAST] 调用参数: ${callArgs}`)
          
          // 构造完整的执行代码
          const executeCode = `
            ${funcCode};
            const result = ${funcName}(${callArgs});
            JSON.stringify(result);
          `
          
          // 使用 Function 构造器执行
          const executeFn = new Function(executeCode)
          const resultJson = executeFn()
          const result = JSON.parse(resultJson)
          
          console.log(`[parseAttrsAST] 函数执行成功，返回:`, result)
          
          // 将结果转换为 AST 节点
          const resultCode = `const temp = ${JSON.stringify(result)}`
          const tempSource = ts.createSourceFile(
            'temp.ts',
            resultCode,
            ts.ScriptTarget.Latest,
            true
          )
          
          let resultObj: ts.ObjectLiteralExpression | undefined
          ts.forEachChild(tempSource, node => {
            if (ts.isVariableStatement(node)) {
              node.declarationList.declarations.forEach(decl => {
                if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
                  resultObj = decl.initializer
                }
              })
            }
          })
          
          if (resultObj) {
            return Array.from(resultObj.properties)
          }
        }
      } catch (error) {
        console.log(`[parseAttrsAST] 动态执行失败:`, error)
      }
      
      // 方案2: 静态分析（回退方案）
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
        console.log(`[parseAttrsAST] 未找到函数定义: ${funcName}`)
        return []
      }
      
      console.log(`[parseAttrsAST] 使用静态分析`)
      
      // 获取函数体
      let funcBody: ts.Block | ts.Expression | undefined
      
      if (ts.isFunctionDeclaration(funcDef)) {
        funcBody = funcDef.body
      } else if (funcDef.initializer) {
        if (ts.isArrowFunction(funcDef.initializer) || ts.isFunctionExpression(funcDef.initializer)) {
          funcBody = funcDef.initializer.body
        }
      }
      
      if (!funcBody) return []
      
      // 查找 return 语句
      let returnObj: ts.ObjectLiteralExpression | undefined
      
      if (ts.isBlock(funcBody)) {
        funcBody.statements.forEach(stmt => {
          if (ts.isReturnStatement(stmt) && stmt.expression) {
            if (ts.isObjectLiteralExpression(stmt.expression)) {
              returnObj = stmt.expression
            } else if (ts.isParenthesizedExpression(stmt.expression) && 
                       ts.isObjectLiteralExpression(stmt.expression.expression)) {
              returnObj = stmt.expression.expression
            }
          }
        })
      } else if (ts.isObjectLiteralExpression(funcBody)) {
        returnObj = funcBody
      } else if (ts.isParenthesizedExpression(funcBody) && 
                 ts.isObjectLiteralExpression(funcBody.expression)) {
        returnObj = funcBody.expression
      }
      
      if (returnObj) {
        console.log(`[parseAttrsAST] 静态分析返回 ${returnObj.properties.length} 个属性`)
        return Array.from(returnObj.properties)
      }
      
      return []
    }
    
    /**
     * 解析单个属性定义
     */
    function parseProperty(prop: ts.PropertyAssignment | ts.ShorthandPropertyAssignment): ComponentAttr | undefined {
      const name = getPropertyName(prop)
      
      // 如果属性名包含未解析的表达式，跳过
      if (name.includes('${') || name.includes('[') || name.includes('$')) {
        console.log(`[parseAttrsAST] 跳过未解析的计算属性: ${name}`)
        return undefined
      }
      
      console.log(`[parseAttrsAST] 解析属性: ${name}`)
      
      const attr: ComponentAttr = {
        name,
        type: { name: 'any' }
      }
      
      // 解析属性值
      if (ts.isPropertyAssignment(prop)) {
        const initializer = prop.initializer
        
        // 简单类型: visible: Boolean
        if (ts.isIdentifier(initializer)) {
          const typeName = initializer.getText(sourceFile)
          attr.type.name = typeName.toLowerCase()
        }
        // 对象配置: visible: { type: Boolean, value: false }
        else if (ts.isObjectLiteralExpression(initializer)) {
          initializer.properties.forEach(p => {
            if (ts.isPropertyAssignment(p)) {
              const pName = getPropertyName(p)
              
              if (pName === 'type' && ts.isIdentifier(p.initializer)) {
                attr.type.name = p.initializer.getText(sourceFile).toLowerCase()
              } else if (pName === 'value') {
                attr.defaultValue = p.initializer.getText(sourceFile)
              }
            }
          })
        }
      }
      
      return attr
    }
    
    function getPropertyName(node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | ts.MethodDeclaration): string {
      if (ts.isShorthandPropertyAssignment(node)) {
        return node.name.text
      }
      
      if (ts.isIdentifier(node.name)) {
        return node.name.text
      } else if (ts.isStringLiteral(node.name)) {
        return node.name.text
      } else if (ts.isComputedPropertyName(node.name)) {
        // 处理计算属性名: [`${name}TrackParams`]
        const expr = node.name.expression
        if (ts.isTemplateExpression(expr)) {
          // 尝试简单求值
          return evaluateTemplateExpression(expr)
        }
        return node.name.getText(sourceFile)
      }
      return node.name?.getText(sourceFile) || ''
    }
    
    /**
     * 简单求值模板字符串
     */
    function evaluateTemplateExpression(expr: ts.TemplateExpression): string {
      let result = expr.head.text
      
      expr.templateSpans.forEach(span => {
        // 这里只处理简单的标识符，不处理复杂表达式
        if (ts.isIdentifier(span.expression)) {
          result += span.expression.text
        } else {
          result += span.expression.getText(sourceFile)
        }
        result += span.literal.text
      })
      
      return result
    }
    
    visit(sourceFile)
    
    console.log(`[parseAttrsAST] 最终解析到 ${attrs.length} 个属性`)
    return attrs
    
  } catch (error) {
    console.error('[parseAttrsAST] 解析失败:', error)
    return []
  }
}
