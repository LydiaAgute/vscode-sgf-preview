/**
 * 沿一条路径回放棋局，生成每一手对应的局面快照。
 * 路径默认走主线（每个节点的第一个子节点），choices 指定在哪些节点改走其他分支。
 * 落子、提子、自杀手判定由 @sabaki/go-board 完成，顶点解析由 @sabaki/sgf 完成。
 */

import GoBoard, { type Vertex } from '@sabaki/go-board';
// 只引无依赖的 helper；主入口会带入 fs 和编码库，不能进浏览器端打包
import { parseVertex, parseCompressedVertices } from '@sabaki/sgf/src/helper';
import type { SgfData, SgfTree, TreeNode } from '../src/protocol';

// 与 GoBoard 的 sign 一致
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = -1;

export type Color = typeof BLACK | typeof WHITE;

/** 节点 id 到所选子节点下标；未列出的节点走第一个子节点 */
export type Choices = Record<number, number>;

export interface Move {
  color: Color;
  /** 停一手时为 null */
  point: Vertex | null;
  pass: boolean;
}

export type MarkerKind = 'triangle' | 'square' | 'circle' | 'cross' | 'label';

export interface Marker {
  x: number;
  y: number;
  kind: MarkerKind;
  /** 仅 label 有 */
  text?: string;
}

export interface Branch {
  move: Move | null;
  comment: string;
}

export interface Captures {
  black: number;
  white: number;
}

export interface Times {
  black: number | undefined;
  white: number | undefined;
}

export interface Position {
  moveNumber: number;
  move: Move | null;
  node: TreeNode;
  board: GoBoard;
  /** 每个点最后一次落子的手数，下标为 y * 宽 + x */
  moveNumbers: Int32Array;
  captures: Captures;
  times: Times;
  comments: string[];
  markers: Marker[];
  branches: Branch[];
  /** 本局面所在节点走的是第几个子节点 */
  choice: number;
  inVariation: boolean;
}

export interface GameInfo {
  blackName: string;
  whiteName: string;
  blackRank: string;
  whiteRank: string;
  blackTeam: string;
  whiteTeam: string;
  gameName: string;
  event: string;
  round: string;
  date: string;
  place: string;
  komi: string;
  handicap: string;
  rules: string;
  result: string;
  timeLimit: string;
  overtime: string;
  byoPeriods: string;
  byoTime: string;
  source: string;
  annotator: string;
  application: string;
  applications: string[];
  gameComment: string;
}

export interface Game {
  size: { w: number; h: number };
  positions: Position[];
  info: GameInfo;
  branchPoints: number;
  variationCount: number;
  mainMoveCount: number;
}

// 分支摘要向下查找注释的最大节点数
const COMMENT_SCAN_DEPTH = 8;

type NodeMap = Map<number, TreeNode>;

function first(data: SgfData, id: string): string | undefined {
  const v = data[id];
  return v && v.length ? v[0] : undefined;
}

function parseSize(value: string | undefined): { w: number; h: number } {
  if (!value) return { w: 19, h: 19 };
  const parts = value.split(':').map((s) => parseInt(s, 10));
  const w = parts[0] > 0 ? Math.min(parts[0], 52) : 19;
  const h = parts[1] > 0 ? Math.min(parts[1], 52) : w;
  return { w, h };
}

/** 'pd' -> [x, y]；空值、越界（含 FF[3] 的 tt 停一手）返回 null */
function toPoint(board: GoBoard, value: string | undefined): Vertex | null {
  if (!value) return null;
  const v = parseVertex(value);
  return board.has(v) ? v : null;
}

function toPoints(board: GoBoard, values: string[] | undefined): Vertex[] {
  const points: Vertex[] = [];
  for (const value of values || []) {
    for (const v of parseCompressedVertices(value)) if (board.has(v)) points.push(v);
  }
  return points;
}

function readMove(board: GoBoard, data: SgfData): Move | null {
  for (const [id, color] of [
    ['B', BLACK],
    ['W', WHITE],
  ] as const) {
    if (data[id] === undefined) continue;
    const point = toPoint(board, first(data, id));
    return { color, point, pass: point === null };
  }
  return null;
}

