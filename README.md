# SGF Game Preview

English | [简体中文](README.zh-cn.md)

Preview and edit SGF Go game records in VS Code. Drag the progress bar to step through the moves, and see the players, ranks, captures, game info and comments at a glance.

Game parsing, board rules and position estimation are based on open-source libraries from the [Sabaki](https://github.com/SabakiHQ/Sabaki) project. See [Acknowledgements](#acknowledgements). This extension is an independent project and is not an official Sabaki product.

## Features

### Preview

Right-click an `.sgf` file (in the Explorer, on its editor tab, or inside the editor), or click the icon at the top right of the editor, and choose "Preview Game Record".

- Progress bar: drag to view the board after any move
- Move number box: click the number next to the progress bar, type a move number and press Enter to jump straight to it. ↑/↓ inside the box step one move, Esc cancels
- Buttons and shortcuts: arrow keys (±1 move), PageUp/PageDown (±10 moves), Home/End (first/last), Space (auto-play)
- Scroll the mouse wheel over the board to step through the moves
- Four display options: "Show move numbers", "Show coordinates", "Show territory" and "Show variations"
- The preview refreshes automatically when the file is saved or edited

### Game records from other platforms

The recognition logic lives in `webview/compat.ts`. It is only used when displaying, and never changes the parsed game tree. Every rule is an exact match, so values in standard game records are left untouched:

- `KM[375]` and `KM[650]`: komi codes used by Fox Weiqi and 99 Weiqi, restored by table lookup to 7.5 and 6.5 points (650 cannot be converted by ratio)
- `RE` values `W+0.02`, `B+0.02` (timeout), `W+0.03`, `B+0.03` (disconnection) and `R+R` (draw): normalized to `T`, `O` and `0`
- Under Chinese rules in Fox Weiqi records (`AP` contains `foxwq`), `RE` is recorded in stones. It is converted at 1 stone = 2 points before display

Under Chinese rules, komi, results and leads are shown in stones (1 stone = 2 points). Other rules use points.

### Position estimate

The "Position estimate" section in the side panel and the territory marks on the board come from the static heuristics of `@sabaki/influence`. No Go AI engine is involved.

- Territory: when "Show territory" is checked, the small squares on empty points show which side owns the point (off by default)
- Lead: under Japanese and Korean rules it is territory + captures, otherwise stones + territory, minus komi
- Dead stones are not detected and every stone on the board counts as alive, so the estimate is rough in the middle game and in positions with large dead groups. Use it to get a feel for the overall balance only

### Variations

Variations (branches) are hidden by default. When "Show variations" is checked and you reach a fork, the side panel lists the first move and first comment of each variation, and the board marks the next move of each variation with a translucent stone labeled A, B, C… Click a list item or a translucent stone to enter that variation. The progress bar then follows that path, and "Back to main line" returns to the move where you left the main line.

The four display options are remembered and apply to all game records.

### Text editing

**Syntax highlighting**: Brackets, semicolons, property names and property values are colored according to your theme.

**Property hover**: Hover over a property name (e.g., `PB`, `KM`, `C`) to see its name, description and value type from the FF[4] specification.

## Language and settings

English and Simplified Chinese are supported. The `sgfPreview.language` setting (search for "SGF" in Settings) has these values:

| Value | Meaning |
|---|---|
| `auto` (default) | Follow the VS Code display language, and use English if it is neither English nor Simplified Chinese |
| `en` | Always use English |
| `zh-cn` | Always use Simplified Chinese |

Changes apply immediately to open previews and to later messages, with no restart needed. The extension name and command titles are read by VS Code at startup, so they always follow the VS Code display language. To change that, run "Configure Display Language" from the Command Palette and restart VS Code.

The `sgfPreview.openLocation` setting decides where a new preview opens:

| Value | Meaning |
|---|---|
| `current` (default) | In the current editor group, next to the tab of the game record file |
| `beside` | In the editor group beside it, so you can look at the source file and the board side by side |

If a game record already has a preview, running "Preview Game Record" again just brings that preview to the front instead of opening another one.

## Development

The project uses [pnpm](https://pnpm.io/). The version is pinned in `packageManager` and `devEngines` in `package.json`, and `npm install` is rejected.

```bash
pnpm install
pnpm run build      # bundle into dist/
pnpm run typecheck  # type-check the TypeScript sources (esbuild only transpiles)
pnpm test           # parse and replay the samples under sgf/, and check the locale files
pnpm run icon       # regenerate the extension icon media/icon.png and media/icon.svg from scripts/gen-icon.js
```

pnpm settings are in `pnpm-workspace.yaml`: the `jschardet` version override, and `allowBuilds`, which only lets esbuild run its install script.

The editor title bar button uses `media/icons/preview-light.svg` and `preview-dark.svg` (for light and dark themes). They are hand-written SVG files.

Open this folder in VS Code and press F5 to start the Extension Development Host.

### Adding a language

- Extension texts (name, description, command title, setting descriptions): copy `package.nls.json` to `package.nls.<locale>.json` and translate the values
- Runtime messages of the extension host: copy `l10n/bundle.l10n.zh-cn.json` to `l10n/bundle.l10n.<locale>.json`, keeping the English source texts as keys, and register it in the `catalogs` table in `src/messages.ts`
- Preview page texts: copy `webview/locales/en.json` to `webview/locales/<locale>.json`, translate the values, and register it in the `catalogs` table in `webview/i18n.ts`
- Setting: add the new language to `enum` and `enumDescriptions` of `sgfPreview.language` in `package.json`, and add its description to `package.nls*.json`
- Documentation: `README.<locale>.md`

`pnpm test` checks that every language file has the same keys and placeholders as the English one, and that the values of the setting match the languages actually supported.

## Open-source components and licenses

This extension implements the core game-record logic with open-source libraries split out of the [Sabaki](https://github.com/SabakiHQ/Sabaki) project, and relies on their future development to extend its features:

| Library | Purpose | License |
|---|---|---|
| [@sabaki/sgf](https://github.com/SabakiHQ/sgf) | SGF parsing, character encoding detection, vertex parsing | MIT |
| [@sabaki/go-board](https://github.com/SabakiHQ/go-board) | Board rules: moves, captures, liberties, ko, handicap placement | MIT |
| [@sabaki/influence](https://github.com/SabakiHQ/influence) | Position estimate: territory ownership | MIT |

Their transitive dependencies `doken`, `iconv-lite`, `safer-buffer` (MIT) and `jschardet` (0BSD) are bundled into the published package as well.

The copyright and license notices of these libraries are included in full in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which ships with the extension. The file is generated by `pnpm run notices` from the actual LICENSE files in `node_modules`, and the script fails on any license outside the allowlist (MIT, 0BSD).

The board and the user interface (`webview/`, `media/`) are written for this project. No code or assets from the Sabaki application (GUI) itself are used.

### About the jschardet version

`@sabaki/sgf` depends on `jschardet`, which is licensed under LGPL-2.1+ in versions 2.x and 3.x and under 0BSD from 4.x on. This project pins version 4.1.0 through `overrides` in `pnpm-workspace.yaml`, so no LGPL code is bundled. After upgrading dependencies, run `pnpm run notices` again to confirm the licenses.

## Acknowledgements

Thanks to [Yichuan Shen](https://github.com/yishn) and the [SabakiHQ](https://github.com/SabakiHQ) community for creating and maintaining Sabaki and the libraries split out of it, such as `sgf`, `go-board` and `influence`. This extension would not have come together so quickly without these high-quality MIT-licensed components, and future features will keep building on them.

This extension is an independent project. It has no affiliation with, or authorization from, the Sabaki project or its authors, and the name does not use the Sabaki mark.

## License

This project is released under the MIT license, see [LICENSE](LICENSE). Licenses of third-party components are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
