// Sabaki 库中 @sabaki/sgf 与 @sabaki/influence 没有自带类型声明，这里只声明本项目用到的接口。
// @sabaki/go-board 自带 .d.ts，直接使用。

declare module '@sabaki/sgf' {
  export interface NodeObject {
    id: number;
    parentId: number | null;
    data: Record<string, string[]>;
    children: NodeObject[];
  }

  export interface Token {
    type: string;
    value: string;
    pos: number;
    row: number;
    col: number;
  }

  export function parse(contents: string): NodeObject[];

  /** 按 CA 属性、UTF-8 校验、字符集探测判定编码后解析 */
  export function parseBuffer(buffer: Uint8Array): NodeObject[];

  /** 流式 tokenize */
  export function tokenizeIter(contents: string): IterableIterator<Token>;
}

declare module '@sabaki/sgf/src/helper' {
  import type { Vertex } from '@sabaki/go-board';

  /** 'pd' -> [15, 3]；无法解析时返回 [-1, -1] */
  export function parseVertex(input: string): Vertex;

  /** 展开 'aa:cc' 这类压缩点列表 */
  export function parseCompressedVertices(input: string): Vertex[];
}

declare module '@sabaki/influence' {
  import type { SignMap } from '@sabaki/go-board';

  interface MapOptions {
    discrete?: boolean;
    maxDistance?: number;
    minRadiance?: number;
  }

  const influence: {
    /** 每个点的归属：正数为黑，负数为白，0 为未定；discrete 时只取 -1、0、1 */
    map(data: SignMap, options?: MapOptions): number[][];
  };

  export = influence;
}
