# dsh-pets

[English](README.md)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web 界面提供 Codex 风格的动态宠物。

插件会在 DSH Web 应用中添加一个悬浮宠物图层。你可以从公开的 [codex-pets.net](https://codexpets.net/) 图库领养宠物、拖动它的位置，并让它的动画跟随当前会话状态变化。

## 功能

- 使用像素化 Canvas 渲染标准 Codex Pet 精灵图，布局为 `8 x 9` 个动画单元格。
- 首次尚未领养宠物时显示领养入口；领养后显示可拖动的当前宠物。
- 根据当前 DSH 会话状态切换宠物心情：
  - **闲置**：没有运行中的 Agent 或后台任务。
  - **工作中**：Agent 正在运行，或任务状态为 `running`、`stopping`。
  - **开心**：运行中的任务完成或被终止后显示 5 秒。
  - **难过**：运行中的任务失败后显示 5 秒。
- 自动检测有内容的动画行并跳过透明帧；可预览各行并手动指定闲置动画行。
- 提供中英文界面、尺寸调整、已领养宠物切换和删除，以及按名称、slug 或标签搜索图库。
- 图库通过 DSH 服务端请求，在内存中缓存 10 分钟，并写入本地磁盘用于离线回退。

## 前置条件

- 一个带 Web 界面的 DSH：DSH CLI 的 `web` profile，或 DeepSeek Harness 桌面版
  （它运行保留的 `desktop` profile，界面与 Web 版相同）。
- DSH 版本需在本插件支持范围内：`0.1.0-rc.x` 与 `0.2.x`（见
  [版本兼容](#版本兼容)）。
- 使用与当前 DSH 安装兼容的 Node.js 版本。插件本身没有运行时 npm 依赖。
- `pnpm` 已加入 `PATH`；DSH 会通过它安装和移除插件：
  ```sh
  npm install -g pnpm
  ```
- 浏览图库或领养新宠物时，可以访问 `codexpets.net`。

## 安装

把插件装进你实际使用的那一个 profile。下面使用 `npx`，因此不需要全局安装
`dsh` 可执行命令（CLI Web 版对应 `web` profile）：

```sh
# 本地项目目录
npx @deepseek-ai/dsh plugin --profile web add file:/absolute/path/to/dsh-pets

# GitHub 仓库
npx @deepseek-ai/dsh plugin --profile web add github:next-evolve-x/dsh-plugin-pets

# 或已发布的 npm 包
# npx @deepseek-ai/dsh plugin --profile web add dsh-pets
```

若已全局安装 `dsh`，可将 `npx @deepseek-ai/dsh` 替换为 `dsh`。该包已声明 DSH
bundle，安装时会自动把宿主插件加入 web profile，不需要编辑
`cordis.patch.yml`。

如果之前按旧版本说明在 `~/.dsh/profiles/web/cordis.patch.yml` 中手动添加过
`dsh-pets`，升级后首次重启前请删除那条旧配置。现在由 bundle 自动提供该加载条目。

重启 Web profile：

```sh
npx @deepseek-ai/dsh web
```

打开 DSH Web 界面后，首次领养前右下角会显示一个爪印按钮。点击打开宠物商店，选择宠物后会立即安装并启用。

### 桌面版（DSH Desktop 0.2.x）

桌面版的 `desktop` profile 是应用独占的保留 profile，请通过应用自己的插件入口安装，
不要用全局 npm 安装的 `dsh`：

1. 在应用内打开 **设置 → 插件**，从本地路径或 Git 地址安装；应用会代跑 pnpm
   并把该 bundle 选进 profile；或
2. 使用应用自带的 CLI：

   ```sh
   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
     plugin --profile desktop add file:/absolute/path/to/dsh-pets
   ```

插件页的改动会即时作用到正在运行的应用；刷新窗口即可加载浏览器半边。
从 npm 全局安装的 `dsh` 会直接拒绝 `--profile desktop`（提示该 profile
"由 Electron 应用独占管理"），因此不能用来装这个 profile。

## 版本兼容

浏览器半边读取的是宿主交给插槽（slot）的会话目录，而 `0.2.0` 改了这个结构：

| DSH 版本 | 当前会话 | 后台任务 |
|---|---|---|
| `0.1.0-rc.x` | `catalog.current` | `catalog.jobsBySession[id]` |
| `0.2.x` | `catalog.byId` + `retainedBy.mainView` | `jobs` 客户端服务（`state` 名册 hook + `watchRows`） |

同一份产物同时支持两种结构：`lib/client.js` 里所有读取都走兼容层（对测试导出为
`__compat`），缺少某个 seat 时只会降级心情，不会抛错。悬浮层里的异常绝不能被
忽略——`shell.overlay` 条目抛错会卸载整个宠物图层，这也正是本包 `0.2.0` 之前
在桌面版里"完全不显示"的原因（旧代码访问 `catalog.jobsBySession[undefined]`，
而 0.2 已经去掉了这个字段）。

宿主半边在两代之间没有变化：`webServer.register({ kind: "prefix" })` 与同源
`/pets/*` 路由在 CLI Web profile 和桌面版里都可用。

## 卸载

卸载时传入包名，而不是 GitHub spec：

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-pets
```

桌面版请在 **设置 → 插件** 中移除（或用自带 CLI 执行
`plugin --profile desktop remove dsh-pets`）。

插件管理器会自动从 profile 中移除 bundle，随后重启 Web profile 即可。只有从旧版
手动配置升级的用户，才需要删除 `cordis.patch.yml` 中遗留的 `dsh-pets` 条目。

有关 Git、npm、升级和分发的说明，见 [DISTRIBUTION.md](DISTRIBUTION.md)。

## 使用

- **打开商店**：点击当前宠物；尚未领养时点击爪印按钮。
- **领养前先看长相**：商店卡片直接展示宠物的精灵图缩略图（未领养时按需懒加载，
  已领养则显示同源动画预览）；点“领养”后宠物立即启用并出现在角落。
- **已领养列表带预览**：每只已领养宠物旁边有小型动画缩略图，启用前即可看到样子。
- **移动位置**：拖动当前宠物。松开后会保存距右侧和底部的偏移量。
- **调整动画**：打开宠物菜单后可调整尺寸、预览精灵图动画行，并设置闲置行。
- **切换或删除**：在菜单的“已领养”区域操作。删除当前宠物时会同时清空当前选择。
- **浏览图库**：可按宠物名称、slug 或标签搜索。商店初始显示 60 个结果，支持继续加载。

## 存储与配置

默认数据目录为：

```text
$DSH_HOME/storages/pets/
```

若未设置 `DSH_HOME`，则使用 `~/.dsh/storages/pets/`。

```text
pets/
  state.json            # 当前宠物、尺寸、闲置行与位置
  gallery.json          # 最近一次成功获取的图库数据
  <pet-id>/
    pet.json            # 宠物包中的清单文件
    meta.json           # 本地安装元数据
    spritesheet.webp    # 下载的精灵图资源
```

宿主插件接受可选的 `root` 配置项，可将上述数据存储到其他目录。

## HTTP API

宿主插件会在 DSH Web 服务上注册同源路由。

| 方法 | 路由 | 说明 |
|---|---|---|
| `GET`、`HEAD` | `/pets/api/state` | 返回持久化设置和已安装宠物的清单。 |
| `POST` | `/pets/api/state` | 合并支持的设置：`activeId`、`hidden`、`scale`、`idleRow`、`position`。`scale` 会被限制在 `0.25` 到 `6`。 |
| `GET`、`HEAD` | `/pets/api/gallery` | 返回图库项目。添加 `?refresh=1` 可跳过 10 分钟内存缓存。 |
| `POST` | `/pets/api/install` | 下载并安装宠物。请求体：`{ "slug": "pet-slug" }`。安装后的宠物会成为当前宠物。 |
| `POST` | `/pets/api/remove` | 删除本地缓存的宠物。请求体：`{ "id": "pet-id" }`。 |
| `GET`、`HEAD` | `/pets/assets/<id>/<file>` | 提供已安装宠物的资源文件。 |

请求体必须是 JSON，大小限制为 1 MiB。宠物 ID、slug 和资源文件名均会校验，资源路径也会确认仍位于配置的宠物目录内。

## 数据与隐私

浏览器只会请求同源的 DSH 路由。DSH 宿主只会在获取图库和下载领养宠物包时连接 `codexpets.net`。图库数据和已安装资源均保存在前述本地宠物目录中。

## 开发说明

该包由两个部分组成：

| 文件 | 作用 |
|---|---|
| `lib/index.js` | DSH 宿主插件：负责存储、ZIP 解压、图库获取和 HTTP 路由。 |
| `lib/client.js` | DSH 浏览器客户端模块：负责悬浮 UI、精灵图渲染、会话状态驱动的心情和本地化。 |

仓库包含独立的冒烟测试脚本：

```sh
node test-host.mjs
node test-client.mjs
```

`test-host.mjs` 会自己从 `codexpets.net` 下载 fixture，然后覆盖 ZIP 解析、图库抓取、
安装/卸载、路径穿越防护与线上图库请求。`test-client.mjs` 用宿主实际使用的 React
物化浏览器产物，分别按两代会话目录结构渲染悬浮层，并用脏数据验证兼容层
（导出为 `__compat`）。

真正验证一次改动需要打开页面，而不只是渲染：启动目标 profile
（`dsh --profile <name> --port 3030 --no-open`），用无头浏览器加载，并检查控制台
是否出现 `slot entry crashed in 'shell.overlay'`。这条信息是悬浮层插件必须避开的
失败模式。

## 致谢

- 宠物包和公开图库由 [codex-pets.net](https://codexpets.net/) 提供。
- 精灵图格式遵循 [Codex Pet spritesheet guide](https://codex-pet.org/spritesheet-webp/)。

## 许可证

MIT
