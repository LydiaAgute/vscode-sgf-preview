# SGF 棋谱预览

[English](README.md) | 简体中文

在 VS Code 中预览和编辑 SGF 围棋棋谱，拖动进度条逐手查看棋面，并显示棋手、段位、提子、对局信息和注释。

棋谱解析、棋盘规则和形势估算基于 [Sabaki](https://github.com/SabakiHQ/Sabaki) 项目的开源库，详见文末的[致谢](#致谢)。本插件是独立项目，并非 Sabaki 官方出品。

## 功能

### 预览

在 `.sgf` 文件上右键（资源管理器、标签页、编辑器均可），或点击编辑器右上角的图标，选择”预览棋谱”。

- 进度条：拖动查看任意一手的棋面
- 手数框：点击进度条旁的手数，输入数字后按回车直接跳到该手；框内 ↑/↓ 逐手前后，Esc 取消输入
- 按钮与快捷键：方向键（±1 手）、PageUp/PageDown（±10 手）、Home/End（首/尾）、空格（自动播放）
- 棋盘上滚轮可逐手切换
- 四个显示开关：“显示手数”“显示坐标”“显示领地”“显示变化图”
- 文件保存或在编辑器中修改后，预览自动刷新

### 第三方棋谱写法兼容

识别逻辑集中在 `webview/compat.ts`，只在展示层使用，不改动解析出的棋谱树。每条规则都是精确匹配，标准棋谱的取值不会被改写：

- `KM[375]`、`KM[650]`：野狐、99 围棋的贴目编码，查表还原为 7.5、6.5 目（650 不能按比例换算）
- `RE` 的 `W+0.02`、`B+0.02`（超时）、`W+0.03`、`B+0.03`（断线）、`R+R`（和棋）：归一为 `T`、`O`、`0`
- 野狐（`AP` 含 `foxwq`）中国规则下，`RE` 记的是子数，按 1 子 = 2 目换算后再显示

中国规则下，贴目、结果和领先数都以“子”显示（1 子 = 2 目），其他规则以“目”显示。

### 形势估算

侧栏的“形势估算”和棋盘上的领地标记由 `@sabaki/influence` 的静态启发式算法给出，不依赖围棋 AI 引擎。

- 领地：勾选“显示领地”后，空点上的小方块表示该点归属的一方（默认关闭）
- 领先数：日本、韩国规则按“地 + 提子”，其余规则按“子 + 地”，再减去贴目
- 算法不识别死子，棋盘上的子一律当活子，所以中盘和有大块死棋的局面误差较大，只适合粗看大势

### 变化图

SGF 的变化（分支）默认不显示，勾选“显示变化图”后，走到分叉点时侧栏列出各分支的第一手和首条注释，棋盘上以带字母 A、B、C… 的半透明棋子标出各分支的下一手。点击列表项或棋盘上的半透明棋子即进入该分支，进度条随之切换到这条路径，侧栏的“返回主线”按钮回到离开主线的那一手。

四个显示开关的状态会被记住,对所有棋谱生效。

### 文本编辑

**语法高亮**：根据你的主题对括号、分号、属性名、属性值着色。

**字段悬浮提示**：鼠标悬浮在属性名上（如 `PB`、`KM`、`C`）时显示该属性在 FF[4] 规范中的名称、说明和值类型。

## 语言与设置

目前支持英文和简体中文。设置项 `sgfPreview.language`（设置里搜索“SGF”）可选：

| 取值 | 含义 |
|---|---|
| `auto`（默认） | 跟随 VS Code 的显示语言，不是英文或简体中文时使用英文 |
| `en` | 固定使用英文 |
| `zh-cn` | 固定使用简体中文 |

修改后，已打开的预览页面和之后的提示信息会立即切换，不需要重启。插件名称和命令标题由 VS Code 在启动时读取，始终跟随 VS Code 显示语言。切换 VS Code 显示语言的方法：在命令面板运行“Configure Display Language”，然后重启 VS Code。

设置项 `sgfPreview.openLocation` 决定新预览在哪里打开：

| 取值 | 含义 |
|---|---|
| `current`（默认） | 在当前编辑器组打开，与棋谱文件的标签页放在一起 |
| `beside` | 在侧边的编辑器组打开，可以一边看源文件一边看棋盘 |

已经有预览的棋谱，再次点击“预览棋谱”只会切换到原来的预览，不会重复打开。

## 开发

项目使用 [pnpm](https://pnpm.io/)，版本固定在 `package.json` 的 `packageManager` 和 `devEngines` 中，用 `npm install` 会被拒绝。

```bash
pnpm install
pnpm run build      # 打包到 dist/
pnpm run typecheck  # 检查 TypeScript 类型（esbuild 只转译不检查）
pnpm test           # 用 sgf/ 下的样例做解析与回放检查，并校验语言包
pnpm run icon       # 由 scripts/gen-icon.js 重新生成插件图标 media/icon.png 与 media/icon.svg
```

pnpm 的配置在 `pnpm-workspace.yaml`：`jschardet` 的版本覆盖，以及 `allowBuilds`（只允许 esbuild 执行安装脚本）。

编辑器标题栏按钮的图标是 `media/icons/preview-light.svg` 和 `preview-dark.svg`（分别用于浅色和深色主题），为手写 SVG。

在 VS Code 中打开本目录，按 F5 启动扩展开发宿主。

### 增加语言

- 扩展自身文案（名称、描述、命令标题、设置项说明）：复制 `package.nls.json` 为 `package.nls.<locale>.json`，翻译其中的值
- 扩展主进程的运行时提示：复制 `l10n/bundle.l10n.zh-cn.json` 为 `l10n/bundle.l10n.<locale>.json`，键保持英文原文，并在 `src/messages.ts` 的 `catalogs` 表里登记
- 预览页面文案：复制 `webview/locales/en.json` 为 `webview/locales/<locale>.json`，翻译其中的值，并在 `webview/i18n.ts` 的 `catalogs` 表里登记
- 设置项：在 `package.json` 里把新语言加入 `sgfPreview.language` 的 `enum` 和 `enumDescriptions`，并在 `package.nls*.json` 里补上说明
- 文档：`README.<locale>.md`

`pnpm test` 会检查每个语言包的键和占位符与英文一致，以及设置项的可选值与实际支持的语言一致。

## 开源组件与许可

本插件基于 [Sabaki](https://github.com/SabakiHQ/Sabaki) 项目拆分出的开源库实现棋谱的核心逻辑，并依赖它们的后续演进来扩展功能：

| 库 | 用途 | 许可证 |
|---|---|---|
| [@sabaki/sgf](https://github.com/SabakiHQ/sgf) | SGF 解析、字符编码识别、顶点解析 | MIT |
| [@sabaki/go-board](https://github.com/SabakiHQ/go-board) | 棋盘规则：落子、提子、气、打劫、让子位置 | MIT |
| [@sabaki/influence](https://github.com/SabakiHQ/influence) | 形势估算：领地归属 | MIT |

它们的传递依赖 `doken`、`iconv-lite`、`safer-buffer`（MIT）和 `jschardet`（0BSD）一并打包进发布包。

上述库的版权声明与许可声明完整收录在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，随插件一起分发。该文件由 `pnpm run notices` 根据 `node_modules` 中的实际 LICENSE 文件生成，遇到白名单（MIT、0BSD）之外的许可证会报错。

棋盘与界面（`webview/`、`media/`）为本项目自行编写，没有使用 Sabaki 应用本身（GUI）的代码或素材。

### jschardet 版本说明

`@sabaki/sgf` 依赖的 `jschardet` 在 2.x、3.x 版本的协议为 LGPL-2.1+，4.x 起改为 0BSD。本项目通过 `pnpm-workspace.yaml` 的 `overrides` 固定使用 4.1.0，避免把 LGPL 代码打进发布包。升级依赖后请重新执行 `pnpm run notices` 确认许可证。

## 致谢

感谢 [Yichuan Shen](https://github.com/yishn) 和 [SabakiHQ](https://github.com/SabakiHQ) 社区开源并维护 Sabaki 项目及其拆分出的 `sgf`、`go-board`、`influence` 等库。没有这些高质量的 MIT 协议组件，这个插件不会这么快做出来，后续的功能扩展也将继续依赖它们。

本插件为独立项目，与 Sabaki 项目及其作者没有隶属或授权关系，名称中不使用 Sabaki 字样。

## 许可

本项目以 MIT 协议发布，见 [LICENSE](LICENSE)。第三方组件的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
