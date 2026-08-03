/**
 * 属性命名风格转换与兼容匹配
 *
 * 纯函数实现，不依赖 vscode 模块，可单测。
 *
 * 小程序组件 properties 在 JS 里用驼峰（如 userName），
 * 在 WXML 里既可以用驼峰 userName 也可以用中划线 user-name（框架自动转换）。
 *
 * 本模块提供：
 *   - camelToKebab / kebabToCamel：命名转换
 *   - attrNameEquals：兼容匹配（驼峰与中划线互通）
 *   - normalizeAttrName：按配置风格归一化属性名
 */

/** 属性命名风格 */
export type AttrNameStyle = 'auto' | 'camel' | 'kebab'

/** 驼峰转中划线：userName → user-name */
export function camelToKebab(name: string): string {
  // 不含大写字母，无需转换
  if (!/[A-Z]/.test(name)) return name
  return name.replace(/([A-Z])/g, (_, upper: string) => '-' + upper.toLowerCase()).replace(/^-/, '') // 首字母大写时避免开头多一个 -
}

/** 中划线转驼峰：user-name → userName */
export function kebabToCamel(name: string): string {
  // 不含中划线，无需转换
  if (!name.includes('-')) return name
  return name.replace(/-([a-zA-Z])/g, (_, char: string) => char.toUpperCase())
}

/**
 * 判断两个属性名是否等价（驼峰与中划线互通）
 *
 * @example
 *   attrNameEquals('userName', 'user-name') // true
 *   attrNameEquals('userName', 'userName')  // true
 *   attrNameEquals('user-name', 'user-name') // true
 *   attrNameEquals('userName', 'age')       // false
 */
export function attrNameEquals(a: string, b: string): boolean {
  if (a === b) return true
  return kebabToCamel(a) === kebabToCamel(b)
}

/**
 * 检查属性名是否已存在于已写属性集合中（兼容驼峰/中划线）
 *
 * @param attrName 要检查的属性名
 * @param existsTagAttrs 当前已写的属性集合
 */
export function attrNameExists(attrName: string, existsTagAttrs: { [key: string]: string | boolean }): boolean {
  // 快速路径：直接命中
  if (existsTagAttrs[attrName] != null) return true
  // 慢速路径：转换后匹配
  const camel = kebabToCamel(attrName)
  const kebab = camelToKebab(attrName)
  return existsTagAttrs[camel] != null || existsTagAttrs[kebab] != null
}

/**
 * 按配置风格归一化属性名（用于补全列表插入）
 *
 * @param name 原始属性名（通常是 properties 里的驼峰名）
 * @param style 目标风格
 * @param autoDecider auto 模式下的判断函数，返回 'camel' 或 'kebab'。
 *                    调用方根据当前文件已有写法决定。若未提供，auto 退化为 camel。
 */
export function normalizeAttrName(name: string, style: AttrNameStyle, autoDecider?: () => 'camel' | 'kebab'): string {
  // 不含大写字母的属性名无需转换（如 data、src 等原生属性）
  if (!/[A-Z]/.test(name)) return name

  switch (style) {
    case 'kebab':
      return camelToKebab(name)
    case 'camel':
      return name
    case 'auto':
      return autoDecider ? (autoDecider() === 'kebab' ? camelToKebab(name) : name) : name
    default:
      return name
  }
}
