# dsh-pets 插件分发指南（把插件交给别人用）

> 本文档面向插件作者（你）：说明如何把 dsh-pets —— 或任何结构相同的自定义
> DeepSeek Harness（DSH）插件 —— 交付给其他用户使用。
> 文中的"对方 / 使用者"指拿到你插件的其他人；`<spec>` 表示 pnpm 的包定位写法
> （本地路径 / Git 地址 / npm 包名，见第 4 节）。
>
> 下文的 `dsh` 命令以已全局安装 DSH CLI 为前提。未全局安装时，请将
> `dsh <args>` 替换为 `npx @deepseek-ai/dsh <args>`；例如
> `dsh plugin --profile web add <spec>` 对应
> `npx @deepseek-ai/dsh plugin --profile web add <spec>`。

---

## 1. 插件机制速览（为什么"分发"= 装一个 npm 包）

dsh-pets 是一个**双面（dual-face）插件**，本质就是一个 npm 包：

| 组成 | 文件 | 作用 |
|---|---|---|
| 宿主半边（Node / cordis） | `lib/index.js` | 在 web 服务器上挂 `/pets/api/*`、`/pets/assets/*` 路由，下载并缓存宠物包 |
| 浏览器半边 | `lib/client.js` | 注册进 `shell.overlay` 根插槽，渲染宠物动画和商店 UI |

让插件在对方的 DSH 里跑起来，只需要两件事：

1. **把包装进对方的 web profile** —— `dsh plugin --profile web add <spec>`（内部转发给 pnpm，装进 `~/.dsh/profiles/web/node_modules`）；
2. **重启** —— `dsh web` 重新启动 web profile。

本包在 `package.json` 中声明了 `dsh.bundle.patch`。`dsh plugin` 安装后会自动把
该 bundle 加入 `dsh.profile.bundles`，其中的 `patch.yml` 会注册 `lib/index.js`；
使用者不需要编辑 `cordis.patch.yml`。

浏览器半边不需要对方做任何事：web app 内置的 client-modules 机制会扫描已激活的
插件条目，凡是 `package.json` 里声明了 `dsh.client.platform: "web"` 且
`exports["./client"]` 指向产物文件的包，都会自动把该产物注入页面
（`window.__DSH_BOOT__`，路由为 `/plugins/<包名>/client.js`）。

**分发 = 让对方的 pnpm 能拿到这个包**。下面先列对方的前置条件，再给三种分发方式。

---

## 2. 对方的前置条件

对方机器上需要：

- **Node.js**（使用与当前 DSH 版本兼容的版本）
- **pnpm**（`dsh plugin` 命令内部调用 pnpm，且必须在 `PATH` 中）：
  ```sh
  npm install -g pnpm
  ```
- **DSH CLI**（自带 web app 全家桶，`dsh-web-app`、`dsh-base` 都是它的依赖）：
  ```sh
  npm install -g @deepseek-ai/dsh
  # 或不想全局装，用 npx：
  npx @deepseek-ai/dsh web
  npx @deepseek-ai/dsh plugin --profile web add <spec>
  ```
- **能访问 codex-pets.net**（dsh-pets 的商店面板会实时抓取宠物图鉴；宠物本身下载后会缓存在本地，见第 8 节）。

不需要对方预先创建 profile：`dsh web` 或 `dsh plugin --profile web ...` 首次运行会
自动初始化 `web` profile（生成 `~/.dsh/profiles/web/`）。

> 版本要求：插件机制（`dsh plugin`、`dsh.client` client-modules）自
> `0.1.0-rc.6` 起可用，建议让对方使用与你一致的 dsh 版本或更新的同系列版本。

---

## 3. 三种分发方式

按使用场景从轻到重排列。三种方式装的都是同一个包，装完后的第 5、6 节步骤完全相同。

### 方式 A：本地路径 / 打包文件（最快，适合小范围试用）

让对方直接把你的插件目录（或打包成的 zip/tar）放到本地，然后：

```sh
# 绝对路径
dsh plugin --profile web add file:/Users/you/dsh-pets

# 相对路径也可以 —— 会以“执行命令时的目录”为基准解析
cd /path/containing/dsh-pets
dsh plugin --profile web add ./dsh-pets
```

