# VSCode 插件发布指南

本文档说明如何将修改后的插件发布到 VSCode Marketplace 或内部使用。

## 📋 前置准备

### 1. 已完成的修改（✅ 已完成）

- [x] 修改 `package.json` 基本信息
  - `name`: `minapp-vscode-enhanced` （新的插件名称）
  - `displayName`: `WXML - Language Service (Enhanced)`
  - `description`: 添加了增强功能说明
  - `version`: `2.4.15`
  - `publisher`: `smileqwe` （你的发布者 ID）
  - `repository`: 更新为你的仓库地址 `https://github.com/smileqwe/minapp-vscode`
  - `bugs`: 更新为你的 issues 地址

### 2. 需要准备的账号

#### 选项 A：发布到 VSCode Marketplace（公开发布）

1. **创建 Azure DevOps 账号**
   - 访问：https://dev.azure.com
   - 使用 Microsoft 账号登录

2. **创建 Personal Access Token (PAT)**
   - 登录 Azure DevOps
   - 点击右上角用户图标 → User settings → Personal access tokens
   - 点击 "New Token"
   - 配置：
     - Name: `vscode-extension-publish`
     - Organization: `All accessible organizations`
     - Scopes: 选择 `Marketplace` → `Manage`
   - 复制生成的 Token（只显示一次，务必保存）

3. **创建发布者账号**
   ```bash
   # 安装 vsce
   npm install -g @vscode/vsce
   
   # 创建发布者（只需执行一次）
   vsce create-publisher smileqwe
   # 输入你的 PAT、名称、邮箱等信息
   
   # 登录发布者账号
   vsce login smileqwe
   # 输入你的 PAT
   ```

#### 选项 B：内部使用（不公开发布）

只需要构建 `.vsix` 文件，无需账号。

---

## 🚀 发布步骤

### 方式一：发布到 VSCode Marketplace

#### 1. 确认信息无误

```bash
# 查看 package.json 信息
cat package.json | grep -E '"name"|"version"|"publisher"'
```

输出应该是：
```json
"name": "minapp-vscode-enhanced",
"version": "2.4.15",
"publisher": "smileqwe",
```

#### 2. 构建并发布

```bash
# 清理并构建
npm run clear
npm run vscode:prepublish

# 发布到 Marketplace
vsce publish

# 或者指定版本号发布（会自动更新 package.json）
vsce publish patch  # 2.4.15 -> 2.4.16
vsce publish minor  # 2.4.15 -> 2.5.0
vsce publish major  # 2.4.15 -> 3.0.0
```

#### 3. 验证发布

- 访问：https://marketplace.visualstudio.com/items?itemName=smileqwe.minapp-vscode-enhanced
- 或在 VSCode 中搜索你的插件名称

---

### 方式二：打包 .vsix 文件（内部分发）

#### 1. 构建 .vsix 包

```bash
# 清理并构建
npm run clear
npm run vscode:prepublish

# 打包成 .vsix 文件
npm run build:vsix
# 或直接运行
npx vsce package
```

生成的文件：`minapp-vscode-enhanced-2.4.15.vsix`

#### 2. 安装 .vsix 文件

**方法 1：命令行安装**
```bash
code --install-extension minapp-vscode-enhanced-2.4.15.vsix
```

**方法 2：VSCode 界面安装**
1. 打开 VSCode
2. 按 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows)
3. 输入 "Install from VSIX"
4. 选择 `.vsix` 文件

**方法 3：拖拽安装**
- 直接将 `.vsix` 文件拖入 VSCode 扩展面板

#### 3. 分发给团队

- 上传到公司内部服务器
- 或使用内网 npm registry
- 或通过 Git 仓库分发

---

## 📝 版本管理建议

### 版本号规范（Semantic Versioning）

```
主版本号.次版本号.修订号
  Major . Minor . Patch
```

- **Patch (2.4.15 → 2.4.16)**: 修复 bug，不影响 API
- **Minor (2.4.15 → 2.5.0)**: 新增功能，向后兼容
- **Major (2.4.15 → 3.0.0)**: 重大更新，可能不兼容旧版

### 推荐工作流

```bash
# 1. 开发新功能
git checkout -b feature/new-feature
# ... 开发代码 ...
git commit -m "feat: 新功能"

# 2. 合并到主分支
git checkout main
git merge feature/new-feature

# 3. 更新版本号和 CHANGELOG
# 手动编辑 CHANGELOG.md
# 手动编辑 package.json 版本号

# 4. 提交版本更新
git add .
git commit -m "chore: release v2.4.16"
git tag v2.4.16
git push origin main --tags

# 5. 发布
vsce publish
```

