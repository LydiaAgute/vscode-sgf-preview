import type { Vertex } from '@sabaki/go-board';
import * as SgfGame from './game';
import { BLACK, WHITE, EMPTY } from './game';
import type { Choices, Color, Game, GameInfo, Marker, Move, Position } from './game';
import * as Analysis from './analysis';
import type { Estimate } from './analysis';
import * as Compat from './compat';
import * as I18n from './i18n';
import { t, tn } from './i18n';
import { OPTION_KEYS } from '../src/protocol';
import type { DisplayOptions, HostMessage, SgfTree, WebviewMessage } from '../src/protocol';

/** webview 隐藏再显示、重新加载时由 VS Code 保存的页面状态 */
interface ViewState extends Partial<DisplayOptions> {
  index?: number;
  choices?: Choices;
}

interface State extends DisplayOptions {
  game: Game | null;
  index: number;
  timer: ReturnType<typeof setInterval> | undefined;
  tree: SgfTree | null;
  /** {节点 id: 子节点下标}，记录在哪些分叉点改走了其他分支 */
  choices: Choices;
}

type Side = 'black' | 'white';

const vscode = acquireVsCodeApi<ViewState>();
const post = (message: WebviewMessage) => vscode.postMessage(message);

// 语言来自扩展端写在 <html lang> 上的 VS Code 显示语言；静态文案一次翻译，动态文案渲染时翻译
I18n.setLocale(document.documentElement.lang);
I18n.applyStatic(document);
const SVG_NS = 'http://www.w3.org/2000/svg';
const COORD_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghjklmnopqrstuvwxyz';
const AUTOPLAY_INTERVAL = 800;

function $<T extends Element = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as unknown as T;
}

const els = {
  board: $<SVGSVGElement>('board'),
  slider: $<HTMLInputElement>('slider'),
  movePrefix: $('move-prefix'),
  moveInput: $<HTMLInputElement>('move-input'),
  moveTotal: $('move-total'),
  moveStatus: $('move-status'),
  info: $('info'),
  comment: $('comment'),
  error: $('error'),
  optNumbers: $<HTMLInputElement>('opt-numbers'),
  optCoords: $<HTMLInputElement>('opt-coords'),
  optTerritory: $<HTMLInputElement>('opt-territory'),
  optVariations: $<HTMLInputElement>('opt-variations'),
  leadText: $('lead-text'),
  leadBar: $('lead-bar'),
  leadBlack: $('lead-black'),
  leadWhite: $('lead-white'),
  leadDetail: $('lead-detail'),
  iconPlay: $<SVGSVGElement>('icon-play'),
  iconPause: $<SVGSVGElement>('icon-pause'),
  btnPlay: $<HTMLButtonElement>('btn-play'),
  varSection: $('var-section'),
  varStatus: $('var-status'),
  varHint: $('var-hint'),
  varList: $('var-list'),
  btnMainline: $<HTMLButtonElement>('btn-mainline'),
};

const saved: ViewState = vscode.getState() || {};
const state: State = {
  game: null,
  index: 0,
  showNumbers: !!saved.showNumbers,
  showCoords: saved.showCoords !== false,
  showTerritory: !!saved.showTerritory,
  showVariations: !!saved.showVariations,
  timer: undefined,
  tree: null,
  choices: saved.choices && typeof saved.choices === 'object' ? saved.choices : {},
};
els.optNumbers.checked = state.showNumbers;
els.optCoords.checked = state.showCoords;
els.optTerritory.checked = state.showTerritory;
els.optVariations.checked = state.showVariations;

// 显示选项跨面板、跨会话记忆，由扩展端存入 globalState
function applyOptions(options: Partial<DisplayOptions>): void {
  for (const key of OPTION_KEYS) {
    const value = options[key];
    if (typeof value === 'boolean') state[key] = value;
  }
  els.optNumbers.checked = state.showNumbers;
  els.optCoords.checked = state.showCoords;
  els.optTerritory.checked = state.showTerritory;
  els.optVariations.checked = state.showVariations;
}

