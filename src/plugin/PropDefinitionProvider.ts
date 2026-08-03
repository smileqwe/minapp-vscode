import { Config } from './lib/config'
import { DefinitionProvider, TextDocument, Position, CancellationToken, Location, Uri, Range } from 'vscode'
import { getTagAtPosition } from './getTagAtPosition'
import { getClass } from './lib/StyleFile'
import { getProp } from './lib/ScriptFile'
import { definitionTagName } from '../common/src'
import { getCustomOptions, getLanguage } from './lib/helper'
import { getVisibleWxForBindings } from './lib/wxmlForScope'
import { kebabToCamel } from '../common/src/attrNameCase'

const reserveWords = ['true', 'false']

/**
 * 若 word 是当前 wx:for 作用域内的循环变量,返回定义位置的 Location(wxml 自身);否则 null。
 */
function tryResolveWxForLocation(document: TextDocument, position: Position, word: string): Location | null {
  if (!word) return null
  const text = document.getText()
  const cursorOffset = document.offsetAt(position)
  const bindings = getVisibleWxForBindings(text, cursorOffset)
  const hit = bindings.find(b => b.name === word)
  if (!hit) return null
  const start = document.positionAt(hit.defOffset)
  const end = document.positionAt(hit.defOffset + word.length)
  return new Location(document.uri, new Range(start, end))
}

