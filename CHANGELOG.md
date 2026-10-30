# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/)，版本号遵循语义化版本。

## [0.1.0]

首个版本。

- 在右键菜单与编辑器标题栏提供「预览棋谱」入口，在棋盘上预览 `.sgf` 棋谱。
- 手数滑块、首尾与前后跳转按钮、自动播放、键盘与滚轮操作，手数框可直接输入数字跳转。
- 显示对局双方、规则、贴目、结果、时限等信息，以及节点注释。
- 变化图：可选显示分支并切换，支持返回主线。
- 局面估算：基于 Sabaki 的影响力模型显示领地与领先目数。
- 兼容野狐棋谱的部分非标准写法（仅限精确匹配，不影响标准棋谱）。
- 中英双语界面，设置项 `sgfPreview.language`；设置项 `sgfPreview.openLocation` 控制在当前窗口或侧边打开。

---

Changelog format follows [Keep a Changelog](https://keepachangelog.com/); versions follow semantic versioning.

## [0.1.0]

Initial release.

- "Preview Game Record" entry in the context menu and editor title bar for `.sgf` files.
- Move slider, first/last and step buttons, autoplay, keyboard and wheel navigation; type a move number to jump.
- Player, rules, komi, result and time-control info, plus node comments.
- Variations: optional display and switching, with a way back to the main line.
- Position estimate: territory and score lead based on Sabaki's influence model.
- Compatibility with some non-standard Fox Weiqi records (exact matches only; standard records are untouched).
- English and Chinese UI via `sgfPreview.language`; `sgfPreview.openLocation` opens the preview in the current group or beside.