function persist(): void {
  vscode.setState({
    index: state.index,
    showNumbers: state.showNumbers,
    showCoords: state.showCoords,
    showTerritory: state.showTerritory,
    showVariations: state.showVariations,
    choices: state.choices,
  });
}

function saveOptions(): void {
  const options: Partial<DisplayOptions> = {};
  for (const key of OPTION_KEYS) options[key] = state[key];
  post({ type: 'options', options });
}

/** SVG 元素没有 hidden 属性，用同名 HTML 特性控制显隐 */
function setHidden(el: Element, hidden: boolean): void {
  el.toggleAttribute('hidden', hidden);
}

// ---------- 加载 ----------

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  if (msg.type === 'load') {
    if (msg.options) applyOptions(msg.options);
    load(msg.tree, msg.keepPosition);
  } else if (msg.type === 'error') {
    showError(msg.message);
  } else if (msg.type === 'locale') {
    changeLocale(msg.locale);
  }
});

/** 设置里切换语言后，重新翻译静态文案并重绘所有动态内容 */
function changeLocale(locale: string): void {
  I18n.setLocale(locale);
  document.documentElement.lang = I18n.resolveLocale(locale);
  I18n.applyStatic(document);
  setPlayLabel(t(state.timer ? 'nav.pause' : 'nav.play'));
  if (!state.game) return;
  renderInfo(state.game.info, state.game);
  render();
}

function load(tree: SgfTree, keepPosition: boolean): void {
  if (!state.showVariations) state.choices = {};
  let game: Game;
  try {
    game = SgfGame.build(tree, state.choices);
  } catch (err) {
    showError(t('error.parse', { message: err instanceof Error ? err.message : String(err) }));
    return;
  }
  hideError();
  const restore = keepPosition && state.game ? state.index : saved.index;
  state.tree = tree;
  state.game = game;
  els.slider.max = String(game.positions.length - 1);
  renderInfo(game.info, game);
  goTo(typeof restore === 'number' && Number.isInteger(restore) ? restore : 0);
}

function showError(message: string): void {
  els.error.textContent = message;
  els.error.hidden = false;
}

function hideError(): void {
  els.error.hidden = true;
}

// ---------- 导航 ----------

function goTo(index: number): void {
  const game = state.game;
  if (!game) return;
  const max = game.positions.length - 1;
  state.index = Math.max(0, Math.min(max, index));
  if (state.index >= max) stopAutoplay();
  render();
  persist();
}

const step = (delta: number) => goTo(state.index + delta);

// ---------- 变化图 ----------

function rebuild(index: number): void {
  if (!state.tree) return;
  state.game = SgfGame.build(state.tree, state.choices);
  els.slider.max = String(state.game.positions.length - 1);
  goTo(index);
}

/** 在当前分叉点进入第 k 个分支，并前进到该分支的第一手 */
function selectBranch(k: number): void {
  stopAutoplay();
  if (!state.game) return;
  const pos = state.game.positions[state.index];
  if (!pos.branches.length) return;
  if (k !== pos.choice) {
    if (k === 0) delete state.choices[pos.node.id];
    else state.choices[pos.node.id] = k;
    rebuild(state.index + 1);
  } else {
    goTo(state.index + 1);
  }
}

/** 清除所有分支选择，回到主线上离开主线的那一手 */
function backToMain(): void {
  stopAutoplay();
  if (!state.game) return;
  const firstInVariation = state.game.positions.findIndex((p) => p.inVariation);
  const fork = firstInVariation < 0 ? state.index : firstInVariation - 1;
  state.choices = {};
  rebuild(Math.min(state.index, fork));
}

function toggleAutoplay(): void {
  if (state.timer) {
    stopAutoplay();
    return;
  }
  const game = state.game;
  if (!game) return;
  if (state.index >= game.positions.length - 1) goTo(0);
  state.timer = setInterval(() => step(1), AUTOPLAY_INTERVAL);
  setHidden(els.iconPlay, true);
  setHidden(els.iconPause, false);
  setPlayLabel(t('nav.pause'));
}

function stopAutoplay(): void {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = undefined;
  setHidden(els.iconPlay, false);
  setHidden(els.iconPause, true);
  setPlayLabel(t('nav.play'));
}

