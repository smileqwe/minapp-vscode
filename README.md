<img align="right" width="90px" src="https://funimg.pddpic.com/mobile_piggy/0fe81c13-7691-49ae-bb6e-39586d58a1d7.png.slim.png" alt="wxml language features logo" />

## WXML - Language Service (Enhanced)

> **本项目基于 [wx-minapp/minapp-vscode](https://github.com/wx-minapp/minapp-vscode) 进行增强开发**
> 
> - 原项目作者：[Mora](https://github.com/qiu8310) & [iChenLei](https://github.com/iChenLei)
> - 增强版维护：[smileqwe](https://github.com/smileqwe)
> - 开源协议：[MIT License](./LICENSE)
> - 上游项目：https://github.com/wx-minapp/minapp-vscode
> - 增强版地址：https://github.com/smileqwe/minapp-vscode

[![CI Status](https://github.com/wx-minapp/minapp-vscode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/wx-minapp/minapp-vscode/actions/workflows/ci.yml?query=branch%3Amaster)
[![Deploy Status](https://github.com/wx-minapp/minapp-vscode/actions/workflows/deploy.yml/badge.svg)](https://github.com/wx-minapp/minapp-vscode/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### 🎉 增强版特性

本增强版在原版基础上新增以下功能：

- ✨ **动态属性解析**：支持 `Object.assign()`、扩展运算符、函数返回值等动态生成的组件属性
- 🎯 **智能空格补全**：根据上下文自动识别触发 class 补全或属性补全
- 💡 **表达式变量补全**：在 `{{ }}` 内自动提示可用变量
- 🔍 **变量悬停提示**：鼠标移入模板中的 JS 变量时显示其类型定义和位置
- 🔧 **改进的 AST 解析**：基于 TypeScript AST 的属性解析，支持更复杂的组件定义

详见 [CHANGELOG.md](./CHANGELOG.md) 中的 v2.4.15 版本说明。

### 最近更新 【[CHANGELOG.md](./CHANGELOG.md)】

### 主要功能

* [支持样式文件@import引入]
* [智能空格补全：自动识别上下文触发 class 或属性补全](#smart-space)
* [支持classname显示对应的样式定义]
* [自定义组件动态属性解析（支持 Object.assign、扩展运算符等）](#dynamic-props)
* [模板表达式变量补全（支持 `{{ }}` 内的变量提示）](#expression-completion)
* [变量悬停提示：鼠标移入显示变量类型定义](#variable-hover)
* [一键创建小程序组件](#create-component)
* [标签名与属性自动补全](#tag-and-attr)
* [根据组件已有的属性，自动筛选出对应支持的属性集合](#smart-attr)
* [属性值自动补全](#attr-value)
* [点击模板文件中的函数或属性跳转到 js/ts 定义的地方](#attr-definition)
* [样式名自动补全](#attr-class-value)
* [支持 link](#link)
* [自定义组件自动补全](#custom-component)
* [模板文件中 js 变量高亮](#highlight)
* [内置 snippets](#snippets)
* [支持 emmet 写法](#emmet)
* [wxml 格式化](#wxml-formatter)

> **所有自动补全的模板数据都来自于官方文档，通过[脚本](https://github.com/wx-minapp/minapp-generator)自动获取的**

<a id="smart-space"></a>

### 智能空格补全

插件会根据光标所在的上下文智能判断应该触发哪种补全：

- **在 `class` 属性值内按空格**：触发 CSS class 名称补全（从样式文件中读取）
- **在标签内其他位置按空格**：触发组件属性补全（包括自定义组件的 properties）

```html
<!-- 场景 1：class 属性值内 -->
<view class="container ">
<!-- 按空格，提示 CSS class 名称 -->

<!-- 场景 2：标签内其他位置 -->
<popup >
<!-- 按空格，提示组件的所有属性 -->
```

<a id="dynamic-props"></a>

### 自定义组件动态属性解析

插件支持解析通过动态方式生成的组件属性，包括：

- **`Object.assign()` 合并的属性**
- **扩展运算符 `...` 展开的属性**
- **函数返回值属性（同文件内）**

```javascript
// 组件定义示例
Component({
  properties: Object.assign(
    {},
    generateTrackProps(),           // 函数返回的属性
    { customProp: String }          // 直接定义的属性
  )
})
```

现在在 wxml 中使用该组件时，插件会自动提示所有动态生成的属性。

**注意**：跨文件的函数调用属性暂不支持解析。

<a id="expression-completion"></a>

### 模板表达式变量补全

在模板的 `{{ }}` 表达式内输入时，插件会自动提示可用的变量：

```html
<view>{{ | }}</view>
<!-- 自动提示 data、computed、methods 等中的变量 -->
```

- 支持输入 `{{` 时自动触发补全
- 支持在表达式内手动触发补全（Ctrl+Space / Cmd+Space）

<a id="variable-hover"></a>

### 变量悬停提示

鼠标移入模板中的 JS 变量时，会自动显示该变量的类型定义和所在位置：

```html
<view>{{ userName }}</view>
<!-- 鼠标移入 userName，显示变量定义信息 -->

<view class="{{containerClass}}">
  <!-- 鼠标移入 containerClass，显示其类型和定义位置 -->
</view>

<view>{{ user.name }}</view>
<!-- 支持多级属性访问，显示根变量 user 的定义 -->
```

**支持场景：**
- ✅ `{{ }}` 表达式中的变量
- ✅ 属性值中的变量引用
- ✅ 多级属性访问（如 `obj.prop.subProp`）
- ✅ 数组索引访问（如 `list[0]`）

**显示信息：**
- 📝 变量定义详情（如 `const userName = ""`）
- 📍 定义所在的文件和行号
- 🔗 Cmd/Ctrl + Click 可直接跳转到定义处

<a id="create-component"></a>

### 一键创建小程序组件

* 右键可以看到 `New Miniprogram Component` 选项，输入组件名即可一键创建 `.wxml`/`.js`/`.wxss`/`.json` 以及组件文件夹
* 创建成功后自动打开 `js` 文件

![示例图片](https://funimg.pddpic.com/mobile_piggy/958baa82-f263-402f-8887-b1eaabffbc7c.gif)

* 创建组件支持配置 css/wxml/js 后缀，比如项目使用 less/ts

![示例图片](https://funimg.pddpic.com/mobile_piggy/a4af85c2-d4cb-44f2-aa47-831b80b20c7a.gif)

```jsonc
{
  "minapp-vscode.cssExtname": "less", // 默认 wxss，支持 styl sass scss less css
  "minapp-vscode.wxmlExtname": "wxml", // 默认 wxml
  "minapp-vscode.jsExtname": "ts" // 默认 js，支持 ts
}
```


<a id="tag-and-attr"></a>

### 标签名与属性名自动补全

* wxml 中需要输入 `<` 才会触发标签补全
* 输入空格会触发对应标签的属性补全

![示例图片](https://n1image.hjfile.cn/res7/2018/03/01/13631761451ae134c6eb3ea2ed1a6a12.gif)


<a id="smart-attr"></a>

### 根据组件已有的属性，自动筛选出对应支持的属性集合

- 当 picker 的 mode="selector" 时，有 `range` 和 `range-key` 的属性
- 当 picker 的 mode="time" 时，有 `start` 和 `end` 的属性

![示例图片](https://n1image.hjfile.cn/res7/2018/03/09/5c5704b51a37df84b5c6663d29a545f6.gif)

<a id="attr-value"></a>

### 属性值自动补全（有可选值的情况下才会触发补全）

- 在属性值中输入空格可以触发，补全后自动会将空格覆盖

![示例图片](https://n1image.hjfile.cn/res7/2018/03/10/aaba780a36f1de1b87687295bc6fc922.gif)

<a id="attr-definition"></a>

### 点击模板文件中的函数或属性跳转到 js/ts 定义的地方

**功能还不完善，只会查找和当前模板同名的脚本文件，所以有可能会找不到 JS 中的定义**

![示例图片](https://n1image.hjfile.cn/res7/2018/11/20/c8d41ef5bce1b2128bb7a830d06338b9.gif)

<a id="attr-class-value"></a>

### 样式名自动补全

系统会自动获取和当前模板同名的样式文件中的所有样式名，同时还能获取样式名上的 `/** */` 中的文档；如果有全局的样式，需要通过配置项 `minapp-vscode.globalStyleFiles` 来指定。

- 默认会获取和当前模板同名的样式文件中的名称

  **注意：支持样式文件是 `@import` 了另一个样式文件，则程序会去获取这个引入的文件中的样式名**

- 另外可以使用 `minapp-vscode.globalStyleFiles` 来指定一些全局的样式文件，这样在输入 `class=""` 后就也会出现这些文件中的样式名

  **小程序的 app.wxss 一般是全局的样式，所以需要你手动通过此配置来指定，如配置 `minapp-vscode.globalStyleFiles: ["src/app.wxss"]`**

- 另外也可以使用 `minapp-vscode.styleExtensions` 来指定系统使用的样式文件的后缀

  **建议配置此项，系统默认会查找各种后缀的样式文件，为避免不必要的性能损耗，最好配置成项目中使用的后缀！**

> **注意：不支持 `sass` 这种缩进排版的样式文件**

![示例图片](https://n1image.hjfile.cn/res7/2018/11/15/559184bb3ff7cc2fb76c204010f6f042.gif)

<a id="link"></a>

### 支持 link

* `<template lang="wxml" minapp="native">`   表示使用 wxml 语言，不使用任何框架
* `<template lang="pug" minapp="mpvue">`     表示使用 pug 语言，并使用 mpvue 框架

> 注意，[mpvue 中指定 lang="wxml" 会报错](https://github.com/Meituan-Dianping/mpvue/issues/208)，需要等待作者修复！不过
> 你可以临时使用 `xlang="wxml"`，但这样同时也会触发 vue 的自动补全

指定为不同的 minapp 值会触发对应框架的自动补全，由于本人没有使用 wepy 和 mpvue 开发过，所以这些自动补全是根据官方文档说明而加上的，如果有错误，欢迎 PR（只需要修改文件 [src/plugin/lib/language.ts](https://github.com/wx-minapp/minapp-vscode/blob/main/src/plugin/lib/language.ts))

![示例图片](https://n1image.hjfile.cn/res7/2018/04/09/0b4573624091b04566232c38df08e323.gif)

<a id="link"></a>

### 支持 link（纯 wxml 或 pug 文件才支持，vue 文件不支持）

- 默认只会 link src 标签，并且文件需要存在，不存在不会加 link
- 可以配置 `minapp-vscode.linkAttributeNames` 来扩展额外的支持 link 的标签，将此值配置成空数组，可以禁用 link 功能
- 可以配置 `minapp-vscode.resolveRoots` 来使用相对目录解析图片路径

![示例图片](https://n1image.hjfile.cn/res7/2018/04/27/dd7f301dc1e1593209d7f7ac169fd047.gif)

<a id="custom-component"></a>

### 自定义组件自动补全

- 自动获取对应 json 文件中的组件信息
- 优先提示自定义组件
- 自动获取组件中属性的描述

![示例图片](https://n1image.hjfile.cn/res7/2018/03/09/fce0b3e9496cae95c1c81523725a1fef.gif)

<a id="highlight"></a>

### 模板文件中 js 变量高亮

- 默认关闭高亮，可以配置 `minapp-vscode.disableDecorate` 为 `true` 来开启高亮
- 默认高亮颜色使用紫色，可以配置 `minapp-vscode.decorateType` 来使用你喜欢的颜色，如 `{"color": "red"}`
- 默认会将 "{{" 与 "}}" 之间的所有字符都高亮，可以配置 `minapp-vscode.decorateComplexInterpolation` 为 `false`，这样只有变量（如：`foo`, `foo.prop`, `foo[1]`）会高亮，而表达式（如：`foo + bar`, `foo < 3`）不会高亮，而使用原本的颜色

![示例图片](https://n1image.hjfile.cn/res7/2018/05/07/c6dd2e8613fbb02417029fb3dbd302ce.png)

**为了加快解析速度，颜色高亮使用的是正则表达式匹配，所以可能会出现匹配错误的情况；如果不满意，可以配置 `minapp-vscode.disableDecorate` 来禁用颜色高亮功能**

<a id="snippets"></a>

### 内置 snippets

  - 自带 swiper/icon/button/picker time/picker date/picker region/checkbox-group/radio-group，见[文件](https://github.com/wx-minapp/minapp-vscode/blob/main/src/plugin/res/snippets.ts)
  - 可以通过配置项 `minapp-vscode.snippets` 来定义你自己的 snippets

  _和官方的 Snippets 的区别时，这里的 Snippets 只需要指定 key 和 body 即可，组件描述自动会根据 key 来获取（另外后期可以让配置和内置的数据结合起来）_

  ![示例图片](https://n1image.hjfile.cn/res7/2018/05/26/4a25927085e96e6bd9f05bf735621a8b.gif)

<a id="emmet"></a>

### 支持 emmet 写法

![示例图片](https://n1image.hjfile.cn/res7/2018/06/22/2f692e4cf499d712d34f593a3e813522.gif)

[emmet cheat sheet](https://docs.emmet.io/cheat-sheet/)

<a id="wxml-formatter"></a>

### wxml 格式

支持`prettyHtml`, `js-beautify` 和`prettier`(部分内容需要采用兼容html的方式书写)

* 默认 `wxml`
```jsonc
"minapp-vscode.wxmlFormatter": "wxml", // 指定格式化工具
```

* [js-beautify](https://github.com/beautify-web/js-beautify#css--html)
```jsonc
"minapp-vscode.wxmlFormatter": "jsBeautifyHtml", // 指定格式化工具
// 使用 vscode settings.json 中的 `html.format.[配置字段]` 配置字段, 详见下方 tips.4
"minapp-vscode.jsBeautifyHtml": "useCodeBuiltInHTML",
// 使用自定义配置
"minapp-vscode.jsBeautifyHtml": { // jsBeautify 默认配置
    "content_unformatted": "text",
    "wrap_attributes": "force",
    "indent_size": 2,
    "wrap_attributes_indent_size": 2,
    "void_elements": "image,input,video",
    "indent_scripts": "keep"
}
```

* [prettyHtml](https://github.com/Prettyhtml/prettyhtml#prettyhtmldoc-string-options-vfile)
```jsonc
"minapp-vscode.wxmlFormatter": "prettyHtml", // 指定格式化工具
"minapp-vscode.prettyHtml": { // prettyHtml 默认配置
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 100,
  "singleQuote": false,
  "usePrettier": true,
  "wrapAttributes": false, // 设置成 true 强制属性换行
  "sortAttributes": false
}
```
* [prettier](https://github.com/prettier/prettier)
```jsonc
"minapp-vscode.wxmlFormatter": "prettier", // 指定格式化工具
"minapp-vscode.prettier": { // prettier 更多参考 https://prettier.io/docs/en/options.html
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 100,
  "singleQuote": false
}
```
* tips:
  1. 针对`prettyHtml` 和 `prettier` 方式，会自动读取项目下的配置文件，[Prettier configuration file](https://prettier.io/docs/en/configuration.html) `.editorconfig`
  2. 切换格式化工具需重启 VSCode
  3. 针对 `prettyHtml` ，和 `prettier` 采用 HTML5 的语法和 wxml 不完全一致，写法要注意兼容
  4. 针对 `jsBeautifyHtml` , 当值为 `"useCodeBuiltInHTML"`时, 配置信息将从 vscode 配置中的 `html.format.*` 配置字段[doc](https://code.visualstudio.com/docs/languages/html#_formatting) 读取, 转换为 [js-beautify](https://github.com/beautify-web/js-beautify#css--html) 的配置

---

## 📝 完整配置项说明

### 基础配置

```jsonc
{
  // 项目根目录配置（绝对路径）
  "minapp-vscode.rootPath": "/Users/username/project",  // 项目真正的根目录（绝对路径）
  
  // 组件创建相关
  "minapp-vscode.cssExtname": "wxss",      // CSS 文件扩展名，默认 wxss，支持 styl/sass/scss/less/css
  "minapp-vscode.wxmlExtname": "wxml",     // WXML 文件扩展名，默认 wxml
  "minapp-vscode.jsExtname": "js",         // JS 文件扩展名，默认 js，支持 ts
}
```

**`rootPath` 详细说明：**

当你不是在项目根目录打开 VSCode 时（比如打开的是子目录），需要配置 `rootPath` 告诉插件真正的项目根目录位置。**必须使用绝对路径。**

**使用场景：**

```bash
# 场景 1：在子目录中打开 VSCode
your-project/
  ├── package.json          # 项目根目录在这里
  ├── src/
  │   └── miniapp/         # 你在这里打开 VSCode
  │       ├── pages/
  │       └── components/

# 配置：.vscode/settings.json
{
  "minapp-vscode.rootPath": "/Users/username/your-project"  # 绝对路径指向项目根目录
}

# 场景 2：monorepo 项目
monorepo/
  ├── package.json          # monorepo 根目录
  ├── packages/
  │   ├── miniapp/         # 小程序子包，你在这里打开
  │   │   ├── package.json
  │   │   └── src/
  │   └── components/

# 配置：packages/miniapp/.vscode/settings.json
{
  "minapp-vscode.rootPath": "/Users/username/monorepo",      # 绝对路径指向 monorepo 根目录
  "minapp-vscode.resolveRoots": [
    "packages/miniapp/src",
    "packages/components"
  ]
}

# 场景 3：多个小程序在同一个仓库
project/
  ├── miniapp-a/           # 小程序 A，你在这里打开
  │   ├── pages/
  │   └── app.json
  ├── miniapp-b/
  └── shared/

# 配置：miniapp-a/.vscode/settings.json
{
  "minapp-vscode.rootPath": "/Users/username/project",       # 绝对路径指向父目录
  "minapp-vscode.resolveRoots": [
    "miniapp-a",
    "shared"
  ]
}

# Windows 系统示例
{
  "minapp-vscode.rootPath": "C:\\Users\\username\\project"   # Windows 使用反斜杠或正斜杠均可
}
```

**注意事项：**
- ⚠️ **必须使用绝对路径**，不支持相对路径
- 配置 `rootPath` 后，`resolveRoots` 和 `globalStyleFiles` 等路径都相对于 `rootPath` 解析
- 如果在项目根目录打开，无需配置此项
- 推荐在项目的 `.vscode/settings.json` 中配置，避免影响其他项目
- 团队协作时，建议将此配置放在用户级设置，因为每个人的绝对路径可能不同

### 样式相关配置

```jsonc
{
  // 全局样式文件路径（用于 class 补全）
  "minapp-vscode.globalStyleFiles": [
    "src/app.wxss",                        // 小程序全局样式文件
    "src/common/styles/global.wxss"        // 其他全局样式
  ],
  
  // 样式文件扩展名（建议配置以优化性能）
  "minapp-vscode.styleExtensions": [
    "wxss",
    "scss",
    "less"
  ]
}
```

### 自定义组件配置

```jsonc
{
  // 解析自定义组件的根目录（相对于项目根目录）
  // 用于解析自定义组件路径和静态资源路径
  "minapp-vscode.resolveRoots": [
    "src",                                 // 源码目录
    "components",                          // 组件目录
    "miniprogram"                          // 小程序根目录
  ],
  
  // 禁用基础属性的组件列表
  "minapp-vscode.noBasicAttrsComponents": [
    "custom-component"
  ]
}
```

**`resolveRoots` 详细说明：**

`resolveRoots` 用于配置路径解析的根目录，影响以下功能：

1. **自定义组件路径解析**
   ```json
   // app.json 或 page.json
   {
     "usingComponents": {
       "my-component": "/components/my-component"
     }
   }
   ```
   插件会在 `resolveRoots` 配置的目录中查找 `/components/my-component`

2. **静态资源路径解析（link 功能）**
   ```html
   <image src="/images/logo.png" />
   ```
   插件会在 `resolveRoots` 配置的目录中查找 `/images/logo.png`

3. **样式文件路径解析**
   ```css
   @import "/common/styles/base.wxss";
   ```
   插件会在 `resolveRoots` 配置的目录中查找样式文件

**配置示例：**

```jsonc
// 场景 1：标准小程序项目结构
{
  "minapp-vscode.resolveRoots": ["src"]
}
// 项目结构：
// src/
//   ├── pages/
//   ├── components/
//   └── images/

// 场景 2：Taro/uni-app 等框架
{
  "minapp-vscode.resolveRoots": ["src", "dist"]
}
// src/ 是源码目录，dist/ 是编译输出目录

// 场景 3：多包项目（如使用 pnpm workspace）
{
  "minapp-vscode.resolveRoots": [
    "packages/main/src",
    "packages/components/src",
    "packages/shared"
  ]
}

// 场景 4：monorepo 项目
{
  "minapp-vscode.resolveRoots": [
    "apps/miniapp/src",
    "packages/ui/src",
    "packages/utils"
  ]
}
```

**注意事项：**
- 路径相对于项目根目录（workspace root）
- 支持配置多个根目录，插件会依次查找
- 如果不配置，默认只在项目根目录查找
- 合理配置可以显著提升组件和资源的识别准确性

### Link 功能配置

```jsonc
{
  // 支持 link 的属性名列表（设为空数组可禁用 link 功能）
  "minapp-vscode.linkAttributeNames": [
    "src",
    "image",
    "icon"
  ]
}
```

### 变量高亮配置

```jsonc
{
  // 是否禁用变量高亮装饰（true 为禁用，false 为启用）
  "minapp-vscode.disableDecorate": true,
  
  // 装饰样式配置
  "minapp-vscode.decorateType": {
    "color": "#e673a8",                    // 自定义颜色
    "fontWeight": "bold"                   // 可选：bold
  },
  
  // 是否高亮复杂表达式（false 时只高亮变量，不高亮表达式）
  "minapp-vscode.decorateComplexInterpolation": true
}
```

### Snippets 配置

```jsonc
{
  // 自定义代码片段
  "minapp-vscode.snippets": {
    "my-custom-view": "<view class=\"custom\">$1</view>$0",
    "my-button": "<button type=\"primary\" bindtap=\"$1\">$2</button>$0"
  }
}
```

### 完整配置示例

```jsonc
{
  // === 项目根目录（非根目录打开时配置，使用绝对路径） ===
  "minapp-vscode.rootPath": "/Users/username/project",       // 指向真正的项目根目录（绝对路径）
  
  // === 组件创建 ===
  "minapp-vscode.cssExtname": "scss",
  "minapp-vscode.wxmlExtname": "wxml",
  "minapp-vscode.jsExtname": "ts",
  
  // === 格式化 ===
  "minapp-vscode.wxmlFormatter": "prettier",
  "minapp-vscode.prettier": {
    "tabWidth": 2,
    "singleQuote": true,
    "printWidth": 120
  },
  
  // === 样式补全 ===
  "minapp-vscode.globalStyleFiles": ["src/app.wxss"],
  "minapp-vscode.styleExtensions": ["wxss", "scss"],
  
  // === 组件解析 ===
  "minapp-vscode.resolveRoots": ["src", "components"],  // 配置路径解析根目录，支持多个
  
  // === 变量高亮 ===
  "minapp-vscode.disableDecorate": false,
  "minapp-vscode.decorateType": {
    "color": "#e673a8"
  },
  
  // === Link ===
  "minapp-vscode.linkAttributeNames": ["src", "image"],
  
  // === 自定义 Snippets ===
  "minapp-vscode.snippets": {
    "view-container": "<view class=\"container\">$1</view>$0"
  }
}
```

### 配置优先级

1. **项目级配置** (`.vscode/settings.json`) - 优先级最高
2. **用户级配置** (VSCode Settings) - 全局配置
3. **默认配置** - 插件内置默认值

建议将项目特定的配置（如 `globalStyleFiles`、`resolveRoots`）放在项目级配置中。

---

### 常见问题

#### 安装插件后没有出现自动补全

1. 确保安装后有重启过 VSCode
2. 确保当前文件的格式是 wxml (不能看文件后缀名，因为可能在配置文件中把它们关联的其它文件格式；需要看 vscode 右下角显示的文件类型)

---

## 🙏 致谢与贡献

### 致谢原项目

本项目基于 [wx-minapp/minapp-vscode](https://github.com/wx-minapp/minapp-vscode) 进行增强开发。

**原项目核心贡献者：**
- [Mora (qiu8310)](https://github.com/qiu8310) - 原项目创建者
- [iChenLei](https://github.com/iChenLei) - 项目维护者
- 以及所有为原项目做出贡献的开发者们

感谢他们创建并维护了这个优秀的小程序开发工具！

### 增强版改进

本增强版由 [smileqwe](https://github.com/smileqwe) 维护，主要改进包括：

- 基于 TypeScript AST 的动态属性解析
- 智能上下文补全
- 模板表达式变量提示
- 更完善的配置文档

### 参与贡献

欢迎提交 Issue 和 Pull Request！

**贡献指南：**

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交改动 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

**提交规范：**
- `feat:` 新功能
- `fix:` 修复 bug
- `docs:` 文档更新
- `style:` 代码格式调整
- `refactor:` 重构
- `test:` 测试相关
- `chore:` 构建/工具链相关

### 开源协议

本项目采用 [MIT License](./LICENSE) 开源协议。

基于原项目 [wx-minapp/minapp-vscode](https://github.com/wx-minapp/minapp-vscode) 开发，同样遵循 MIT License。

**MIT License 允许：**
- ✅ 商业使用
- ✅ 修改
- ✅ 分发
- ✅ 私人使用

**要求：**
- 📄 保留版权和许可声明
- 📄 说明修改内容

### 联系方式

- 🐛 Issues: [GitHub Issues](https://github.com/smileqwe/minapp-vscode/issues)
- 📖 上游项目: [wx-minapp/minapp-vscode](https://github.com/wx-minapp/minapp-vscode)
- 📖 增强版仓库: [smileqwe/minapp-vscode](https://github.com/smileqwe/minapp-vscode)

---

## 📜 版权声明

```
Original work Copyright (c) 2017-2023 Mora <qiuzhongleiabc@126.com>
Modified work Copyright (c) 2025 smileqwe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

完整协议见 [LICENSE](./LICENSE) 文件。
