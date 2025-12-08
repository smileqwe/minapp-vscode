import { Position } from 'vscode'
import { SourceMapConsumer } from 'source-map'
import postcss, { Root, Rule, Syntax } from 'postcss'
import * as postcssScss from 'postcss-scss'
// @ts-ignore - postcss-less 没有类型定义
import * as postcssLess from 'postcss-less'

export namespace quickParseStyle {
  export interface Options {
    unique?: boolean
  }
}

/**
 * 解析样式文件内容成 className 和 doc 的形式
 *
 * 使用 postcss 解析器替代正则表达式，支持：
 * - 复杂选择器（.a.b, .a > .b, .a + .b 等）
 * - SCSS/Less 嵌套语法
 * - 正确处理注释和字符串
 * - 准确的位置信息
 * 
 * @param styleContent - 包含 CSS 内容和 source map 的对象
 * @param options - 解析选项，unique 表示是否去重
 * @returns Promise<样式对象数组>，包含类名、文档和位置信息
 */
export async function quickParseStyle(
  styleContent: { css: string, map: string | undefined }, 
  { unique }: quickParseStyle.Options = {}
): Promise<{ doc: string; pos: Position; name: string }[]> {
  const results: { doc: string; pos: Position; name: string }[] = []
  const seenClasses = new Set<string>()
  
  // 异步初始化 SourceMapConsumer（source-map v0.7.0+ 要求）
  const map = styleContent.map 
    ? await new SourceMapConsumer(JSON.parse(styleContent.map)) 
    : undefined
  
  try {
    // 自动检测语法类型并选择对应的 parser
    const syntax = detectSyntax(styleContent.css)
    let root: Root
    
    try {
      const result = postcss().process(styleContent.css, {
        syntax: syntax,
        from: undefined // 避免 source map 警告
      })
      root = result.root as Root
    } catch (error) {
      // 解析失败时回退到普通 CSS 解析
      console.warn('[quickParseStyle] PostCSS parse error, fallback to default CSS parser:', error)
      try {
        const result = postcss().process(styleContent.css, { from: undefined })
        root = result.root as Root
      } catch (fallbackError) {
        // 连默认解析器都失败，返回空结果
        console.error('[quickParseStyle] CSS parsing completely failed:', fallbackError)
        return []
      }
    }
    
    // 遍历 AST 提取所有包含 class 选择器的规则
    // 使用 walkRules 自动遍历嵌套规则（支持 SCSS/Less）
    let totalRules = 0
    let extractedClasses = 0
    
    root.walkRules((rule: Rule) => {
      totalRules++
      
      // 解析完整的选择器路径（处理嵌套）
      const fullSelector = resolveNestedSelector(rule)
      const classNames = extractClassNames(fullSelector)
      
      if (classNames.length === 0) return // 该规则不包含 class 选择器
      
      classNames.forEach(className => {
        // 去重处理
        if (unique && seenClasses.has(className)) {
          return
        }
        seenClasses.add(className)
        extractedClasses++
        
        // 获取规则的完整文本（包括属性）
        const doc = formatRuleDoc(rule, fullSelector)
        
        // 计算位置信息
        let pos: Position
        if (rule.source && rule.source.start) {
          const line = rule.source.start.line - 1
          const column = rule.source.start.column - 1
          
          // 使用 source map 映射回原始位置（处理 sass/less 编译后的文件）
          if (map) {
            const mapPos = map.originalPositionFor({ 
              line: rule.source.start.line, 
              column: rule.source.start.column
            })
            if (mapPos && mapPos.line !== null) {
              pos = new Position(mapPos.line - 1, mapPos.column || 0)
            } else {
              pos = new Position(line, column)
            }
          } else {
            pos = new Position(line, column)
          }
        } else {
          pos = new Position(0, 0)
        }
        
        results.push({ name: className, doc, pos })
      })
    })
    
    // 调试日志
    if (extractedClasses > 0) {
      console.log(`[quickParseStyle] Extracted ${extractedClasses} classes from ${totalRules} rules`)
    }

    return results
  } finally {
    // 清理 SourceMapConsumer 资源，避免内存泄漏
    if (map) {
      map.destroy()
    }
  }
}