/** 播放按钮的名称随播放状态切换，title 保持“名称 (空格)”的格式 */
function setPlayLabel(label: string): void {
  els.btnPlay.setAttribute('aria-label', label);
  els.btnPlay.title = `${label} (${t('key.space')})`;
}

// 手动操作时停止自动播放
const manual = (fn: () => void) => () => {
  stopAutoplay();
  fn();
};

$('btn-first').addEventListener(
  'click',
  manual(() => goTo(0)),
);
$('btn-back10').addEventListener(
  'click',
  manual(() => step(-10)),
);
$('btn-prev').addEventListener(
  'click',
  manual(() => step(-1)),
);
$('btn-next').addEventListener(
  'click',
  manual(() => step(1)),
);
$('btn-fwd10').addEventListener(
  'click',
  manual(() => step(10)),
);
$('btn-last').addEventListener(
  'click',
  manual(() => goTo(Infinity)),
);
els.btnPlay.addEventListener('click', toggleAutoplay);
els.btnMainline.addEventListener('click', backToMain);
els.slider.addEventListener(
  'input',
  manual(() => goTo(parseInt(els.slider.value, 10))),
);

for (const [el, key] of [
  [els.optNumbers, 'showNumbers'],
  [els.optCoords, 'showCoords'],
  [els.optTerritory, 'showTerritory'],
  [els.optVariations, 'showVariations'],
] as const) {
  el.addEventListener('change', () => {
    state[key] = el.checked;
    // 关闭变化图时回到主线，避免停留在看不见入口的分支里
    if (key === 'showVariations' && !el.checked && Object.keys(state.choices).length) {
      backToMain();
    } else {
      render();
      persist();
    }
    saveOptions();
  });
}

document.addEventListener('keydown', (e) => {
  if (
    e.target instanceof HTMLInputElement &&
    e.target.type !== 'range' &&
    e.target.type !== 'checkbox'
  )
    return;
  const actions: Record<string, () => void> = {
    ArrowLeft: () => step(-1),
    ArrowUp: () => step(-1),
    ArrowRight: () => step(1),
    ArrowDown: () => step(1),
    PageUp: () => step(-10),
    PageDown: () => step(10),
    Home: () => goTo(0),
    End: () => goTo(Infinity),
  };
  if (e.key === ' ') {
    e.preventDefault();
    toggleAutoplay();
    return;
  }
  const action = actions[e.key];
  if (!action) return;
  e.preventDefault();
  stopAutoplay();
  action();
});

// 棋盘上滚轮切换手顺
let wheelAccum = 0;
els.board.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    wheelAccum += e.deltaY;
    if (Math.abs(wheelAccum) < 40) return;
    stopAutoplay();
    step(wheelAccum > 0 ? 1 : -1);
    wheelAccum = 0;
  },
  { passive: false },
);

// ---------- 手数跳转 ----------

const lastMoveNumber = (game: Game) => game.positions[game.positions.length - 1].moveNumber;

/** 手数框显示当前手数，旁边是总手数；处于变化图时前面加“变化”标记 */
function renderCounter(game: Game, pos: Position): void {
  const total = lastMoveNumber(game);
  els.movePrefix.textContent = pos.inVariation ? t('nav.variationTag') : '';
  els.moveTotal.textContent = t('nav.totalSuffix', { total });
  els.moveInput.value = String(pos.moveNumber);
  // 输入框的 value 变化不会被读屏播报，由隐藏的 live 区域播报当前手数
  els.moveStatus.textContent = t(pos.inVariation ? 'nav.statusVariation' : 'nav.status', {
    n: pos.moveNumber,
    total,
  });
  // 宽度随最大手数的位数变化，三位数的棋谱不会显得空，四位数也放得下
  els.moveInput.style.width = `${String(total).length + 2}ch`;
}

/** 跳到当前路径上第 n 手之后的局面；超过总手数时停在最后一手 */
function jumpToMove(n: number): void {
  const game = state.game;
  if (!game) return;
  const found = game.positions.findIndex((p) => p.moveNumber >= n);
  goTo(found < 0 ? game.positions.length - 1 : found);
}