function readMarkers(board: GoBoard, data: SgfData): Marker[] {
  const markers: Marker[] = [];
  for (const [id, kind] of [
    ['TR', 'triangle'],
    ['SQ', 'square'],
    ['CR', 'circle'],
    ['MA', 'cross'],
  ] as const) {
    for (const [x, y] of toPoints(board, data[id])) markers.push({ x, y, kind });
  }
  for (const value of data.LB || []) {
    const idx = value.indexOf(':');
    if (idx < 0) continue;
    const p = toPoint(board, value.slice(0, idx));
    if (p) markers.push({ x: p[0], y: p[1], kind: 'label', text: value.slice(idx + 1) });
  }
  return markers;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function firstCommentFrom(byId: NodeMap, node: TreeNode): string {
  let n: TreeNode | undefined = node;
  for (let k = 0; n && k < COMMENT_SCAN_DEPTH; n = byId.get(n.children[0]), k++) {
    const c = first(n.data, 'C');
    if (c && c.trim()) return c.trim();
  }
  return '';
}

/** 节点有多个子节点时，列出每个分支的第一手和首条注释 */
function readBranches(byId: NodeMap, board: GoBoard, node: TreeNode): Branch[] {
  if (node.children.length < 2) return [];
  const branches: Branch[] = [];
  for (const id of node.children) {
    const child = byId.get(id);
    if (!child) continue;
    branches.push({ move: readMove(board, child.data), comment: firstCommentFrom(byId, child) });
  }
  return branches;
}

function readInfo(data: SgfData): GameInfo {
  const get = (id: string): string => {
    const v = first(data, id);
    return v === undefined ? '' : v.trim();
  };
  return {
    blackName: get('PB'),
    whiteName: get('PW'),
    blackRank: get('BR'),
    whiteRank: get('WR'),
    blackTeam: get('BT'),
    whiteTeam: get('WT'),
    gameName: get('GN'),
    event: get('EV'),
    round: get('RO'),
    date: get('DT'),
    place: get('PC'),
    komi: get('KM'),
    handicap: get('HA'),
    rules: get('RU'),
    result: get('RE'),
    timeLimit: get('TM'),
    overtime: get('OT'),
    // 野狐等平台的扩展属性：读秒次数、每次读秒秒数
    byoPeriods: get('TC'),
    byoTime: get('TT'),
    source: get('SO'),
    annotator: get('AN'),
    application: get('AP'),
    // 同一节点可有多个 AP 值，来源判定需要全部
    applications: (data.AP || []).map((v) => v.trim()),
    gameComment: get('GC'),
  };
}

/**
 * tree 为 {rootId, nodes}；choices 为 {节点 id: 子节点下标}，未列出的节点走第一个子节点。
 * positions[i] 对应路径上第 i 手之后的局面（positions[0] 为开局，含让子）。
 * 不含落子的节点（AB/AW/AE 设置、纯注释）并入前一个局面；前一个局面是分叉点时不合并，保证分叉点独占一个局面。
 */
export function build(tree: SgfTree, choices: Choices = {}): Game {
  const byId: NodeMap = new Map(tree.nodes.map((n) => [n.id, n]));
  const root = byId.get(tree.rootId);
  if (!root) throw new Error(`root node ${tree.rootId} not found`);
  const size = parseSize(first(root.data, 'SZ'));

  let branchPoints = 0;
  let variationCount = 0;
  for (const n of tree.nodes) {
    if (n.children.length > 1) {
      branchPoints++;
      variationCount += n.children.length - 1;
    }
  }
  let mainMoveCount = 0;
  for (let n: TreeNode | undefined = root; n; n = byId.get(n.children[0])) {
    if (n.data.B !== undefined || n.data.W !== undefined) mainMoveCount++;
  }

  let board = GoBoard.fromDimensions(size.w, size.h);
  // 每个点最后一次落子的手数，用于显示手数
  let moveNumbers = new Int32Array(size.w * size.h);
  const times: Times = { black: undefined, white: undefined };
  const positions: Position[] = [];
  let moveCount = 0;
  let inVariation = false;
  let pending: Position | null = null;

  for (let node: TreeNode | undefined = root; node;) {
    const data = node.data;

    board = board.clone();
    moveNumbers = moveNumbers.slice();
    for (const [x, y] of toPoints(board, data.AE)) {
      board.set([x, y], EMPTY);
      moveNumbers[y * size.w + x] = 0;
    }
    for (const v of toPoints(board, data.AB)) board.set(v, BLACK);
    for (const v of toPoints(board, data.AW)) board.set(v, WHITE);

    const move = readMove(board, data);
    if (move) {
      moveCount++;
      if (move.point) {
        board = board.makeMove(move.color, move.point);
        moveNumbers[move.point[1] * size.w + move.point[0]] = moveCount;
      }
    }
    const bl = parseNumber(first(data, 'BL'));
    const wl = parseNumber(first(data, 'WL'));
    if (bl !== undefined) times.black = bl;
    if (wl !== undefined) times.white = wl;

    const wanted = choices[node.id];
    const choice =
      Number.isInteger(wanted) && wanted > 0 && wanted < node.children.length ? wanted : 0;
    const comment = first(data, 'C');
    const snapshot: Position = {
      moveNumber: moveCount,
      move,
      node,
      board,
      moveNumbers,
      captures: { black: board.getCaptures(BLACK), white: board.getCaptures(WHITE) },
      times: { black: times.black, white: times.white },
      comments: comment ? [comment] : [],
      markers: readMarkers(board, data),
      branches: readBranches(byId, board, node),
      choice,
      inVariation,
    };

    const prev: Position | null = pending;
    if (!move && prev && prev.branches.length === 0) {
      snapshot.move = prev.move;
      snapshot.comments = prev.comments.concat(snapshot.comments);
      snapshot.markers = prev.markers.concat(snapshot.markers);
    } else if (prev) {
      positions.push(prev);
    }
    pending = snapshot;

    if (choice > 0) inVariation = true;
    node = byId.get(node.children[choice]);
  }
  if (pending) positions.push(pending);

  return {
    size,
    positions,
    info: readInfo(root.data),
    branchPoints,
    variationCount,
    mainMoveCount,
  };
}
