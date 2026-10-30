import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as sgfTree from './sgfTree';
import * as messages from './messages';
import {
  OPTION_KEYS,
  type DisplayOptions,
  type HostMessage,
  type SgfTree,
  type WebviewMessage,
} from './protocol';

const SGF_EXT = /\.sgf$/i;

const t = messages.t;

/** 读取 sgfPreview.openLocation：current 在当前编辑组打开，beside 在侧边编辑组打开 */
function openColumn(): vscode.ViewColumn {
  const where = vscode.workspace
    .getConfiguration('sgfPreview')
    .get<string>('openLocation', 'current');
  return where === 'beside' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
}

/** 读取 sgfPreview.language 并换算成实际语言，同时更新扩展提示信息使用的语言 */
function currentLocale(): string {
  const setting = vscode.workspace.getConfiguration('sgfPreview').get<string>('language', 'auto');
  const locale = messages.resolve(setting, vscode.env.language);
  messages.setLocale(locale);
  return locale;
}

// 显示选项（手数、坐标、领地、变化图）存入 globalState，所有棋谱共用并跨会话保留
const OPTIONS_KEY = 'sgfPreview.displayOptions';

function loadOptions(context: vscode.ExtensionContext): Partial<DisplayOptions> {
  return context.globalState.get<Partial<DisplayOptions>>(OPTIONS_KEY, {});
}

function saveOptions(context: vscode.ExtensionContext, options: unknown): void {
  if (!options || typeof options !== 'object') return;
  const input = options as Record<string, unknown>;
  const clean: Partial<DisplayOptions> = {};
  for (const key of OPTION_KEYS) {
    const value = input[key];
    if (typeof value === 'boolean') clean[key] = value;
  }
  void context.globalState.update(OPTIONS_KEY, { ...loadOptions(context), ...clean });
}

/** 已打开的预览面板，按文件 URI 复用，同一文件只开一个 */
const previews = new Map<string, SgfPreview>();

export function activate(context: vscode.ExtensionContext): void {
  currentLocale();
  context.subscriptions.push(
    // 修改语言设置后，已打开的预览立即切换
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('sgfPreview.language')) return;
      const locale = currentLocale();
      for (const preview of previews.values()) preview.applyLocale(locale);
    }),
    vscode.commands.registerCommand('sgfPreview.open', (uri?: unknown, selected?: unknown) => {
      // 资源管理器多选时第二个参数是选中的 URI 数组
      const picked: unknown[] = Array.isArray(selected) && selected.length ? selected : [uri];
      const targets = picked
        .map((u) => (u instanceof vscode.Uri ? u : activeEditorUri()))
        .filter((u): u is vscode.Uri => !!u && SGF_EXT.test(u.path));
      if (!targets.length) {
        void vscode.window.showWarningMessage(t('Please select an .sgf game record first'));
        return;
      }
      for (const target of targets) openPreview(context, target);
    }),
  );
}

export function deactivate(): void {
  for (const preview of previews.values()) preview.dispose();
}

function activeEditorUri(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor ? editor.document.uri : undefined;
}

function openPreview(context: vscode.ExtensionContext, uri: vscode.Uri): void {
  const key = uri.toString();
  const existing = previews.get(key);
  if (existing) {
    existing.panel.reveal();
    return;
  }
  previews.set(key, new SgfPreview(context, uri));
}

class SgfPreview {
  readonly panel: vscode.WebviewPanel;
  private readonly key: string;
  private disposed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly uri: vscode.Uri,
  ) {
    this.key = uri.toString();

    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
    const distRoot = vscode.Uri.joinPath(context.extensionUri, 'dist');
    const column = openColumn();

    this.panel = vscode.window.createWebviewPanel(
      'sgfPreview',
      t('Game: {0}', path.basename(uri.path)),
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot, distRoot],
      },
    );
    this.panel.webview.html = buildHtml(this.panel.webview, mediaRoot, distRoot, currentLocale());

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage | undefined) => {
        if (!msg) return;
        if (msg.type === 'ready') void this.send(false);
        else if (msg.type === 'options') saveOptions(this.context, msg.options);
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // 磁盘上的文件变化（保存、外部程序改写）时刷新
    const dir = uri.with({ path: path.posix.dirname(uri.path) });
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(dir, path.posix.basename(uri.path)),
    );
    watcher.onDidChange(() => this.scheduleRefresh(), null, this.disposables);
    watcher.onDidCreate(() => this.scheduleRefresh(), null, this.disposables);
    this.disposables.push(watcher);

    // 编辑器中未保存的修改也实时反映
    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === this.key && e.document.isDirty) this.scheduleRefresh();
      },
      null,
      this.disposables,
    );
  }

  /** 切换语言：页面内文案由 webview 重新渲染，面板标题在这里更新 */
  applyLocale(locale: string): void {
    this.panel.title = t('Game: {0}', path.basename(this.uri.path));
    this.post({ type: 'locale', locale });
  }

  private post(message: HostMessage): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.send(true), 300);
  }

  private async send(keepPosition: boolean): Promise<void> {
    let message: HostMessage;
    try {
      message = {
        type: 'load',
        tree: await this.readTree(),
        keepPosition,
        options: loadOptions(this.context),
      };
    } catch (err) {
      message = {
        type: 'error',
        message: t(
          'Failed to read the game record: {0}',
          err instanceof Error ? err.message : String(err),
        ),
      };
    }
    this.post(message);
  }

  private async readTree(): Promise<SgfTree> {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.key);
    if (doc && doc.isDirty) return sgfTree.fromText(doc.getText());
    // 未修改时直接读磁盘字节，由 @sabaki/sgf 判定编码；编辑器按 UTF-8 打开 GBK 棋谱会是乱码
    return sgfTree.fromBytes(await vscode.workspace.fs.readFile(this.uri));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.refreshTimer);
    previews.delete(this.key);
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