/** 解析手数框里的文字，只接受非负整数；空白和非数字返回 null */
function parseMoveInput(text: string): number | null {
  const s = text.trim();
  return /^\d{1,6}$/.test(s) ? parseInt(s, 10) : null;
}

/** 手数框恢复为当前局面的手数 */
function resetCounter(): void {
  if (state.game) renderCounter(state.game, state.game.positions[state.index]);
}

function commitMoveInput(): void {
  const n = parseMoveInput(els.moveInput.value);
  stopAutoplay();
  // 输入无效时恢复为当前手数，有效时跳转（goTo 会重绘并写回规范化后的数字）
  if (n === null) resetCounter();
  else jumpToMove(n);
}

els.moveInput.addEventListener('keydown', (e) => {
  // 输入框内的方向键、Home/End 用于编辑文字；Enter 跳转，Esc 放弃输入
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    commitMoveInput();
    els.moveInput.select();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    resetCounter();
    els.moveInput.blur();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    // 在手数框里用上下键逐手微调，与数字输入框的习惯一致
    e.preventDefault();
    stopAutoplay();
    step(e.key === 'ArrowUp' ? 1 : -1);
  }
});
// 只放行数字，输入时就过滤掉其他字符
els.moveInput.addEventListener('input', () => {
  const digits = els.moveInput.value.replace(/\D/g, '').slice(0, 6);
  if (digits !== els.moveInput.value) els.moveInput.value = digits;
});
// 聚焦时暂停自动播放，否则每次重绘都会覆盖正在输入的数字
els.moveInput.addEventListener('focus', () => {
  stopAutoplay();
  els.moveInput.select();
});
els.moveInput.addEventListener('blur', () => {
  // 失焦时按输入跳转，没改动就什么也不做
  if (!state.game) return;
  const pos = state.game.positions[state.index];
  if (els.moveInput.value !== String(pos.moveNumber)) commitMoveInput();
});

// ---------- 渲染 ----------

function render(): void {
  const game = state.game;
  if (!game) return;
  const pos = game.positions[state.index];
  els.slider.value = String(state.index);
  renderCounter(game, pos);
  const estimate = Analysis.estimateAt(game, state.index);
  renderBoard(game, pos, state.showTerritory ? estimate : null);
  renderPlayers(game, pos);
  renderEstimate(estimate);
  renderVariations(game, pos);
  renderComment(game, pos);
}

/** 最多保留两位小数并去掉多余的 0，如 3.75、1.25、6.5、7 */
const formatNumber = (v: number) => String(Math.round(v * 100) / 100);

/** 内部统一用目；中国规则按 1 子 = 2 目换算成子显示 */
const formatMargin = (points: number, chinese: boolean) => {
  const v = chinese ? points / 2 : points;
  return tn(chinese ? 'unit.stones' : 'unit.points', v, { n: formatNumber(v) });
};

const colorName = (color: Color) => t(color === BLACK ? 'color.black' : 'color.white');

function renderEstimate(est: Estimate | null): void {
  if (!est) {
    els.leadText.textContent = t('estimate.unavailable');
    els.leadBar.hidden = true;
    els.leadDetail.textContent = '';
    return;
  }
  const abs = Math.abs(est.lead);
  els.leadText.textContent =
    abs < 0.05
      ? t('estimate.even')
      : t(est.lead > 0 ? 'estimate.leadBlack' : 'estimate.leadWhite', {
          margin: formatMargin(Math.round(abs * 2) / 2, est.chinese),
        });
  els.leadText.className = `lead-text${abs < 0.05 ? '' : est.lead > 0 ? ' black' : ' white'}`;

  // 进度条按双方各自的估算值占比，贴目不计入
  const total = est.black + est.white;
  const blackPct = total > 0 ? (est.black / total) * 100 : 50;
  els.leadBar.hidden = false;
  els.leadBlack.style.width = `${blackPct}%`;
  els.leadWhite.style.width = `${100 - blackPct}%`;

  const unit = t(est.method === 'territory' ? 'estimate.unitTerritory' : 'estimate.unitArea');
  const parts = [
    t('estimate.black', { n: est.black, unit }),
    t('estimate.white', { n: est.white, unit }),
  ];
  if (est.komi) parts.push(t('estimate.komi', { margin: formatMargin(est.komi, est.chinese) }));
  els.leadDetail.textContent = t('estimate.detail', { parts: parts.join(' · ') });
}