---

## 🔍 发布前检查清单

- [ ] 所有功能测试通过
- [ ] README.md 已更新
- [ ] CHANGELOG.md 已更新
- [ ] package.json 版本号已更新
- [ ] 没有未提交的更改 (`git status`)
- [ ] 所有依赖已安装 (`npm install`)
- [ ] 构建成功 (`npm run vscode:prepublish`)
- [ ] 本地测试通过（按 F5 调试）
- [ ] LICENSE 文件正确（原项目是 MIT）
- [ ] 图标文件存在（res/icon.png）

---

## ⚠️ 注意事项

### 1. 开源协议

原项目使用 MIT License，本增强版本也遵守 MIT 协议：

- ✅ 已保留原作者的版权声明
- ✅ 已在 README 中注明基于原项目修改
- ✅ 已添加修改版权声明
- ✅ 已在 LICENSE 文件中添加修改说明

**原项目：** https://github.com/wx-minapp/minapp-vscode  
**原作者：** Mora & iChenLei  
**协议：** MIT License

根据 MIT 协议要求：
- 必须保留原版权和许可声明（✅ 已完成）
- 允许商业使用、修改、分发（✅ 符合规范）
- 建议说明修改内容（✅ 已在 CHANGELOG 和 README 中说明）

### 2. 插件名称

- `name` 字段必须唯一，不能和已有插件重复
- 建议使用后缀区分：`-enhanced`、`-plus`、`-pro` 等
- `displayName` 可以更友好，显示在市场中

### 3. 发布者 ID

- `publisher` 必须是你在 Marketplace 注册的 ID
- 一个发布者可以发布多个插件
- 发布者 ID 一旦创建不能修改

### 4. 内部使用建议

如果只是公司内部使用，建议：

- **方式 1**: 打包 .vsix 文件，放到内网服务器
- **方式 2**: 配置内网 VSCode Marketplace（需要企业版）
- **方式 3**: 通过 Git 仓库 + 自动化脚本分发

---

## 🆘 常见问题

### Q1: vsce publish 报错 "Error: Missing publisher name"

**解决**：
```bash
# 确保 package.json 中有 publisher 字段
# 并且已登录
vsce login smileqwe
```

### Q2: 打包时报错 "This extension consists of X files, out of which Y are JavaScript files..."

**解决**：
```bash
# 在 package.json 中添加 .vscodeignore 或使用 files 字段
# 或使用 --no-dependencies 参数
vsce package --no-dependencies
```

### Q3: 如何测试打包后的插件？

**解决**：
```bash
# 1. 打包
npm run build:vsix

# 2. 在新的 VSCode 窗口安装
code --install-extension minapp-vscode-enhanced-2.4.15.vsix

# 3. 测试功能
# 4. 卸载
code --uninstall-extension smileqwe.minapp-vscode-enhanced
```

### Q4: 如何更新已发布的插件？

**解决**：
```bash
# 1. 修改代码
# 2. 更新 CHANGELOG.md
# 3. 更新版本号（自动或手动）
vsce publish patch  # 自动递增版本号并发布

# 或手动更新 package.json 后
vsce publish
```

### Q5: 如何撤回已发布的版本？

**解决**：
```bash
# 只能 unpublish 整个扩展，不能单独撤回某个版本
vsce unpublish smileqwe.minapp-vscode-enhanced

# 如果发现问题，建议快速发布修复版本
vsce publish patch
```

---

## 📚 相关资源

- [VSCode Extension API](https://code.visualstudio.com/api)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [vsce CLI Reference](https://github.com/microsoft/vscode-vsce)
- [原项目仓库](https://github.com/wx-minapp/minapp-vscode)

---

## 🎯 快速命令参考

```bash
# 安装依赖
npm install

# 本地开发测试（按 F5 启动调试）
npm run webpack-dev

# 清理构建
npm run clear

# 生产构建
npm run vscode:prepublish

# 打包成 .vsix
npm run build:vsix

# 发布到 Marketplace
vsce publish

# 安装本地 .vsix
code --install-extension xxx.vsix

# 卸载插件
code --uninstall-extension smileqwe.minapp-vscode-enhanced
```