/**
 * 解析嵌套选择器的完整路径
 * SCSS/Less 支持嵌套，需要拼接父级选择器
 * 
 * @example
 * .container {
 *   .item { } // => .container .item
 *   &-active { } // => .container-active
 *   &:hover { } // => .container:hover
 * }
 */
function resolveNestedSelector(rule: Rule): string {
  const selectors: string[] = []
  let current: any = rule
  
  // 向上遍历父级规则
  while (current) {
    if (current.type === 'rule' && current.selector) {
      selectors.unshift(current.selector)
    }
    current = current.parent
    // 遇到 Root 节点停止
    if (current && current.type === 'root') {
      break
    }
  }
  
  if (selectors.length === 0) {
    return rule.selector
  }
  
  // 处理 & 符号（SCSS/Less 父级引用）
  return selectors.reduce((acc, selector) => {
    if (!acc) return selector
    
    // 如果选择器包含 &，替换为父级选择器
    if (selector.includes('&')) {
      return selector.replace(/&/g, acc)
    }
    
    // 否则用空格连接（后代选择器）
    return `${acc} ${selector}`
  })
}

/**
 * 检测样式文件的语法类型
 */
function detectSyntax(css: string): Syntax | undefined {
  // 检测 SCSS 特征：$变量、@mixin、嵌套等
  if (/\$[\w-]+\s*:|@mixin|@include|@extend/.test(css)) {
    return postcssScss as Syntax
  }
  
  // 检测 Less 特征：@变量、.mixin()、&:extend 等
  if (/@[\w-]+\s*:\s*[^{};]+;|\.[\w-]+\([^)]*\)\s*\{|&:extend/.test(css)) {
    return postcssLess as Syntax
  }
  
  // 默认使用 SCSS 解析器（更宽松，兼容性更好）
  return postcssScss as Syntax
}

/**
 * 从选择器中提取所有 class 名称
 * 支持复杂选择器：.a.b, .a > .b, .a + .b, .a ~ .b, .a:hover 等
 */
function extractClassNames(selector: string): string[] {
  const classNames: string[] = []
  
  // 匹配 .className 模式，支持连字符、下划线、数字
  // 排除伪类和伪元素（:hover, ::before 等）
  const classRegex = /\.([a-zA-Z_][\w-]*)/g
  let match: RegExpExecArray | null
  
  while ((match = classRegex.exec(selector)) !== null) {
    const className = match[1]
    if (!classNames.includes(className)) {
      classNames.push(className)
    }
  }
  
  return classNames
}

/**
 * 格式化规则文档，显示完整的 CSS 规则
 * @param rule - PostCSS 规则节点
 * @param fullSelector - 完整的选择器（包含嵌套路径）
 */
function formatRuleDoc(rule: Rule, fullSelector?: string): string {
  // 获取规则的所有声明
  const declarations: string[] = []
  rule.walkDecls(decl => {
    // 过滤掉无效或空的声明
    if (decl.prop && decl.value && decl.value.trim()) {
      declarations.push(`${decl.prop}: ${decl.value}`)
    }
  })
  
  if (declarations.length === 0) {
    return '{}'
  }
  
  // 如果提供了完整选择器，使用它（用于显示嵌套后的实际选择器）
  const selector = fullSelector || rule.selector
  
  // 清理选择器中的多余空格和换行
  const cleanSelector = selector.replace(/\s+/g, ' ').trim()
  
  // 格式化为紧凑的单行或多行格式
  if (declarations.length === 1 && declarations[0].length < 50) {
    // 单行简短规则
    return `${cleanSelector} { ${declarations[0]} }`
  } else if (declarations.length <= 3 && declarations.join('; ').length < 80) {
    // 多个声明但总长度不长，使用单行分号分隔
    return `${cleanSelector} { ${declarations.join('; ')} }`
  }
  
  // 多行格式（属性较多或较长）
  return `${cleanSelector} {\n  ${declarations.join(';\n  ')}\n}`
}