**给对方发文件时注意**：`file:` 方式会把整个目录复制/链接进 profile 的
`node_modules`（包括你本地的测试文件），所以发 zip 时建议只打必要文件：
`lib/`、`README.md`、`README.zh-CN.md`、`package.json`、`LICENSE`。

### 方式 B：Git 仓库（推荐给团队 / 半公开场景）

把插件推到 Git 仓库（GitHub / GitLab 均可），对方只需一行：

```sh
dsh plugin --profile web add git+https://github.com/you/dsh-pets.git
# 或 pnpm 的 shorthand：
dsh plugin --profile web add github:you/dsh-pets
```

后续你推了新版本，对方升级也简单（见第 7 节）。

> 如果插件仓库带 `prepare` 构建脚本，pnpm 默认会拦截安装期构建；对方需要在
> `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 里放行。dsh-pets
> **没有**构建脚本，不涉及这个问题。

### 方式 C：npm 发布（公开分发，任何人一行装好）

最正式的公开分发方式。步骤如下：

1. **改包名**（`package.json` 的 `name`）—— `dsh-pets` 这种通用名很可能已被占用，
   建议改成带 scope 的名字，如 `@your-scope/dsh-pets`；
2. **改完名后同步改三处标识符**（重要！见第 8 节的"命名一致性"）：
   - `package.json` 的 `name`；
   - `lib/client.js` 里的 `window.__ModuleLoader__.load({ id: "…", … })`；
   - `lib/index.js` 里的 `export const name = "…"`；
3. 登录并发布（`files` 白名单包含 `lib/`、中英文 README，只发必要文件）：
   ```sh
   npm login
   npm publish
   ```
4. 对方安装：
   ```sh
   dsh plugin --profile web add @your-scope/dsh-pets
   ```

---

## 4. 选择哪种？

| 场景 | 推荐方式 |
|---|---|
| 你自己 / 同事本机联调 | A 本地路径 |
| 团队内部、要持续更新 | B Git 仓库 |
| 公开分享、让任何人一行装好 | C npm 发布 |

三种方式在对方机器上装完后状态完全一致，后面步骤没有区别。

---

## 5. 注册加载条目（关键步骤，最容易漏）

装完包之后，**还必须让 cordis 在启动时装载这个插件**。两种做法：

### 自动注册 bundle（当前 dsh-pets 的做法）

`dsh-pets` 已在 `package.json` 中声明 bundle：

```jsonc
// package.json
{
  "name": "dsh-pets",
  "dsh": {
    "client": { "platform": "web" },
    "bundle": { "patch": "./patch.yml" }
  },
  "files": ["lib", "README.md", "README.zh-CN.md", "patch.yml"]
}
```

```yaml
# patch.yml（包根目录，与 package.json 同级）
- insert:
    - id: dsh-pets
      name: dsh-pets
