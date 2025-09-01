import { Config } from './lib/config'
import { DefinitionProvider, TextDocument, Position, CancellationToken, Location, Uri, Range } from 'vscode'
import { getTagAtPosition } from './getTagAtPosition'
import { getClass } from './lib/StyleFile'
import { getProp } from './lib/ScriptFile'
import { definitionTagName } from '../common/src'
import { getCustomOptions, getLanguage } from './lib/helper'

const reserveWords = ['true', 'false']

export class PropDefinitionProvider implements DefinitionProvider {
  constructor(public config: Config) {}
  public async provideDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Location[]> {
    const tag = getTagAtPosition(document, position)
    const locs: Location[] = []

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

      if (!tag.isOnAttrValue && posWord && language) {
        // 处理属性跳转
        const component = await definitionTagName(tag.name, language, getCustomOptions(this.config, document))
        if (component && component.path) {
          // locs.push(new Location(Uri.file(component.path), new Position(0, 0)))
          return this.searchScript('prop', posWord, { fileName: component.path })
        }
      }
      // 不在属性上

      if (!tag.isOnAttrValue) return locs

      // 忽略特殊字符或者以数字开头的单词
      if (reserveWords.includes(posWord) || /^\d/.test(posWord)) return locs

      if (attrName.endsWith('class')) {
        return this.searchStyle(posWord, document, position)
      } else if (attrName.endsWith('.sync') || (rawAttrValue.startsWith('{{') && rawAttrValue.endsWith('}}'))) {
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
      
      // 解析表达式，找到光标位置对应的属性
      const targetProperty = this.extractPropertyAtPosition(fullText, cursorOffset, true)
      
      if (targetProperty) {
        return this.searchScript('prop', targetProperty, document)
      }
      
      // 如果无法精确定位，回退到原来的逻辑
      return this.searchScript('prop', fullText, document)
    }
    return locs
  }

  searchScript(type: 'prop' | 'method', word: string, doc: { fileName: string }): Location[] {
    return getProp(doc.fileName, type, word).map(p => p.loc)
  }

  searchStyle(className: string, document: TextDocument, position: Position): Location[] {
    const locs: Location[] = []

    getClass(document, this.config).forEach(styfile => {
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
   private extractPropertyAtPosition(expression: string, cursorOffset: number, extractRootVariable = false): string | null {
     // 移除表达式前后的空白
     const trimmedExpression = expression.trim()
     const trimOffset = expression.indexOf(trimmedExpression)
     const adjustedOffset = cursorOffset - trimOffset
     
     if (adjustedOffset < 0 || adjustedOffset > trimmedExpression.length) {
       return null
     }
     
     // 使用正则表达式找到所有可能的属性引用
     const propertyRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*/g
     let match
     
     while ((match = propertyRegex.exec(trimmedExpression)) !== null) {
       const start = match.index
       const end = match.index + match[0].length
       
       // 检查光标是否在这个属性范围内
       if (adjustedOffset >= start && adjustedOffset <= end) {
         const fullProperty = match[0]
         
         if (extractRootVariable) {
           // 提取根变量：从 a.b.c 中提取 a
           const rootVariable = fullProperty.split('.')[0]
           return rootVariable
         } else {
           // 返回完整的属性路径
           return fullProperty
         }
       }
     }
     
     // 如果没有找到精确匹配，尝试找到光标附近的单词
     const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g
     let closestMatch = null
     let closestDistance = Infinity
     
     while ((match = wordRegex.exec(trimmedExpression)) !== null) {
       const start = match.index
       const end = match.index + match[0].length
       const distance = Math.min(
         Math.abs(adjustedOffset - start),
         Math.abs(adjustedOffset - end)
       )
       
       if (distance < closestDistance) {
         closestDistance = distance
         closestMatch = match[0]
       }
     }
     
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

 