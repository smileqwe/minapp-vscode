# 2.5.0 / 2026-08-03

### ✨ 新增功能

- **三方框架封装的启发式探测**

  - 新增 `configObjectHeuristics` 模块，通过 `data`/`methods`/`properties`/`lifecycle` 等关键字评分机制，自动识别 `MyPage`、`createPage`、`Anim.Page`、`Anim.Component` 等三方框架封装的配置对象
  - 无需硬编码入口名白名单，得分超过阈值即判定为小程序配置对象
  - 集成到 `ScriptFile` 作为 Layer 1 兜底，在 `visit()` 之前执行，避免 `setData` 等噪音干扰（如 `Anim.Page` 封装）
  - 支持识别 `computed` section，覆盖更多框架封装场景
  - `CollectedHit` 新增 `confidence` 置信度字段，提升兜底结果的可追溯性

- **LinkProvider 注册与 Ctrl+Click 导航**

  - 修复 `LinkProvider` 实现完整但从未在 `activate()` 中注册的问题，现在 `src` 等属性路径支持 Ctrl+Click 跳转到目标文件
  - 支持 `src="{{map_bg}}"` 等变量表达式的 Ctrl+Click 跳转，跳转到变量定义位置：
    - `wx:for` 循环变量 → wxml 自身的 `wx:for` 定义处
    - `data`/`properties`/`computed` 定义 → js 文件的对应位置
  - 跳过 `{{ }}` 变量表达式的文件路径解析，避免将变量名误当文件路径
  - 复用 `PropDefinitionProvider` 的优先级逻辑，统一 Ctrl+Click 和 F12 的跳转行为
  - 通过 VSCode Uri fragment（`#L行,列`）编码目标位置，跳转后光标精确定位到变量定义的行列

- **驼峰/中划线属性名兼容与可配置补全风格**
  - 新增配置项 `minapp-vscode.attrNameStyle`（`auto`/`camel`/`kebab`，默认 `auto`）
  - 识别始终兼容：无论配置哪种风格，hover、定义跳转、属性去重都支持驼峰与中划线互通（`userName` ≡ `user-name`）
  - 补全命名可配置：`camel` 补全用驼峰，`kebab` 补全用中划线，`auto` 根据当前文件已有写法自动判断
  - 新增纯函数模块 `attrNameCase.ts`（`camelToKebab`/`kebabToCamel`/`attrNameEquals`/`attrNameExists`/`normalizeAttrName`）

### 🐛 Bug 修复

- **wx:for 变量在属性路径场景下无法跳转**

  - 问题：`{{item.title}}` 光标在 `item` 上时，跳转定义走了 js 查找而非 wxml 的 `wx:for` 定义
  - 根因：`getWxmlTag` 用正则提取 `posWord` 时包含 `.` 号，导致 `posWord` 为 `item.title` 而非 `item`，精确匹配 `wx:for` 变量名失败
  - 修复：在调用 `tryResolveWxForLocation` 前，若 `posWord` 含 `.` 则取根变量（第一段）再匹配

- **中划线属性名 F12 跳转失败**
  - 问题：wxml 里写 `fixed-placeholder`（中划线），F12 跳转到 js properties 定义失败
  - 根因：`PropDefinitionProvider` 直接用 `posWord`（含中划线）去 js 查找，而 JS 标识符不能含 `-`，properties 定义一定是驼峰
  - 修复：调用 `searchScript` 前用 `kebabToCamel(posWord)` 转成驼峰再查找

### 🔧 技术改进

- 新增 `src/common/src/attrNameCase.ts` 属性命名转换与兼容匹配模块（纯函数，可单元测试）
- 新增 `src/plugin/lib/configObjectHeuristics.ts` 启发式探测模块（纯函数，可单元测试）
- 新增 `src/plugin/lib/wxmlForScope.ts` wx:for 作用域分析模块（纯函数，可单元测试）
- 新增 `src/plugin/lib/identifierCollector.ts` 通用标识符收集器（纯函数，可单元测试）
- `ScriptFile.ts` 集成启发式探测作为 Layer 1 兜底，支持 `computed` section
- `autocomplete.ts` 属性匹配/去重/补全命名全面接入驼峰/中划线兼容
- `hover.ts` 属性 hover 提示接入驼峰/中划线兼容匹配
- `LinkProvider.ts` 新增 `tryResolveVariableLink` 方法支持 `{{ }}` 变量跳转
- `PropDefinitionProvider.ts` 新增 `tryResolveWxForLocation` 方法支持 `wx:for` 变量跳转
- 单元测试覆盖：75 passing（含 `attrNameCase` 18 个、`configObjectHeuristics` 10 个、`wxmlForScope` 13 个、`identifierCollector` 32 个）