export class PropDefinitionProvider implements DefinitionProvider {
  constructor(public config: Config) {}
  public async provideDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Location[]> {
    console.log('[PropDefinition] provideDefinition 被调用')
    const tag = getTagAtPosition(document, position)
    const locs: Location[] = []

    console.log(
      '[PropDefinition] tag:',
      tag
        ? `存在，name: ${tag.name}, isOnAttrValue: ${tag.isOnAttrValue}, attrName: ${tag.attrName}, posWord: ${tag.posWord}`
        : '不存在'
    )

    if (tag) {
      const language = getLanguage(document, position)
      if (tag.isOnTagName) {
        if (language) {
          const component = await definitionTagName(tag.name, language, getCustomOptions(this.config, document))
          if (component && component.path) {
            locs.push(new Location(Uri.file(component.path), new Position(0, 0)))
          }
        }
        return locs
      }
      const { attrs, attrName, posWord } = tag
      const rawAttrValue = ((attrs['__' + attrName] || '') as string).replace(/^['"]|['"]$/g, '') // 去除引号

      // === wx:for 作用域优先:posWord 若命中循环变量,直接返回 wxml 自身 Location ===
      // 注意:posWord 由 /\b[\w-:.]+\b/ 提取,对 {{item.title}} 会得到 "item.title",
      //      需取根变量 "item" 再匹配 wx:for 变量名
      if (posWord && tag.isOnAttrValue) {
        const rootVar = posWord.includes('.') ? posWord.split('.')[0] : posWord
        const wxForLoc = tryResolveWxForLocation(document, position, rootVar)
        if (wxForLoc) {
          console.log(`[PropDefinition] 命中 wx:for 变量: ${rootVar}${rootVar !== posWord ? ` (from ${posWord})` : ''}`)
          return [wxForLoc]
        }
      }

      console.log('[PropDefinition] rawAttrValue:', rawAttrValue)
      console.log('[PropDefinition] 检查条件: attrName.endsWith(".sync"):', attrName.endsWith('.sync'))
      console.log(
        '[PropDefinition] 检查条件: startsWith:',
        rawAttrValue.startsWith('{{'),
        'endsWith:',
        rawAttrValue.endsWith('}}')
      )
      if (!tag.isOnAttrValue && posWord && language) {
        // 处理属性跳转
        const component = await definitionTagName(tag.name, language, getCustomOptions(this.config, document))
        if (component && component.path) {
          // posWord 可能是中划线写法（fixed-placeholder），js 里 properties 定义是驼峰（fixedPlaceholder）
          // 转成驼峰再查找
          const propName = kebabToCamel(posWord)
          return this.searchScript('prop', propName, { fileName: component.path })
        }
      }
      // 不在属性上

      if (!tag.isOnAttrValue) {
        console.log('[PropDefinition] 不在属性值上，返回空')
        return locs
      }

      // 忽略特殊字符或者以数字开头的单词
      if (reserveWords.includes(posWord) || /^\d/.test(posWord)) {
        console.log('[PropDefinition] 是保留字或数字开头，返回空')
        return locs
      }

      console.log('[PropDefinition] 开始检查属性类型，attrName:', attrName)

      if (attrName.endsWith('class')) {
        console.log('[PropDefinition] 是 class 属性')
        return this.searchStyle(posWord, document, position)
      } else if (attrName.endsWith('.sync') || (rawAttrValue.includes('{{') && rawAttrValue.includes('}}'))) {
        // 处理 {{ }} 表达式，支持属性访问（包括 style="width:{{...}}" 这种格式）
        console.log(`[PropDefinition] 检测到 {{ }} 表达式，rawAttrValue: ${rawAttrValue}, posWord: ${posWord}`)

        // 使用正则提取所有 {{ }} 内的内容
        const expressionMatches = rawAttrValue.match(/\{\{([^}]*)\}\}/g)
        console.log(`[PropDefinition] 提取到的表达式: ${expressionMatches}`)

        if (expressionMatches && expressionMatches.length > 0) {
          // 取第一个表达式进行处理（通常一个属性值只有一个表达式）
          const innerExpression = expressionMatches[0].replace(/^\{\{|\}\}$/g, '').trim()
          console.log(`[PropDefinition] 表达式内容: ${innerExpression}`)

          // 如果是属性访问表达式（包含点）
          if (innerExpression.includes('.')) {
            // 获取光标在属性值中的位置
            const attrValueRange = document.getWordRangeAtPosition(position, /\{\{[^}]*\}\}/)
            if (attrValueRange) {
              const fullText = document.getText(attrValueRange).replace(/^\{\{\s*|\s*\}\}$/g, '')
              const rangeStart = attrValueRange.start
              const cursorOffset = document.offsetAt(position) - document.offsetAt(rangeStart) - 2 // 减去 '{{' 的长度

              console.log(`[PropDefinition] fullText: ${fullText}, cursorOffset: ${cursorOffset}`)

              // 解析表达式，获取完整属性路径
              const propertyInfo = this.extractPropertyAtPosition(fullText, cursorOffset, false)
              console.log(`[PropDefinition] 完整属性路径: ${propertyInfo}`)

              if (propertyInfo && propertyInfo.includes('.')) {
                const parts = propertyInfo.split('.')
                const cursorInExpression = fullText.indexOf(propertyInfo)
                const relativeOffset = cursorOffset - cursorInExpression

                // 确定光标在哪个部分
                let currentOffset = 0
                for (let i = 0; i < parts.length; i++) {
                  const part = parts[i]
                  const partEnd = currentOffset + part.length

                  if (relativeOffset >= currentOffset && relativeOffset <= partEnd) {
                    console.log(`[PropDefinition] 光标在第 ${i} 个部分: ${part}，跳转到根变量: ${parts[0]}`)
                    // 无论光标在哪个部分，都跳转到根变量
                    return this.searchScript('prop', parts[0], document)
                  }

                  currentOffset = partEnd + 1 // +1 for the dot
                }
              }
            }
          }
        }

        // 回退到简单变量处理
        console.log(`[PropDefinition] 回退到简单变量处理: ${posWord}`)
        return this.searchScript('prop', posWord, document)
      } else if (
        /^(mut-bind|capture-catch|capture-bind|bind|catch)/.test(attrName) ||
        /\.(user|stop|default)$/.test(attrName)
      ) {
        return this.searchScript('method', posWord, document)
      } else if (document.getWordRangeAtPosition(position, /\{\{[\s\w]+\}\}/)) {
        /**
         * fix case like:
         * ```wxml
         * style="height: {{bottom}}rpx"
         * ```
         */
        return this.searchScript('method', posWord, document)
      }
    } else {
      // 判断是否是在 {{ }} 中
      // 修改正则表达式以匹配更复杂的表达式
      const range = document.getWordRangeAtPosition(position, /\{\{[^}]*\}\}/)
      if (!range) return locs

      const fullText = document.getText(range).replace(/^\{\{\s*|\s*\}\}$/g, '')

      // 获取光标在表达式中的具体位置
      const rangeStart = range.start
      const cursorOffset = document.offsetAt(position) - document.offsetAt(rangeStart) - 2 // 减去 '{{' 的长度

      // 解析表达式，获取完整属性路径和光标所在位置
      const propertyInfo = this.extractPropertyAtPosition(fullText, cursorOffset, false)

      if (propertyInfo) {
        console.log(`[PropDefinition] 完整属性路径: ${propertyInfo}, 光标位置: ${cursorOffset}`)

        const rootVar = propertyInfo.split('.')[0]
        // === wx:for 作用域优先 ===
        const wxForLoc = tryResolveWxForLocation(document, position, rootVar)
        if (wxForLoc) {
          console.log(`[PropDefinition] {{ }} 内命中 wx:for 变量: ${rootVar}`)
          return [wxForLoc]
        }

        // 如果是属性访问（包含点），尝试智能跳转
        if (propertyInfo.includes('.')) {
          const parts = propertyInfo.split('.')
          const cursorInExpression = fullText.indexOf(propertyInfo)
          const relativeOffset = cursorOffset - cursorInExpression

          // 确定光标在哪个部分
          let currentOffset = 0
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i]
            const partEnd = currentOffset + part.length

            if (relativeOffset >= currentOffset && relativeOffset <= partEnd) {
              console.log(`[PropDefinition] 光标在第 ${i} 个部分: ${part}`)
              // 如果光标在第一个部分（根变量），跳转到根变量
              if (i === 0) {
                return this.searchScript('prop', part, document)
              }
              // 如果光标在后续属性上，目前只跳转到根变量
              // TODO: 未来可以通过类型推断跳转到具体属性定义
              console.log(`[PropDefinition] 光标在属性 ${part} 上，跳转到根变量 ${parts[0]}`)
              return this.searchScript('prop', parts[0], document)
            }

            currentOffset = partEnd + 1 // +1 for the dot
          }
        }

