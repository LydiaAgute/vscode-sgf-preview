import * as vscode from 'vscode';
import { tokenizeIter } from '@sabaki/sgf';

/**
 * SGF 语义 token 类型定义。
 * VS Code 内置类型：namespace, type, class, enum, interface, struct, typeParameter,
 * parameter, variable, property, enumMember, event, function, method, macro, keyword,
 * modifier, comment, string, number, regexp, operator, decorator
 */
const TOKEN_TYPES = [
  'keyword',
  'property',
  'string',
  'macro',
  'comment',
  'function',
  'operator',
] as const;
const TOKEN_MODIFIERS: string[] = [];

export const legend = new vscode.SemanticTokensLegend([...TOKEN_TYPES], TOKEN_MODIFIERS);

type TokenType = (typeof TOKEN_TYPES)[number];

/** 行棋相关属性：用 function 类型，与棋局信息类属性（property）区分 */
const MOVE_PROPERTIES = new Set(['B', 'W', 'AB', 'AW', 'AE', 'KO', 'MN']);

/** 按行拆分一个范围并推入 builder，使跨行 token 也能正确上色 */
function pushRange(
  builder: vscode.SemanticTokensBuilder,
  document: vscode.TextDocument,
  start: vscode.Position,
  end: vscode.Position,
  type: TokenType,
): void {
  if (start.line === end.line) {
    if (start.isBefore(end)) builder.push(new vscode.Range(start, end), type, []);
    return;
  }
  for (let line = start.line; line <= end.line; line++) {
    const lineStart = line === start.line ? start.character : 0;
    const lineEnd = line === end.line ? end.character : document.lineAt(line).text.length;
    if (lineEnd > lineStart) {
      builder.push(
        new vscode.Range(new vscode.Position(line, lineStart), new vscode.Position(line, lineEnd)),
        type,
        [],
      );
    }
  }
}

export class SgfSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.SemanticTokens | null> {
    if (token.isCancellationRequested) return null;

    const builder = new vscode.SemanticTokensBuilder(legend);
    const text = document.getText();

    try {
      for (const sgfToken of tokenizeIter(text)) {
        if (token.isCancellationRequested) return null;

        const tokenStart = document.positionAt(sgfToken.pos);
        const tokenEnd = document.positionAt(sgfToken.pos + sgfToken.value.length);

        switch (sgfToken.type) {
          case 'parenthesis':
            pushRange(builder, document, tokenStart, tokenEnd, 'macro');
            break;
          case 'semicolon':
            pushRange(builder, document, tokenStart, tokenEnd, 'keyword');
            break;
          case 'prop_ident': {
            // 行棋属性（B、W 等）与棋局信息类属性（RU、DT 等）分开着色
            const propName = sgfToken.value.replace(/[^A-Z]/g, '');
            const propType: TokenType = MOVE_PROPERTIES.has(propName) ? 'function' : 'property';
            pushRange(builder, document, tokenStart, tokenEnd, propType);
            break;
          }
          case 'c_value_type': {
            // token 格式固定为 '[...]'：方括号本身用 operator（跟随默认前景色），
            // 括号内的内容用 string
            const openEnd = document.positionAt(sgfToken.pos + 1);
            const closeStart = document.positionAt(sgfToken.pos + sgfToken.value.length - 1);
            pushRange(builder, document, tokenStart, openEnd, 'operator');
            pushRange(builder, document, openEnd, closeStart, 'string');
            pushRange(builder, document, closeStart, tokenEnd, 'operator');
            break;
          }
          case 'invalid':
            pushRange(builder, document, tokenStart, tokenEnd, 'comment');
            break;
          default:
            break; // _whitespace 等不高亮
        }
      }
    } catch (err) {
      // 解析失败时不提供高亮（可能是不完整的编辑中间状态）
      console.error('SGF tokenize error:', err);
      return null;
    }

    return builder.build();
  }
}