---

# 2.4.16 / 2025-12-08

### ✨ 新增功能

- **变量悬停提示 (Variable Hover)**
  - 鼠标移入 `{{ }}` 表达式中的变量时，显示 TypeScript 风格的类型签名
  - 格式：`const variableName: Type`（类似原生 TS 的悬停提示）
  - 支持多级属性访问（如 `obj.prop.subProp`），智能定位到根变量
  - 支持属性值中的变量引用（非 `{{ }}` 场景）
  - 显示变量定义所在的文件名和行号
  - 支持 Vue3 响应式类型：`Ref<T>`, `ComputedRef<T>`, `UnwrapRef<T>` 等

### 🎨 类型识别能力

**支持的类型：**

- 基本类型：`string`, `number`, `boolean`, `null`, `undefined`
- 数组类型：`string[]`, `number[]`, `any[]`
- 对象类型：`object`
- 函数类型：`(param: Type) => ReturnType`
- Vue3 响应式：
  - `ref()` → `Ref<T>`
  - `reactive()` → `UnwrapRef<object>`
  - `computed()` → `ComputedRef<any>`
  - `toRef()` → `Ref<any>`
  - `toRefs()` → `ToRefs<object>`
- TypeScript 显式类型标注

**支持的场景：**

```html
<!-- 简单变量 -->
<view>{{ userName }}</view>
<!-- 显示：const userName: string -->

<!-- Vue3 响应式 -->
<view>{{ userBenefit }}</view>
<!-- 显示：const userBenefit: ComputedRef<any> -->

<!-- 属性访问 -->
<view>{{ user.name }}</view>
<!-- 显示：const user: object -->

<!-- 属性值 -->
<view class="{{containerClass}}"></view>
<!-- 显示：const containerClass: string -->
```

### 🔧 技术实现

- 增强 `src/plugin/lib/ScriptFile.ts`：

  - 新增 `inferTypeFromNode()` 从 AST 节点推断类型
  - 新增 `inferTypeFromExpression()` 从表达式推断类型
  - 识别 Vue3 响应式 API 调用（ref, reactive, computed 等）
  - 识别 TypeScript 显式类型标注
  - 识别字面量类型（string, number, boolean, array, object）
  - `PropInfo` 接口新增 `typeInfo` 字段

- 优化 `src/plugin/HoverProvider.ts`：
  - 使用 `markdown.appendCodeblock()` 显示类型签名
  - 采用 TypeScript 风格的悬停提示格式
  - 简化显示内容，聚焦类型信息

### 📝 文档更新

- README.md 更新"变量悬停提示"功能说明
- 添加支持的类型识别列表和使用示例
- 添加显示格式说明

### ♻️ 重构

- 更新项目地址为增强版仓库 (smileqwe/minapp-vscode)
- 移除 pug 和 vue 模板支持，聚焦纯 wxml 语言服务
- 按开源规范更新文档和许可证

---

# 2.4.15 / 2025-12-08

### ✨ 新增功能

- **样式文件 @import 引入支持**

  - 解析样式文件中的 `@import` 语句，递归获取引入的样式文件中的样式名
  - 支持在补全和悬浮提示中使用通过 `@import` 引入的样式

- **项目根目录配置 (`rootPath`)**

  - 新增 `minapp-vscode.rootPath` 配置项，支持多仓库/子目录项目设置真正的项目根目录
  - `resolveRoots`、`globalStyleFiles` 等路径相对于 `rootPath` 解析

- **class 悬浮显示样式内容**

  - 鼠标悬浮在 wxml 的 class 名上时，显示对应样式文件中的样式定义
  - 样式补全时同时显示样式对应的具体内容

- **自定义组件动态属性解析**

  - 新增基于 TypeScript AST 的属性解析器
  - 支持 `Object.assign()` 合并的动态属性
  - 支持扩展运算符 `...` 展开的属性
  - 支持函数返回值属性（同文件内）

- **智能空格补全**

  - 在 `class` 属性值内按空格：触发 CSS class 名称补全
  - 在标签内其他位置按空格：触发组件属性补全
  - 自动识别上下文，智能分发补全类型

- **模板表达式变量补全**

  - 支持 `{{ }}` 表达式内的变量自动补全
  - 提示 `data`、`computed`、`methods` 等可用变量

- **基于 AST 的变量和方法定义分析**
  - 使用 TypeScript AST 分析脚本文件，提取变量定义和方法定义
  - 增强"跳转到定义"的准确性