```

安装后，`dsh plugin` 会自动把包加入 `dsh.profile.bundles`；卸载时也会自动清理。
对方只需执行安装命令，无需手动编辑任何文件：

```sh
dsh plugin --profile web add <spec>
```

> 说明：`dsh.bundle.patch` 的值是包内的一个**相对路径**，指向一份"loader 补丁"
> YAML 文件（顶层是 patch 数组，格式与 `cordis.patch.yml` 完全一致）。reconcile
> 发现依赖包声明了它，就会自动把它追加进 `dsh.profile.bundles`。

**旧版本迁移**：若用户曾手动把 `dsh-pets` 写入 `cordis.patch.yml`，升级到带
bundle 的版本后，应删除那条旧 entry。保留它会让同一个宿主插件被配置两次。

---

## 6. 重启与验证

```sh
dsh web   # 重新启动 web profile（新插件条目在启动时才装载）
```

验证清单：

1. **条目已进组合配置树**（不启动、离线检查）：
   ```sh
   dsh --profile web --dump-config | grep -A 3 "dsh-pets"
   ```
   能看到 `id: dsh-pets` / `name: dsh-pets` 的行即正常。
2. **包已装进 profile**：
   ```sh
   ls ~/.dsh/profiles/web/node_modules/dsh-pets   # 或 @your-scope/dsh-pets
   ```
3. **浏览器里看到宠物**：打开 web 界面，右下角出现宠物图标；点开商店面板能浏览
   codex-pets.net 图鉴并领养宠物，即整条链路（宿主路由 + 浏览器 bundle）都通了。
4. （可选）浏览器开发者工具里确认 `/plugins/dsh-pets/client.js` 返回的是 JS 内容
   而不是 404——404 说明 client-modules 没识别到这个包（多半是 `dsh.client` 声明
   或 `exports["./client"]` 缺失/路径不对）。

---

## 7. 升级与卸载

**升级**（只对方式 B / C 有意义）：

```sh
dsh plugin --profile web update dsh-pets
```

方式 A（本地路径）没有"版本"概念，对方重新执行一次 `add` 即可。

**卸载**：

```sh
dsh plugin --profile web remove dsh-pets
```

然后：

- 当前 bundle 注册方式：reconcile 会自动把它从 `dsh.profile.bundles` 里移除，
  无需手动改；
- 仅限旧版手动注册：删除 `cordis.patch.yml` 里遗留的 `insert`，否则下次启动
  cordis 会找不到 `dsh-pets` 包。

已缓存的宠物数据留在 `~/.dsh/storages/pets/`，需要的话手动删除。

---

## 8. 兼容性与注意事项

- **命名一致性（最容易踩的坑）**：四处标识必须一致——
  ① `package.json` 的 `name`；② `patch.yml` 加载条目里的 `name`；③ 浏览器 bundle
  里 `__ModuleLoader__.load({ id })`；④ 宿主 `lib/index.js` 的 `export const name`。
  client-modules 按"加载条目名"建图，并要求 bundle 用同一个 id 注册工厂；
  其中任何一处不一致，插件要么不出现在图里，要么在页面报
  `bundle loaded without registering "<id>"`。改包名（比如发 npm 时加 scope）时
  要四处一起改。
- **零依赖**：dsh-pets 的宿主半边只用 Node 内置模块，浏览器半边只 require 页面
  自带的 `react` / `react/jsx-runtime` 种子模块，其余能力（`webServer` 注入、
  `shell.overlay` 插槽）都由 DSH 提供——**对方不需要额外装任何依赖**，也不会有
  版本冲突。
- **发布白名单**：`package.json` 的 `files` 已包含 `lib`、中英文 README 和
  `patch.yml`。发布时不要漏掉补丁文件，否则 reconcile 无法识别 bundle。
- **数据与隐私**：宠物缓存在对方本机 `$DSH_HOME/storages/pets/`（默认
  `~/.dsh/storages/pets`），`state.json` 只存用户偏好（当前宠物、大小、位置、
  空闲行）；宿主只在需要时访问 codex-pets.net，不向其他任何地方上报数据。
- **安全边界**（给想改插件的人）：宿主路由做了严格的路径校验与包含关系检查
  （`/pets/assets/<id>/<file>` 只读宠物缓存根目录内文件），默认只绑定回环地址；
  分发时不要去掉这些检查。

---

## 9. 常见问题（对方视角）

| 症状 | 原因 / 处理 |
|---|---|
| `dsh: pnpm not found on PATH` | 对方没装 pnpm，先执行 `npm install -g pnpm`，再重新打开终端。 |
| 装完重启后界面没有宠物 | 用 `--dump-config` 检查 `dsh-pets` 是否已在组合树里；旧版手动配置升级时确认已删除旧 entry |
| 页面报 `client-modules: bundle ... loaded without registering` | 命名不一致（见第 8 节"命名一致性"） |
| `/plugins/dsh-pets/client.js` 404 | 包没被识别为 client 包：检查 `dsh.client.platform: "web"` 与 `exports["./client"]` |
| 卸载后启动报找不到 `dsh-pets` | 这是旧版手动注册遗留的 `cordis.patch.yml` entry；按第 7 节删除它。 |
| Git 仓库带构建脚本装不上 | 在 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 放行（dsh-pets 无此问题） |

---

## 10. 作者侧发布 checklist

- [ ] 确定分发方式（A 本地路径 / B Git / C npm）
- [ ] 保持 `dsh.bundle.patch` 与 `patch.yml` 在发布包中，让安装一步到位
- [ ] 若改包名：同步改 `patch.yml`、`lib/index.js` 的 `name` 与 `lib/client.js` 的 bundle `id`
- [ ] `npm publish` 前确认 `files` 白名单包含所有必要文件（含补丁文件）
- [ ] 在干净机器上按第 6 节验证一遍：装 → 重启 → 界面出现宠物
- [ ] 在 README 或分发说明里写清对方的安装命令和旧版手动配置的迁移步骤