type SvgAttrs = Record<string, string | number>;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: SvgAttrs,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(el);
  return el;
}

function starPoints(w: number, h: number): Vertex[] {
  if (w !== h) return [];
  const table: Record<number, number[]> = { 19: [3, 9, 15], 13: [3, 6, 9], 9: [2, 4, 6] };
  const s = table[w];
  if (!s) return [];
  const points: Vertex[] = [];
  for (const x of s) for (const y of s) points.push([x, y]);
  return w === 9 ? points.filter(([x, y]) => (x === 4) === (y === 4)) : points;
}

function renderBoard(game: Game, pos: Position, estimate: Estimate | null): void {
  const { w, h } = game.size;
  const cell = 40;
  const margin = state.showCoords ? cell * 1.25 : cell * 0.75;
  const width = (w - 1) * cell + margin * 2;
  const height = (h - 1) * cell + margin * 2;
  const X = (x: number) => margin + x * cell;
  const Y = (y: number) => margin + y * cell;
  const r = cell * 0.48;

  const root = els.board;
  root.textContent = '';
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const defs = svg('defs', {}, root);
  const gradB = svg('radialGradient', { id: 'grad-black', cx: '35%', cy: '30%', r: '70%' }, defs);
  svg('stop', { class: 'stop-black-hi', offset: '0%' }, gradB);
  svg('stop', { class: 'stop-black-lo', offset: '100%' }, gradB);
  const gradW = svg('radialGradient', { id: 'grad-white', cx: '35%', cy: '30%', r: '75%' }, defs);
  svg('stop', { class: 'stop-white-hi', offset: '0%' }, gradW);
  svg('stop', { class: 'stop-white-lo', offset: '100%' }, gradW);

  svg('rect', { class: 'wood', x: 0, y: 0, width, height, rx: 6 }, root);

  const grid = svg('g', { class: 'grid' }, root);
  for (let x = 0; x < w; x++) svg('line', { x1: X(x), y1: Y(0), x2: X(x), y2: Y(h - 1) }, grid);
  for (let y = 0; y < h; y++) svg('line', { x1: X(0), y1: Y(y), x2: X(w - 1), y2: Y(y) }, grid);
  svg(
    'rect',
    { class: 'border', x: X(0), y: Y(0), width: (w - 1) * cell, height: (h - 1) * cell },
    grid,
  );
  for (const [x, y] of starPoints(w, h))
    svg('circle', { class: 'star', cx: X(x), cy: Y(y), r: cell * 0.09 }, grid);

  if (state.showCoords) {
    const coords = svg('g', { class: 'coords' }, root);
    const off = margin - cell * 0.6;
    for (let x = 0; x < w; x++) {
      const label = COORD_LETTERS[x] || String(x + 1);
      svg('text', { x: X(x), y: off }, coords).textContent = label;
      svg('text', { x: X(x), y: height - off }, coords).textContent = label;
    }
    for (let y = 0; y < h; y++) {
      const label = String(h - y);
      svg('text', { x: off, y: Y(y) }, coords).textContent = label;
      svg('text', { x: width - off, y: Y(y) }, coords).textContent = label;
    }
  }

  const board = pos.board;
  const last = pos.move ? pos.move.point : null;
  const markerAt = new Map<number, Marker>();
  for (const m of pos.markers) markerAt.set(m.y * w + m.x, m);

  if (estimate) {
    const territory = svg('g', { class: 'territory' }, root);
    const half = cell * 0.17;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const owner = estimate.owner[y][x];
        if (owner === 0 || board.get([x, y]) !== EMPTY) continue;
        svg(
          'rect',
          {
            class: owner > 0 ? 'terr-black' : 'terr-white',
            x: X(x) - half,
            y: Y(y) - half,
            width: half * 2,
            height: half * 2,
          },
          territory,
        );
      }
    }
  }

  const stones = svg('g', {}, root);
  const marks = svg('g', {}, root);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = board.get([x, y]);
      const key = y * w + x;
      const marker = markerAt.get(key);
      if (color !== EMPTY) {
        const isBlack = color === BLACK;
        svg('circle', { class: 'shadow', cx: X(x) + 1.5, cy: Y(y) + 2, r }, stones);
        svg(
          'circle',
          { class: isBlack ? 'stone-black' : 'stone-white', cx: X(x), cy: Y(y), r },
          stones,
        );
        const ink = isBlack ? 'ink-on-black' : 'ink-on-white';
        const num = pos.moveNumbers[key];
        const isLast = !!last && last[0] === x && last[1] === y;
        if (marker) {
          drawMarker(marks, marker, X(x), Y(y), cell, ink);
        } else if (state.showNumbers && num > 0) {
          svg(
            'text',
            {
              class: `num ${ink}${isLast ? ' last' : ''}`,
              x: X(x),
              y: Y(y),
              'font-size': num >= 100 ? cell * 0.38 : cell * 0.45,
            },
            marks,
          ).textContent = String(num);
        } else if (isLast) {
          svg('circle', { class: `last-mark ${ink}`, cx: X(x), cy: Y(y), r: cell * 0.2 }, marks);
        }
      } else if (marker) {
        if (marker.kind === 'label') {
          // 空点上的字母标签需要底色遮住网格线
          svg('circle', { class: 'label-bg', cx: X(x), cy: Y(y), r: cell * 0.36 }, marks);
        }
        drawMarker(marks, marker, X(x), Y(y), cell, 'ink-on-board');
      }
    }
  }
  // 分叉点上各分支的下一手，以半透明棋子加字母标出，点击进入对应分支
  if (state.showVariations && pos.branches.length) {
    const labels = new Map<number, { x: number; y: number; ks: number[]; color: Color }>();
    pos.branches.forEach((b, k) => {
      if (!b.move || !b.move.point) return;
      const [x, y] = b.move.point;
      const key = y * w + x;
      if (board.get([x, y]) !== EMPTY || markerAt.has(key)) return;
      const entry = labels.get(key) || { x, y, ks: [], color: b.move.color };
      entry.ks.push(k);
      labels.set(key, entry);
    });
    for (const { x, y, ks, color } of labels.values()) {
      const text = ks.map(branchLetter).join('');
      const isBlack = color === BLACK;
      const g = svg('g', { class: `var-mark${ks.includes(pos.choice) ? ' current' : ''}` }, marks);
      svg('title', {}, g).textContent = t('var.label', { label: text });
      svg('circle', { class: isBlack ? 'ghost-black' : 'ghost-white', cx: X(x), cy: Y(y), r }, g);
      svg(
        'text',
        {
          class: isBlack ? 'ink-on-black' : 'ink-on-white',
          x: X(x),
          y: Y(y),
          'font-size': text.length > 1 ? cell * 0.32 : cell * 0.42,
        },
        g,
      ).textContent = text;
      g.addEventListener('click', () => selectBranch(ks[0]));
    }
  }
  root.setAttribute(
    'aria-label',
    pos.move
      ? t('board.ariaMoveWith', { n: pos.moveNumber, move: describeMove(pos.move, h) })
      : t('board.ariaMove', { n: pos.moveNumber }),
  );
}