### 🐛 Bug 修复

- 修复 sass 样式跳转行列错误
- 修复 sass 悬浮显示样式内容重复的问题

### 🔧 技术改进

- 新增 `src/common/src/parseAttrsAST.ts` AST 解析器
- 优化 `src/plugin/WxmlAutoCompletion.ts` 补全触发逻辑
- 改进 `src/plugin/lib/ScriptFile.ts` 属性提取算法
- 支持识别编译后的组件定义格式

### ⚠️ 已知限制

- 跨文件的函数调用属性暂不支持解析

  # 2.4.14 / 2024-11-23

- fix: prettier.format 异步接口兼容支持 [#185](https://github.com/wx-minapp/minapp-vscode/pull/185)

  # 2.4.13 / 2023-11-29

- 功能: 支持高亮带下划线的 wxml 标签名 [#177](https://github.com/wx-minapp/minapp-vscode/pull/177)

  # 2.4.10 / 2023-04-26

- 功能: wxml 格式化添加 js-beautify 支持

  # 2.4.9 / 2023-04-05

- 解决项目安全依赖问题 [#155](https://github.com/wx-minapp/minapp-vscode/pull/155),[#152](https://github.com/wx-minapp/minapp-vscode/pull/152),[#149](https://github.com/wx-minapp/minapp-vscode/pull/149)
- 更新 github actions 配置
- 更新 vsce 为@vscode/vsce

  # 2.4.8 / 2022-07-02

- 更新发布 CI 插件`HaaLeo/publish-vscode-extension`到`v1`

  # 2.4.7 / 2022-07-02

- 增加赞助链接
- 更新依赖，将主分支`master`重命名为`main`

  # 2.4.6 / 2022-01-05

- Fix [#133](https://github.com/wx-minapp/minapp-vscode/issues/133), [v2.4.2](https://github.com/wx-minapp/minapp-vscode/compare/v2.4.1...v2.4.2) delete `WxmlDocumentHighlightProvider` unexpectedly

  # 2.4.5 / 2021-12-08

- Fix [#129](https://github.com/wx-minapp/minapp-vscode/issues/129)

  # 2.4.4 / 2021-12-04

- 更改`prettyHtml`源代码以提高与 wxml 的兼容性，修复一些与之相关的 format 错误

  # 2.4.3 / 2021-11-16

- 增加`minapp-vscode:init`context 标志位，非小程序项目不展示`New Miniprogram Component`功能

  # 2.4.2 / 2021-11-16

- 新增`New Miniprogram Component`文件右键选项，快速创建一个小程序组件文件，支持配置
- 新增`minapp-vscode.cssExtname`配置
- 新增`minapp-vscode.jsExtname`配置
- 新增`minapp-vscode.wxmlExtname`配置
- 优化`跳转到定义`功能，支持 style 属性内插值的跳转
- 优化插件启动条件,加入`"workspaceContains:**/project.config.json"`和`"workspaceContains:**/app.wxss"`

  # 2.4.1 / 2021-11-07

- 插件名字从`WXML - Language Services`改为`WXML - Language Service`
- 优化`跳转到定义`功能，兜底为文字搜索尽可能提供有效的定义跳转

  # 2.4.0 / 2021-11-03

- 新增配置`minapp-vscode.disableFormat`,解决[#83 (comment)](https://github.com/wx-minapp/minapp-vscode/issues/83#issuecomment-958626391)
- 更新同步微信小程序组件元数据至基础库版本 v2.20.1

  # 2.3.7 / 2021-10-13

- 更改配置 webpack#resolve.resolvemainfields 修复 JSON5 导入的问题
- 支持 ObjectProperty 形式申明的函数跳转，Fix [#99](https://github.com/wx-minapp/minapp-vscode/issues/99)
- wxml 内函数跳转支持`mut-bind`,`capture-catch`and`capture-bind`

  # 2.3.6 / 2021-10-13

- 支持 wxml 中 tag 跳转到自定义的组件

  # 2.3.5 / 2021-10-11

- 更新同步微信小程序 WXML 标签元数据
- 增加无障碍访问 a11y 相关标签属性自动补全提示

  # 2.3.4 / 2021-09-01

- 添加钉钉用户交流群二维码
- 删除不再使用的 travis-ci 配置文件

  # 2.3.3 / 2021-08-31

- 参考 vscode-eslint 处理 webpack 打包时`require`语句失效的问题

  # 2.3.2 / 2021-08-31

- 将 prettier 打包进 vsix 文件，修复#103

  # 2.3.1 / 2021-08-30

- 插件更名
- 增加 deploy 状态 badge

  # 2.3.0 / 2021-08-30

- 优化插件 vsix 文件体积(2.88mb -> 261kb)
- 插件更名&更换 icon
- 更新代码提示中的微信官方文档链接/wepy 文档链接
- 增加 Github Actions CI
- 增加 issue 和 PR 模板
- 优化 wxml 语法高亮 tmLanguage 配置

  # 2.1.0 / 2019-08-01

- 组件独有的事件不出现在 `bind:` 中

  # 2.1.0 / 2019-07-06

- 添加 `showSuggestionOnEnter` 配置，按 Enter 键默认不出现补全，需要将 `showSuggestionOnEnter` 设置成 true

  # 2.0.0 / 2019-07-01

- 优化 wxml 的自动补全机制 [#40](https://github.com/wx-minapp/minapp-vscode/pull/40)
- 优化函数自动补全 [#39](https://github.com/wx-minapp/minapp-vscode/pull/39) [#42](https://github.com/wx-minapp/minapp-vscode/pull/42)
- `{{` 和 `}}` 在属性值中可以自动配对 [#20](https://github.com/wx-minapp/minapp-vscode/issues/20)
- 优化语法高亮，参考 handlebars 的高亮语法 [#44](https://github.com/wx-minapp/minapp-vscode/pull/44)

  # 1.16.0 / 2019-06-21

- 标签多行写法可补全
- tagName 和 tagAttr 可以随时补全

  # 1.15.0 / 2019-06-09

- 支持解析 sass/scss 文件，方便样式名自动补全

  # 1.14.0 / 2019-06-03

- wxmlFormatter 配置支持热更新
- prettyHtml 不会移除自闭合标签的 `/` 符号； [#11](https://github.com/wx-minapp/minapp-vscode/issues/11)

  # 1.13.0 / 2019-04-23

wxml 格式增强 [#23](https://github.com/wx-minapp/minapp-vscode/pull/23)

- [x] 支持 `prettyHtml` 格式化
- [x] 支持 `prettier` 格式 wxml
- [x] 支持 选择自定义其他语言 `documentSelector`
- [x] 自动读取项目中的配置文件 (仅针对`prettyHtml`,和`prettier`)
  1. [Prettier configuration file](https://prettier.io/docs/en/configuration.html)
  2. `.editorconfig`

新增配置

- `minapp-vscode.wxmlFormatter` `string`三种(`wxml`,`prettyHtml`,`prettier`) 可选，默认`wxml` (注,目前切换后需要重启 vscode)
- `minapp-vscode.documentSelector` `string[]` 自定义关联文件类型，
- `minapp-vscode.prettyHtml` `{}` [prettyhtml 配置项](https://github.com/Prettyhtml/prettyhtml#prettyhtmldoc-string-options-vfile)
- `minapp-vscode.prettier` `{}` [prettier 配置项](https://prettier.io/docs/en/configuration.html)

# 1.12.1 / 2019-01-14

- 修复组件自带的事件不支持 bind:xxx 的写法的问题，见 [issues/15](https://github.com/wx-minapp/minapp-vscode/issues/15)

  # 1.12.0 / 2019-01-05

- 支持 [mpx 小程序框架](https://github.com/didi/mpx)

# 1.11.1 / 2018-12-03

- bind/catch 不需要带 : 也可以高亮后面的函数

# 1.11.0 / 2018-11-21

- 可以点击模板文件中的函数或属性跳转到 js/ts 定义的地方

# 1.10.2 / 2018-11-19

- 修复样式文件解析缓存冲突问题

  # 1.10.1 / 2018-11-19

- 优化样式自动补全

  - 显示相对根目录的文件路径
  - 不再补全已经存在的样式
  - wxml 中的 class 属性支持 “查找所有引用”

- 升级 ts 到 3.1

  # 1.10.0 / 2018-11-15

- 添加样式名自动补全功能

  # 1.9.2 / 2018-11-13

- [vscode 1.29 在格式化时换行符全变成了 auto](https://github.com/wx-minapp/minapp-vscode/issues/6)

  # 1.9.1 / 2018-11-06

- [修复自闭合的 wxs 标签会导致高亮问题的 BUG](https://github.com/wx-minapp/minapp-vscode/issues/4)

  # 1.9.0 / 2018-10-07

- 同步官方组件的最新数据

  # 1.8.0 / 2018-09-02

- 同步官方组件的最新数据

  # 1.7.2 / 2018-08-06

- 添加配置项 `reserveTags`，一般 "text" 标签中的内容如果过长，格式化后会在行首和行尾添加换行符，如果不需要，可以将 reserveTags 设置成 `["text"]`

  # 1.7.1 / 2018-07-29

- 添加配置项 `wxmlQuoteStyle` 和 `pugQuoteStyle`，可以配置自动生成的引号是 `"` 还是 `'`，并且 snippet 中的引号也会使用配置的引号

  # 1.7.0 / 2018-07-07

- 优化自动补全体验，不再需要输入空格触发自动补全，自动会在合适的时机触发
- 修复 wxs 标签在格式化时前后添加换行符的问题 [#84](https://github.com/qiu8310/minapp/issues/84)
- 修复 wxml `{{'a' + foo + 'b'}}` 中的表达式不高亮的问题

  # 1.6.1 / 2018-06-28

- 更新项目 @minapp/wxml-parser，旧版处理多余的结束标签会报错

  # 1.6.0 / 2018-06-23

- wxml 中支持 [emmet 语法](https://docs.emmet.io/cheat-sheet/)，[详情见下文](#emmet)
- 自动关联文件类型
  - \*.wxs => javascript
  - \*.cjson => jsonc
  - \*.wxss => css
- wxml 文件在格式化时，标签属性值上的引号会保留原有的风格（即如果原来是双引号，格式化后也会是双引号；原来是单引号，格式化后也会是单引号）

# 1.5.1 / 2018-06-15

- 同步微信官方发布的 [2.1.0](https://developers.weixin.qq.com/miniprogram/dev/devtools/uplog.html#20180614-%E5%9F%BA%E7%A1%80%E5%BA%93%E6%9B%B4%E6%96%B0%EF%BC%88210%EF%BC%89) 的组件数据

# 1.5.0 / 2018-06-10

- 纯 wxml 文件中支持 [wxs 标签](https://developers.weixin.qq.com/miniprogram/dev/framework/view/wxs/01wxs-module.html)

  # 1.4.0 / 2018-06-05

- 在自动补全中支持生成 self close tag

  可以在配置项 `minapp-vscode.selfCloseTags` 中配置这些 self close tag

- 格式化选项 `minapp-vscode.formatMaxLineCharacters` 支持设置成 0 来表示无限大

  如果为 0 时，在格式化时所有的直接含有文本的标签都会格式在一行中

# 1.3.1 / 2018-06-03

- wxml 语言中高亮匹配的标签 [#72](https://github.com/qiu8310/minapp/issues/72)

  # 1.3.0 / 2018-05-26

- 添加 snippets 功能 [详情查看](./README.md#snippets)

- 优化变量高亮（切换文件时，会有些延迟），见 [#68](https://github.com/qiu8310/minapp/issues/68)
- 标签的属性值是布尔值时，会自动弹出 true/false 来让你选择
- 修复自动补全中默认值无法在编辑时选中的问题

# 1.2.0 / 2018-05-07

- 模板文件中 js 变量高亮（纯 wxml 文件才支持，vue 文件不支持），[详情查看](./README.md#highlight)

  # 1.1.1 / 2018-05-03

- 更新小程序组件数据，主要添加了 [ad 组件](https://developers.weixin.qq.com/miniprogram/dev/component/ad.html)

  # 1.1.0 / 2018-04-28

- wxml / pug 文件中的 src 标签支持 link 功能（另外可以通过配置 `minapp-vscode.linkAttributeNames` 来支持更多的标签）
- 添加新配置 `minapp-vscode.formatMaxLineCharacters` 可以指定格式化时每行最长的字符数`, close [61](https://github.com/qiu8310/minapp/issues/61)
- 更新官方组件数据

  # 1.0.14 / 2018-04-09

- 修复 pug 语言中，在单行的标签中，写 text 的时候也会触发属性补全

  # 1.0.12 / 2018-04-05

- 支持 pug 语言

  现在需要在 vue 的 template 上指定 `lang` 和 `minapp` 两个选项，如果不指定 `minapp`，默认为 `minapp="mpvue"`

  如:

  1. `<template lang="wxml" minapp="native">` 表示使用 wxml 语言，不使用任何框架
  2. `<template lang="pug" minapp="mpvue">` 表示使用 pug 语言，并使用 mpvue 框架

  # 1.0.10 / 2018-03-31

- 支持 wxml/wepy/mpvue 三类语言的补全
- 补全信息可配置

  # 1.0.6 / 2018-03-23

- 支持格式化 wxml 格式的文件（使用系统的格式化命令即可）
- 插件的分类改成了 `languages`

  # 1.0.4 / 2018-03-17

- 在 vue 模板文件中也能自动补全
