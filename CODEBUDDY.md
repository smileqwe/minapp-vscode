# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## Project Overview

This is a **VSCode extension** (publisher: `luojin`, name: `WXML - Language Service (Enhanced)`) that provides language support for WeChat MiniProgram WXML files. It is an enhanced fork of [wx-minapp/minapp-vscode](https://github.com/wx-minapp/minapp-vscode) with added features: dynamic component property resolution (via TypeScript AST), smart context-aware completion, `{{ }}` expression variable completion, and TypeScript-style variable hover type hints.

The extension activates on `onLanguage:wxml` or when `project.config.json` / `app.wxss` exists in the workspace. Entry point is `./dist/extension.js` (webpack-bundled from `src/extension.ts`).

## Common Commands

### Build & Package
```bash
# Development build (webpack, outputs to dist/extension.js)
npm run webpack

# Watch mode for development
npm run webpack-dev

# Production build + package .vsix
npm run build:vsix

# Clean build output
npm run clear
```

### Lint
```bash
# ESLint on src/
npm run lint
```

### Tests
```bash
# Unit tests (pure TS, no vscode dependency) — compiles tsconfig.test.json then runs mocha
npm run test:unit

# Run a single unit test file (after compiling)
npx mocha "out-test/test/unit/<test-file>.test.js" --grep "W1"

# Compile test TS only (without running)
npm run test-compile
```

Unit tests live in `src/test/unit/` and only cover pure-logic modules (`identifierCollector`, `wxmlForScope`) that have no `vscode` import. The full VSCode integration test runner (`src/test/index.ts`) uses `@vscode/test-electron` but is not wired into npm scripts.

## Architecture

### Entry & Activation (`src/extension.ts`)
`activate()` registers all language providers against the document selector derived from `config.documentSelector` (default `['wxml']`):

- **CompletionItemProvider** → `WxmlAutoCompletion` (triggers: `<`, space, `:`, `@`, `.`, `-`, quotes, `/`, `{`, a-z letters)
- **HoverProvider** → `HoverProvider` (component/attr docs, class docs, `{{ }}` variable type hints)
- **DefinitionProvider** → `PropDefinitionProvider` (jump to JS/TS prop/method/style/wx:for definitions)
- **DocumentHighlightProvider** → `WxmlDocumentHighlight` (matching tag pair highlighting)
- **FormattingEditProvider** → `WxmlFormatter` (wxml / prettier / prettyHtml / jsBeautifyHtml)
- **ActiveTextEditorListener** (decorates `{{ }}` variables with custom color)
- **Command**: `minapp-vscode.createMiniprogramComponent` (right-click → New Miniprogram Component)

`activate()` also calls `autoConfig()` (unless `disableAutoConfig`) which merges file associations (`*.cjson`→jsonc, `*.wxss`→css, `*.wxs`→javascript) and emmet mappings into the user's global VSCode settings, then sets `disableAutoConfig=true` to avoid repeat runs.

### Configuration (`src/plugin/lib/config.ts`)
A single mutable `config: Config` object holds all settings, populated from `vscode.workspace.getConfiguration('minapp-vscode')` via `getConfig()`. `configActivate()` registers a workspace configuration change listener that re-runs `getConfig()`. Every provider receives this shared `config` instance in its constructor. `getResolveRoots(doc)` resolves `config.resolveRoots` against either the workspace root or `config.rootPath` (absolute path override for sub-directory/monorepo scenarios).

### Plugin Layer (`src/plugin/`)
Each file is one VSCode provider:

- **`AutoCompletion.ts`** — abstract base class rendering `CompletionItem`s from `TagItem`/`TagAttrItem` data; subclasses (`WxmlAutoCompletion`, `PugAutoCompletion`, `VueAutoCompletion`) implement `provideCompletionItems` for their template syntax. The WXML subclass contains the enhanced logic: smart-space (class value vs. attribute), `{{ }}` expression variable completion, and `wx:for` binding items.
- **`HoverProvider.ts`** — resolves hover in priority: `{{ }}` variable type hint → class hover → attribute-value variable hover → component/attr markdown doc.
- **`PropDefinitionProvider.ts`** — resolves go-to-definition: `wx:for` loop variable (returns wxml Location) → tag name → custom component path → attribute → `{{ }}` / `.sync` variable in script file → class definition in style file.
- **`WxmlFormatter.ts`** — dispatches to one of four formatters based on `config.wxmlFormatter`. The default `wxml` formatter uses the in-repo `src/wxml-parser` parser; `prettier`/`jsBeautifyHtml` resolve the user's local package via `requireLocalPkg`.
- **`ActiveTextEditorListener.ts`** — uses regex to find `{{ }}` interpolations and applies `TextEditorDecorationType` (configurable color); debounced 500ms on text changes.
- **`getTagAtPosition/`** — parses the tag under cursor. `getVueTag` handles Vue `<template lang="wxml|pug">` blocks; `getWxmlTag`/`getPugTag` handle pure wxml/pug files. Returns a `Tag` describing tagName, attrs, whether cursor is on tag name / attr name / attr value, and the word at cursor.

### Common/Data Layer (`src/common/src/`)
Framework-agnostic component metadata and completion/hover/definition business logic:

- **`dev/`** — `Component`/`ComponentAttr` interfaces, the built-in component dataset (`components.ts`, `components.json`), `LanguageConfig` shape (baseAttrs, event prefixes, custom directives), and markdown renderers (`getComponentMarkdown`, `getComponentAttrMarkdown`).
- **`autocomplete.ts`** — `autocompleteTagName` / `autocompleteTagAttr` / `autocompleteTagAttrValue` / `autocompleteSpecialTagAttr`. Priority: custom components > native components > base attrs.
- **`hover.ts`** / **`definition.ts`** — shared hover and tag-name→component-path resolution used by the plugin providers.
- **`custom.ts`** — discovers user-defined components by reading the `.json` `usingComponents` of the current wxml's sibling json file, then resolves each component's `.js`/`.ts` to extract `properties` (via `parseAttrs` or `parseAttrsAST`).
- **`parseAttrs.ts`** — regex-based fallback parser for `properties: {...}` blocks.
- **`parseAttrsAST.ts`** — **enhanced** TypeScript AST-based parser supporting `Object.assign()`, spread `...`, and same-file function calls in `properties`. Recognizes `defineComponent`/`Component`/`Page` calls (including CommonJS-compiled forms like `(0, core_1.defineComponent)`).

### Script Analysis (`src/plugin/lib/ScriptFile.ts`)
Core of the "jump to definition" and "hover type hint" features. Uses `ts.createSourceFile` to parse the JS/TS file sibling to the current wxml, then walks the AST to locate a property/method by name. Supports multiple mini-program authoring styles:
- Native `Component({...})` / `Page({...})` with `data`/`properties`/`methods`
- Vue3 Composition API `defineComponent({...})` / `definePage({...})` with `setup()` return object, `ref()`/`reactive()`/`computed()` reactive types
- `this.x = ...` assignments and `this.setData({...})` keys
- Class-based components (decorator or extends)

`PropInfo` carries `typeInfo` (TypeScript signature string like `Ref<string>`) rendered in hover. Results are cached per file version.

### Identifier Collector (`src/plugin/lib/identifierCollector.ts`)
A pure-function module (no `vscode` import, unit-testable) that collects all identifiers in a source file across multiple sources: object-literal keys, class members, `setData` keys, return-object destructuring, assignments, and spread. `collectAllIdentifiers` + `rankAndDedupe` is the generic fallback when the structured `ScriptFile` parse fails to find a definition — it returns character offsets that the caller wraps into `vscode.Location`.

### wx:for Scope Analysis (`src/plugin/lib/wxmlForScope.ts`)
Another pure-function module. Linear-scans wxml text maintaining an open-tag stack; parses `wx:for` / `wx:for-item` / `wx:for-index` / `wx:for-items` attributes to produce `WxForBinding[]` with scope ranges. `getVisibleWxForBindings(text, offset)` returns bindings whose scope contains the cursor (inner-first); `dedupeByName` keeps the innermost for duplicate names. Used by completion (suggest `item`/`index`), hover, and definition providers.

### WXML Parser (`src/wxml-parser/`)
In-repo parser (vendored from `@minapp/wxml-parser`) producing a `Document` → `Node` tree (`TagNode`/`TextNode`/`CommentNode`). Used by the default `wxml` formatter (`WxmlFormatter`) to serialize back with configurable indent, `reserveTags`, and `maxLineCharacters`. Not used for completion/hover, which rely on regex + cursor-position heuristics in `getTagAtPosition`.

### Commands (`src/commands/`)
- **`createMiniprogramComponent.ts`** — prompts for a component name, creates a folder with 4 files (`.js`/`.ts`, `.wxss`/`.scss`/...`, `.wxml`, `.json`) using `config.{js,css,wxml}Extname`, then opens the script file.
- **`constants.ts`** — `COMMANDS` and `CONTEXT_KEYS` used by `extension.ts` for registration and `when` clauses.

## Key Architectural Patterns

1. **Shared mutable config singleton** — `config` in `src/plugin/lib/config.ts` is imported everywhere; providers read it live so config changes take effect without reactivation.
2. **Pure-function modules for testable logic** — `identifierCollector.ts` and `wxmlForScope.ts` intentionally avoid importing `vscode` so they can be unit-tested with plain mocha. New logic that doesn't strictly need the VSCode API should follow this pattern and be added to `tsconfig.test.json`'s `include`.
3. **Two-tier parsing strategy** — structured AST parsing (`ScriptFile.ts`, `parseAttrsAST.ts`) is tried first; if it fails, the generic identifier collector kicks in as a fallback so that "jump to definition" works even for unknown component authoring styles.
4. **TypeScript as a runtime dependency** — `typescript` is used at runtime (not just build time) for `ts.createSourceFile` AST analysis in `ScriptFile.ts`, `parseAttrsAST.ts`, and `identifierCollector.ts`.
5. **Webpack bundling** — `webpack.config.js` bundles `src/extension.ts` → `dist/extension.js` with `ts-loader`, externalizing only `vscode`. All other deps (including `typescript`) are bundled into the single output file.

## Testing Conventions

- Unit tests (`src/test/unit/*.test.ts`) must not import `vscode`. They compile via `tsconfig.test.json` (separate from the main `tsconfig.json`) into `out-test/`.
- Fixtures live in `src/test/fixtures/` and represent real-world mini-program authoring styles (native Page, Composition API, class decorator, `this.setData`, spread, factory wrap).
- The `tsconfig.test.json` `include` array must be updated when adding a new pure module to be tested — it explicitly lists `identifierCollector.ts` and `wxmlForScope.ts` plus `src/test/unit/**/*`.

## Commit Convention

Use Conventional Commits prefixes: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:` (see README contribution guide).

## Upstream Relationship

This repo is an enhanced fork. The upstream is `wx-minapp/minapp-vscode`. The `smileqwe` fork adds the AST-based dynamic property resolution and expression completion features. When fixing bugs, check whether the issue originates in upstream code or enhanced code — the enhanced modules are primarily `ScriptFile.ts`, `parseAttrsAST.ts`, `identifierCollector.ts`, `wxmlForScope.ts`, and the `{{ }}` handling in `WxmlAutoCompletion.ts` / `HoverProvider.ts` / `PropDefinitionProvider.ts`.
