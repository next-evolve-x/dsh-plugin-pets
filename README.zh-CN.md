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

- 已安装并可使用 Web profile 的 DSH。
- 使用与当前 DSH 安装兼容的 Node.js 版本。插件本身没有运行时 npm 依赖。
- `pnpm` 已加入 `PATH`；DSH 会通过它安装和移除插件：
  ```sh
  npm install -g pnpm
  ```
- 浏览图库或领养新宠物时，可以访问 `codexpets.net`。

## 安装

将插件安装到 DSH 的 `web` profile。下面使用 `npx`，因此不需要全局安装
`dsh` 可执行命令：

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

## 卸载

卸载时传入包名，而不是 GitHub spec：

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-pets
```

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

`test-host.mjs` 需要预先准备 `/tmp/agumon.zip` 和 `/tmp/codexpets_fresh.html` 两个本地 fixture 文件，之后还会请求线上图库和安装接口。`test-client.mjs` 需要已安装 DSH Web profile 及其 React 依赖。

## 致谢

- 宠物包和公开图库由 [codex-pets.net](https://codexpets.net/) 提供。
- 精灵图格式遵循 [Codex Pet spritesheet guide](https://codex-pet.org/spritesheet-webp/)。

## 许可证

MIT