function buildHtml(
  webview: vscode.Webview,
  mediaRoot: vscode.Uri,
  distRoot: vscode.Uri,
  locale: string,
): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const res = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, name));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${res('preview.css')}">
<title>SGF</title>
</head>
<body>
<div id="app">
  <main id="board-wrap">
    <svg id="board" role="img" data-i18n-aria="board.label"></svg>
  </main>
  <nav id="nav" data-i18n-aria="nav.aria">
    <div class="buttons">
      <button id="btn-first" data-i18n-aria="nav.first" data-shortcut="Home"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="2" height="10"/><path d="M14 3v10L5 8z"/></svg></button>
      <button id="btn-back10" data-i18n-aria="nav.back10" data-shortcut="PageUp"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10L1 8zM15 3v10L8 8z"/></svg></button>
      <button id="btn-prev" data-i18n-aria="nav.prev" data-shortcut="←"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11 3v10L4 8z"/></svg></button>
      <button id="btn-play" data-i18n-aria="nav.play" data-shortcut="Space">
        <svg id="icon-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10l8-5z"/></svg>
        <svg id="icon-pause" viewBox="0 0 16 16" aria-hidden="true" hidden><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>
      </button>
      <button id="btn-next" data-i18n-aria="nav.next" data-shortcut="→"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10l7-5z"/></svg></button>
      <button id="btn-fwd10" data-i18n-aria="nav.fwd10" data-shortcut="PageDown"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 3v10l7-5zM8 3v10l7-5z"/></svg></button>
      <button id="btn-last" data-i18n-aria="nav.last" data-shortcut="End"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3v10l9-5z"/><rect x="12" y="3" width="2" height="10"/></svg></button>
    </div>
    <input id="slider" type="range" min="0" max="0" value="0" step="1" data-i18n-aria="nav.slider">
    <span id="move-counter" class="move-counter">
      <span id="move-prefix" class="move-prefix"></span>
      <input id="move-input" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" data-i18n-aria="nav.jump" data-i18n-title="nav.jumpHint">
      <span id="move-total" class="move-total"></span>
    </span>
    <span id="move-status" class="sr-only" aria-live="polite"></span>
  </nav>
  <aside id="side">
    <section class="players" data-i18n-aria="players.aria">
      <div class="player" id="player-black">
        <span class="stone black" aria-hidden="true"></span>
        <div class="pinfo">
          <div class="pname"><span id="black-name"></span><span class="rank" id="black-rank"></span></div>
          <div class="pmeta"><span id="black-caps"></span><span id="black-time"></span></div>
        </div>
      </div>
      <div class="player" id="player-white">
        <span class="stone white" aria-hidden="true"></span>
        <div class="pinfo">
          <div class="pname"><span id="white-name"></span><span class="rank" id="white-rank"></span></div>
          <div class="pmeta"><span id="white-caps"></span><span id="white-time"></span></div>
        </div>
      </div>
    </section>
    <section data-i18n-aria="estimate.title">
      <h3 data-i18n="estimate.title"></h3>
      <div id="lead-text" class="lead-text" aria-live="polite"></div>
      <div id="lead-bar" class="lead-bar" role="img" data-i18n-aria="estimate.bar"><span id="lead-black"></span><span id="lead-white"></span></div>
      <div id="lead-detail" class="lead-detail"></div>
    </section>
    <section id="var-section" data-i18n-aria="var.title" hidden>
      <h3 data-i18n="var.title"></h3>
      <div id="var-status" class="var-status" hidden>
        <span data-i18n="var.viewing"></span>
        <button type="button" id="btn-mainline" class="text-btn" data-i18n="var.backToMain"></button>
      </div>
      <div id="var-hint" class="var-hint"></div>
      <ol id="var-list" class="var-list"></ol>
    </section>
    <section>
      <h3 data-i18n="info.title"></h3>
      <dl id="info"></dl>
    </section>
    <section>
      <h3 data-i18n="comment.title"></h3>
      <div id="comment" class="comment"></div>
    </section>
    <section class="options">
      <label><input type="checkbox" id="opt-numbers"> <span data-i18n="opt.numbers"></span></label>
      <label><input type="checkbox" id="opt-coords"> <span data-i18n="opt.coords"></span></label>
      <label><input type="checkbox" id="opt-territory"> <span data-i18n="opt.territory"></span></label>
      <label><input type="checkbox" id="opt-variations"> <span data-i18n="opt.variations"></span></label>
    </section>
    <footer class="credits" data-i18n="credits"></footer>
  </aside>
</div>
<div id="error" class="error" role="alert" hidden></div>
<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(distRoot, 'webview.js'))}"></script>
</body>
</html>`;
}