        // 简单变量，直接跳转
        return this.searchScript('prop', propertyInfo, document)
      }

      // 如果无法精确定位，尝试提取根变量
      const rootVariable = this.extractPropertyAtPosition(fullText, cursorOffset, true)
      if (rootVariable) {
        return this.searchScript('prop', rootVariable, document)
      }

      // 最后回退到原来的逻辑
      return this.searchScript('prop', fullText, document)
    }
    return locs
  }

  searchScript(type: 'prop' | 'method', word: string, doc: { fileName: string }): Location[] {
    return getProp(doc.fileName, type, word).map(p => p.loc)
  }

  async searchStyle(className: string, document: TextDocument, position: Position): Promise<Location[]> {
    const locs: Location[] = []

    const styleFiles = await getClass(document, this.config)
    styleFiles.forEach(styfile => {
      styfile.styles.forEach(sty => {
        if (sty.name === className) {
          const start = sty.pos
          const end = new Position(start.line, 1 + start.character + className.length)
          locs.push(new Location(Uri.file(styfile.file), new Range(start, end)))
        }
      })
    })

    return locs
  }
  /**
   * 从复杂表达式中提取光标位置对应的属性名
   * @param expression 表达式内容
   * @param cursorOffset 光标在表达式中的偏移量
   * @param extractRootVariable 是否提取根变量（如从 a.b.c 中提取 a）
   */
  private extractPropertyAtPosition(
    expression: string,
    cursorOffset: number,
    extractRootVariable = false
  ): string | null {
    // 移除表达式前后的空白
    const trimmedExpression = expression.trim()
    const trimOffset = expression.indexOf(trimmedExpression)
    const adjustedOffset = cursorOffset - trimOffset

    if (adjustedOffset < 0 || adjustedOffset > trimmedExpression.length) {
      return null
    }

    // 使用正则表达式找到所有可能的属性引用（支持多级属性访问）
    // 匹配：identifier, identifier.property, identifier.property.subProperty 等
    const propertyRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*/g
    let match

    while ((match = propertyRegex.exec(trimmedExpression)) !== null) {
      const start = match.index
      const end = match.index + match[0].length

      // 检查光标是否在这个属性范围内
      if (adjustedOffset >= start && adjustedOffset <= end) {
        const fullProperty = match[0]
        console.log(
          `[extractPropertyAtPosition] 找到属性: ${fullProperty}, 范围: [${start}, ${end}], 光标: ${adjustedOffset}`
        )

        if (extractRootVariable) {
          // 提取根变量：从 a.b.c 中提取 a
          const rootVariable = fullProperty.split('.')[0]
          console.log(`[extractPropertyAtPosition] 提取根变量: ${rootVariable}`)
          return rootVariable
        } else {
          // 返回完整的属性路径
          console.log(`[extractPropertyAtPosition] 返回完整路径: ${fullProperty}`)
          return fullProperty
        }
      }
    }

    console.log(`[extractPropertyAtPosition] 未找到精确匹配，尝试查找最近的单词`)

    // 如果没有找到精确匹配，尝试找到光标附近的单词
    const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g
    let closestMatch = null
    let closestDistance = Infinity

    while ((match = wordRegex.exec(trimmedExpression)) !== null) {
      const start = match.index
      const end = match.index + match[0].length
      const distance = Math.min(Math.abs(adjustedOffset - start), Math.abs(adjustedOffset - end))

      if (distance < closestDistance) {
        closestDistance = distance
        closestMatch = match[0]
      }
    }

    console.log(`[extractPropertyAtPosition] 最近的单词: ${closestMatch}`)
    return closestMatch
  }

  /**
   * 提取属性的根变量
   * @param property 属性字符串，如 'a.b.c'
   * @returns 根变量，如 'a'
   */
  //  private extractRootVariable(property: string): string {
  //    return property.split('.')[0]
  //  }
}