function drawMarker(
  parent: Element,
  m: Marker,
  cx: number,
  cy: number,
  cell: number,
  ink: string,
): void {
  const s = cell * 0.26;
  const cls = `mark ${ink}`;
  switch (m.kind) {
    case 'triangle':
      svg(
        'polygon',
        {
          class: cls,
          points: `${cx},${cy - s * 1.15} ${cx - s},${cy + s * 0.6} ${cx + s},${cy + s * 0.6}`,
        },
        parent,
      );
      break;
    case 'square':
      svg(
        'rect',
        { class: cls, x: cx - s * 0.85, y: cy - s * 0.85, width: s * 1.7, height: s * 1.7 },
        parent,
      );
      break;
    case 'circle':
      svg('circle', { class: cls, cx, cy, r: s }, parent);
      break;
    case 'cross':
      svg(
        'path',
        {
          class: cls,
          d: `M${cx - s} ${cy - s}L${cx + s} ${cy + s}M${cx + s} ${cy - s}L${cx - s} ${cy + s}`,
        },
        parent,
      );
      break;
    case 'label':
      svg(
        'text',
        { class: `num ${ink}`, x: cx, y: cy, 'font-size': cell * 0.5 },
        parent,
      ).textContent = m.text ?? '';
      break;
  }
}

