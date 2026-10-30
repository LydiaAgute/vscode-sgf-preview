import { parse, parseBuffer, type NodeObject } from '@sabaki/sgf';
import type { SgfTree, TreeNode } from './protocol';
// 单元测试在 VS Code 之外运行，文案模块不依赖 vscode
import * as messages from './messages';

/** 把 Sabaki 的嵌套节点树展平成 {rootId, nodes}，避免嵌套过深时序列化栈溢出 */
function toTree(roots: NodeObject[]): SgfTree {
  const root = roots[0];
  if (!root) throw new Error(messages.t('No game data found in the file'));
  const nodes: TreeNode[] = [];
  const stack: NodeObject[] = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    nodes.push({
      id: node.id,
      parentId: node.parentId,
      data: node.data,
      children: node.children.map((child) => child.id),
    });
    for (const child of node.children) stack.push(child);
  }
  return { rootId: root.id, nodes };
}

export const fromText = (text: string): SgfTree => toTree(parse(text));

// 字符编码由 Sabaki 依次按 CA 属性、UTF-8 校验、字符集探测判定
export const fromBytes = (bytes: Uint8Array): SgfTree => toTree(parseBuffer(Buffer.from(bytes)));
