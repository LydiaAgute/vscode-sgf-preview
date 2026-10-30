/**
 * 扩展端与 webview 共用的数据结构和消息协议。两端都从这里引用，保证收发的字段一致。
 */

/** SGF 属性表：属性名到取值列表 */
export type SgfData = Record<string, string[]>;

export interface TreeNode {
  id: number;
  parentId: number | null;
  data: SgfData;
  children: number[];
}

/** 展平后的棋谱树，避免嵌套过深时 postMessage 序列化栈溢出 */
export interface SgfTree {
  rootId: number;
  nodes: TreeNode[];
}

/** 显示选项，所有棋谱共用并跨会话保留 */
export interface DisplayOptions {
  showNumbers: boolean;
  showCoords: boolean;
  showTerritory: boolean;
  showVariations: boolean;
}

export const OPTION_KEYS = [
  'showNumbers',
  'showCoords',
  'showTerritory',
  'showVariations',
] as const satisfies readonly (keyof DisplayOptions)[];

/** 扩展端发给 webview 的消息 */
export type HostMessage =
  | { type: 'load'; tree: SgfTree; keepPosition: boolean; options: Partial<DisplayOptions> }
  | { type: 'error'; message: string }
  | { type: 'locale'; locale: string };

/** webview 发给扩展端的消息 */
export type WebviewMessage =
  { type: 'ready' } | { type: 'options'; options: Partial<DisplayOptions> };