function coordName(point: Vertex, h: number): string {
  return `${COORD_LETTERS[point[0]] || point[0] + 1}${h - point[1]}`;
}

/** 一手棋的文字描述，如“黑 Q16”“白停一手” */
function describeMove(move: Move | null, h: number): string {
  if (!move) return '';
  const who = colorName(move.color);
  return move.point
    ? t('move.play', { who, coord: coordName(move.point, h) })
    : t('move.pass', { who });
}

const branchLetter = (k: number) => (k < 26 ? String.fromCharCode(65 + k) : String(k + 1));

function describeBranch(move: Move | null, h: number): string {
  return move ? describeMove(move, h) : t('var.noMove');
}

function renderVariations(game: Game, pos: Position): void {
  const show = state.showVariations && (pos.branches.length > 0 || pos.inVariation);
  els.varSection.hidden = !show;
  if (!show) return;
  els.varStatus.hidden = !pos.inVariation;
  els.varHint.textContent = pos.branches.length ? t('var.hint', { n: pos.branches.length }) : '';
  els.varList.textContent = '';
  pos.branches.forEach((b, k) => {
    const current = k === pos.choice;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `var-item${current ? ' current' : ''}`;
    if (current) btn.setAttribute('aria-current', 'true');

    const tag = document.createElement('span');
    tag.className = 'var-tag';
    tag.textContent = branchLetter(k);
    const move = document.createElement('span');
    move.className = 'var-move';
    move.textContent = [
      describeBranch(b.move, game.size.h),
      k === 0 ? t('var.main') : '',
      current ? t('var.current') : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const comment = document.createElement('span');
    comment.className = 'var-comment';
    comment.textContent = b.comment;

    btn.title = b.comment || move.textContent;
    btn.append(tag, move, comment);
    btn.addEventListener('click', () => selectBranch(k));
    const li = document.createElement('li');
    li.appendChild(btn);
    els.varList.appendChild(li);
  });
}

function renderPlayers(game: Game, pos: Position): void {
  const info = game.info;
  const next = nextColor(game, pos);
  setPlayer(
    'black',
    info.blackName || t('player.black'),
    info.blackRank,
    pos.captures.black,
    pos.times.black,
    next === BLACK,
  );
  setPlayer(
    'white',
    info.whiteName || t('player.white'),
    info.whiteRank,
    pos.captures.white,
    pos.times.white,
    next === WHITE,
  );
}

function nextColor(game: Game, pos: Position): Color {
  if (pos.move) return pos.move.color === BLACK ? WHITE : BLACK;
  const pl = pos.node.data.PL;
  if (pl && pl[0]) return pl[0].toUpperCase() === 'W' ? WHITE : BLACK;
  return parseInt(game.info.handicap, 10) >= 2 ? WHITE : BLACK;
}

function setPlayer(
  side: Side,
  name: string,
  rank: string,
  caps: number,
  time: number | undefined,
  active: boolean,
): void {
  $(`${side}-name`).textContent = name;
  $(`${side}-rank`).textContent = rank || '';
  $(`${side}-caps`).textContent = t('player.captures', { n: caps });
  $(`${side}-time`).textContent =
    time === undefined ? '' : t('player.timeLeft', { time: formatDuration(time) });
  $(`player-${side}`).classList.toggle('active', active);
}

function renderComment(game: Game, pos: Position): void {
  els.comment.textContent = '';
  const head = document.createElement('div');
  head.className = 'comment-head';
  head.textContent = pos.move
    ? t('comment.move', { n: pos.moveNumber, move: describeMove(pos.move, game.size.h) })
    : t('comment.start');
  els.comment.appendChild(head);
  const body = document.createElement('div');
  body.className = 'comment-body';
  body.textContent = pos.comments.join('\n\n');
  els.comment.appendChild(body);
}

// ---------- 对局信息 ----------

function renderInfo(info: GameInfo, game: Game): void {
  const rows: [string, string][] = [];
  const add = (label: string, value: string) => {
    if (value) rows.push([label, value]);
  };
  add(t('info.game'), info.gameName);
  add(t('info.event'), [info.event, info.round].filter(Boolean).join(' '));
  add(t('info.date'), info.date);
  add(t('info.place'), info.place);
  const view = Compat.interpret(info);
  add(t('info.result'), formatResult(view.result, view.chinese));
  add(t('info.rules'), formatRules(info.rules));
  add(t('info.komi'), view.komi ? formatMargin(view.komi.points, view.chinese) : info.komi);
  const handicap = parseInt(info.handicap, 10);
  add(t('info.handicap'), handicap >= 2 ? tn('info.handicapValue', handicap) : '');
  add(t('info.time'), formatTimeControl(info));
  add(
    t('info.board'),
    game.size.w === game.size.h
      ? t('info.boardSquare', { n: game.size.w })
      : `${game.size.w}×${game.size.h}`,
  );
  add(t('info.moves'), t('info.movesValue', { n: game.mainMoveCount }));
  if (game.branchPoints) {
    add(
      t('info.variations'),
      t('info.variationsValue', { points: game.branchPoints, count: game.variationCount }),
    );
  }
  add(t('info.source'), info.source);
  add(t('info.annotator'), info.annotator);
  add(t('info.summary'), info.gameComment);

  els.info.textContent = '';
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    els.info.append(dt, dd);
  }
}

