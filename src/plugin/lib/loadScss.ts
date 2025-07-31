import * as Sass from 'sass' // 只引入 typings
import { config } from './config'
import { readFileSync } from 'fs'
import { requireLocalPkg } from './requirePackage'

type SassType = typeof Sass
/**
 * 尝试加载本地 node-sass/sass
 */
function autoRequireSass(file: string): SassType {
  try {
    return requireLocalPkg<SassType>(file, 'sass')
  } catch (error) {
    return requireLocalPkg<SassType>(file, 'node-sass')
  }
}
/**
 * 渲染scss
 * @param op sass 配置
 */
export default function(op: Sass.Options): string {
  try {
    let imports = ''
    const options: Sass.Options = {
      ...config.sass,
      ...op,
      sourceMap: false,
      sourceMapContents: false,
      importer: (url) => {
        imports += `@import "${url}";`
        return { contents: '' }
      }
    }
    const a = autoRequireSass(op.file || process.cwd())
    .renderSync(options)
    
    return imports + a.css.toString()
  } catch (error) {
    // sass 渲染失败退回
    console.error(error)
    return op.data || (op.file ? readFileSync(op.file).toString() : '')
  }
}