const RESULT_KINDS: Readonly<Record<string, string>> = {
  R: 'result.resign',
  RESIGN: 'result.resign',
  T: 'result.time',
  TIME: 'result.time',
  O: 'result.disconnect',
  F: 'result.forfeit',
  FORFEIT: 'result.forfeit',
};

/** re 为 Compat 归一后的结果串，比分以目为单位；中国规则换成子显示 */
function formatResult(re: string, chinese: boolean): string {
  if (!re) return '';
  const s = re.trim();
  const upper = s.toUpperCase();
  if (upper === '0' || upper === 'DRAW' || upper === 'JIGO') return t('result.draw');
  if (upper === 'VOID') return t('result.void');
  if (upper === '?') return t('result.unknown');
  const m = /^([BW])\+(.*)$/i.exec(s);
  if (!m) return s;
  const who = colorName(m[1].toUpperCase() === 'B' ? BLACK : WHITE);
  const detail = m[2].trim();
  if (!detail) return t('result.win', { who });
  const kind = RESULT_KINDS[detail.toUpperCase()];
  if (kind) return t(kind, { who });
  if (chinese && /^\d+(\.\d+)?$/.test(detail)) {
    return t('result.winBy', { who, detail: formatMargin(parseFloat(detail), true) });
  }
  return t('result.winBy', { who, detail });
}

const RULE_KEYS: Readonly<Record<string, string>> = {
  chinese: 'rule.chinese',
  japanese: 'rule.japanese',
  korean: 'rule.korean',
  aga: 'rule.aga',
  nz: 'rule.nz',
  goe: 'rule.goe',
};

function formatRules(ru: string): string {
  if (!ru) return '';
  const key = RULE_KEYS[ru.trim().toLowerCase()];
  return key ? t(key) : ru;
}

function formatTimeControl(info: GameInfo): string {
  const parts: string[] = [];
  const tm = parseFloat(info.timeLimit);
  if (Number.isFinite(tm) && tm > 0) parts.push(t('time.main', { time: formatDuration(tm) }));
  const periods = parseInt(info.byoPeriods, 10);
  const byo = parseInt(info.byoTime, 10);
  if (periods > 0 && byo > 0) parts.push(t('time.byoyomi', { seconds: byo, periods }));
  else if (info.overtime && info.overtime !== '-1') parts.push(info.overtime);
  return parts.join(t('list.sep'));
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return t(m ? 'duration.hm' : 'duration.h', { h, m });
  if (m) return t(s ? 'duration.ms' : 'duration.m', { m, s });
  return t('duration.s', { s });
}

post({ type: 'ready' });
