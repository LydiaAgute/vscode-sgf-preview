import * as vscode from 'vscode';
import { tokenizeIter } from '@sabaki/sgf';
import * as messages from '../messages';

interface PropertyInfo {
  name: string;
  description: string;
  valueType: string;
}

/** 属性说明的双语数据（英文/中文） */
const PROPERTY_INFO: Record<string, { en: PropertyInfo; 'zh-cn': PropertyInfo }> = {
  // Move properties
  B: {
    en: { name: 'Black move', description: 'A move by Black.', valueType: 'move' },
    'zh-cn': { name: '黑棋落子', description: '黑方的一手棋。', valueType: 'move' },
  },
  W: {
    en: { name: 'White move', description: 'A move by White.', valueType: 'move' },
    'zh-cn': { name: '白棋落子', description: '白方的一手棋。', valueType: 'move' },
  },
  KO: {
    en: {
      name: 'Ko',
      description: 'Execute this move even if it would be illegal due to ko.',
      valueType: 'none',
    },
    'zh-cn': { name: '打劫', description: '即使违反打劫规则也执行该落子。', valueType: 'none' },
  },
  MN: {
    en: { name: 'Move number', description: 'Set the number of this move.', valueType: 'number' },
    'zh-cn': { name: '手数', description: '设置本手的手数。', valueType: 'number' },
  },

  // Setup properties
  AB: {
    en: {
      name: 'Add black',
      description: 'Add black stones at setup.',
      valueType: 'list of stone',
    },
    'zh-cn': { name: '添加黑子', description: '在摆放阶段添加黑子。', valueType: 'list of stone' },
  },
  AW: {
    en: {
      name: 'Add white',
      description: 'Add white stones at setup.',
      valueType: 'list of stone',
    },
    'zh-cn': { name: '添加白子', description: '在摆放阶段添加白子。', valueType: 'list of stone' },
  },
  AE: {
    en: {
      name: 'Add empty',
      description: 'Clear these points at setup.',
      valueType: 'list of point',
    },
    'zh-cn': {
      name: '清空点位',
      description: '在摆放阶段清空这些点位。',
      valueType: 'list of point',
    },
  },
  PL: {
    en: { name: 'Player to play', description: 'Whose turn it is to play.', valueType: 'color' },
    'zh-cn': { name: '轮到谁下', description: '指定由谁下子。', valueType: 'color' },
  },

  // Node annotation
  C: {
    en: { name: 'Comment', description: 'Comment text for this node.', valueType: 'text' },
    'zh-cn': { name: '注释', description: '本节点的注释文本。', valueType: 'text' },
  },
  N: {
    en: { name: 'Node name', description: 'Name of this node.', valueType: 'simpletext' },
    'zh-cn': { name: '节点名称', description: '本节点的名称。', valueType: 'simpletext' },
  },
  GB: {
    en: { name: 'Good for black', description: 'Position is good for Black.', valueType: 'double' },
    'zh-cn': { name: '黑优', description: '局面对黑方有利。', valueType: 'double' },
  },
  GW: {
    en: { name: 'Good for white', description: 'Position is good for White.', valueType: 'double' },
    'zh-cn': { name: '白优', description: '局面对白方有利。', valueType: 'double' },
  },
  DM: {
    en: { name: 'Even position', description: 'Position is even.', valueType: 'double' },
    'zh-cn': { name: '局面均衡', description: '局面均衡。', valueType: 'double' },
  },
  UC: {
    en: { name: 'Unclear position', description: 'Position is unclear.', valueType: 'double' },
    'zh-cn': { name: '局面不明', description: '局面不明朗。', valueType: 'double' },
  },
  TE: {
    en: { name: 'Tesuji', description: 'This move is a tesuji (good move).', valueType: 'double' },
    'zh-cn': { name: '手筋', description: '本手是手筋（妙手）。', valueType: 'double' },
  },
  BM: {
    en: { name: 'Bad move', description: 'This move is bad.', valueType: 'double' },
    'zh-cn': { name: '恶手', description: '本手是恶手。', valueType: 'double' },
  },
  DO: {
    en: { name: 'Doubtful', description: 'This move is doubtful.', valueType: 'none' },
    'zh-cn': { name: '疑问手', description: '本手有疑问。', valueType: 'none' },
  },
  IT: {
    en: { name: 'Interesting', description: 'This move is interesting.', valueType: 'none' },
    'zh-cn': { name: '有趣', description: '本手很有趣。', valueType: 'none' },
  },

  // Move annotation
  HO: {
    en: { name: 'Hotspot', description: 'This move deserves attention.', valueType: 'double' },
    'zh-cn': { name: '焦点', description: '本手值得注意。', valueType: 'double' },
  },
  V: {
    en: { name: 'Value', description: 'Numeric value of this node.', valueType: 'real' },
    'zh-cn': { name: '数值', description: '本节点的数值。', valueType: 'real' },
  },

  // Markup properties
  LB: {
    en: {
      name: 'Label',
      description: 'Label points with text.',
      valueType: 'list of composed point:simpletext',
    },
    'zh-cn': {
      name: '标签',
      description: '用文本标记点位。',
      valueType: 'list of composed point:simpletext',
    },
  },
  MA: {
    en: { name: 'Mark', description: 'Mark points with X.', valueType: 'list of point' },
    'zh-cn': { name: 'X 标记', description: '用 X 标记点位。', valueType: 'list of point' },
  },
  TR: {
    en: { name: 'Triangle', description: 'Mark points with triangle.', valueType: 'list of point' },
    'zh-cn': { name: '三角形', description: '用三角形标记点位。', valueType: 'list of point' },
  },
  CR: {
    en: { name: 'Circle', description: 'Mark points with circle.', valueType: 'list of point' },
    'zh-cn': { name: '圆圈', description: '用圆圈标记点位。', valueType: 'list of point' },
  },
  SQ: {
    en: { name: 'Square', description: 'Mark points with square.', valueType: 'list of point' },
    'zh-cn': { name: '方框', description: '用方框标记点位。', valueType: 'list of point' },
  },
  SL: {
    en: { name: 'Selected', description: 'Mark selected points.', valueType: 'list of point' },
    'zh-cn': { name: '选中', description: '标记选中的点位。', valueType: 'list of point' },
  },
  AR: {
    en: {
      name: 'Arrow',
      description: 'Draw arrows between points.',
      valueType: 'list of composed point:point',
    },
    'zh-cn': {
      name: '箭头',
      description: '在点位间绘制箭头。',
      valueType: 'list of composed point:point',
    },
  },
  LN: {
    en: {
      name: 'Line',
      description: 'Draw lines between points.',
      valueType: 'list of composed point:point',
    },
    'zh-cn': {
      name: '线条',
      description: '在点位间绘制线条。',
      valueType: 'list of composed point:point',
    },
  },
  DD: {
    en: { name: 'Dim', description: 'Dim these points.', valueType: 'elist of point' },
    'zh-cn': { name: '淡化', description: '淡化这些点位。', valueType: 'elist of point' },
  },

  // Root properties
  FF: {
    en: {
      name: 'File format',
      description: 'SGF file format version (1-4).',
      valueType: 'number (range: 1-4)',
    },
    'zh-cn': {
      name: '文件格式',
      description: 'SGF 文件格式版本（1-4）。',
      valueType: 'number (range: 1-4)',
    },
  },
  GM: {
    en: { name: 'Game type', description: 'Type of game (1 = Go).', valueType: 'number (1 = Go)' },
    'zh-cn': {
      name: '游戏类型',
      description: '游戏类型（1 = 围棋）。',
      valueType: 'number (1 = Go)',
    },
  },
  SZ: {
    en: { name: 'Size', description: 'Board size (e.g., 19).', valueType: 'number' },
    'zh-cn': { name: '棋盘大小', description: '棋盘大小（如 19）。', valueType: 'number' },
  },
  CA: {
    en: {
      name: 'Charset',
      description: 'Character encoding (e.g., UTF-8).',
      valueType: 'simpletext',
    },
    'zh-cn': { name: '字符编码', description: '字符编码（如 UTF-8）。', valueType: 'simpletext' },
  },
  ST: {
    en: {
      name: 'Variation style',
      description: 'How variations are shown (0-3).',
      valueType: 'number (range: 0-3)',
    },
    'zh-cn': {
      name: '变化图样式',
      description: '变化图的显示方式（0-3）。',
      valueType: 'number (range: 0-3)',
    },
  },
  AP: {
    en: {
      name: 'Application',
      description: 'Program that created this file.',
      valueType: 'composed simpletext:simpletext',
    },
    'zh-cn': {
      name: '应用程序',
      description: '创建本文件的程序。',
      valueType: 'composed simpletext:simpletext',
    },
  },

  // Game info
  PB: {
    en: { name: 'Player Black', description: 'Name of the Black player.', valueType: 'simpletext' },
    'zh-cn': { name: '黑方棋手', description: '黑方棋手姓名。', valueType: 'simpletext' },
  },
  PW: {
    en: { name: 'Player White', description: 'Name of the White player.', valueType: 'simpletext' },
    'zh-cn': { name: '白方棋手', description: '白方棋手姓名。', valueType: 'simpletext' },
  },
  BR: {
    en: { name: 'Black rank', description: 'Rank of the Black player.', valueType: 'simpletext' },
    'zh-cn': { name: '黑方段位', description: '黑方棋手段位。', valueType: 'simpletext' },
  },
  WR: {
    en: { name: 'White rank', description: 'Rank of the White player.', valueType: 'simpletext' },
    'zh-cn': { name: '白方段位', description: '白方棋手段位。', valueType: 'simpletext' },
  },
  BT: {
    en: {
      name: 'Black team',
      description: 'Team name of the Black player.',
      valueType: 'simpletext',
    },
    'zh-cn': { name: '黑方队伍', description: '黑方队伍名称。', valueType: 'simpletext' },
  },
  WT: {
    en: {
      name: 'White team',
      description: 'Team name of the White player.',
      valueType: 'simpletext',
    },
    'zh-cn': { name: '白方队伍', description: '白方队伍名称。', valueType: 'simpletext' },
  },
  DT: {
    en: { name: 'Date', description: 'Date of the game.', valueType: 'simpletext' },
    'zh-cn': { name: '日期', description: '对局日期。', valueType: 'simpletext' },
  },
  EV: {
    en: { name: 'Event', description: 'Event or tournament name.', valueType: 'simpletext' },
    'zh-cn': { name: '赛事', description: '赛事或比赛名称。', valueType: 'simpletext' },
  },
  RO: {
    en: { name: 'Round', description: 'Round information.', valueType: 'simpletext' },
    'zh-cn': { name: '轮次', description: '轮次信息。', valueType: 'simpletext' },
  },
  PC: {
    en: { name: 'Place', description: 'Place where the game was played.', valueType: 'simpletext' },
    'zh-cn': { name: '地点', description: '对局地点。', valueType: 'simpletext' },
  },
  GN: {
    en: { name: 'Game name', description: 'Name of the game.', valueType: 'simpletext' },
    'zh-cn': { name: '对局名称', description: '对局的名称。', valueType: 'simpletext' },
  },
  AN: {
    en: {
      name: 'Annotator',
      description: 'Person who wrote the comments.',
      valueType: 'simpletext',
    },
    'zh-cn': { name: '注释者', description: '撰写注释的人。', valueType: 'simpletext' },
  },
  CP: {
    en: { name: 'Copyright', description: 'Copyright information.', valueType: 'simpletext' },
    'zh-cn': { name: '版权', description: '版权信息。', valueType: 'simpletext' },
  },
  US: {
    en: {
      name: 'User',
      description: 'User or author of the game record.',
      valueType: 'simpletext',
    },
    'zh-cn': { name: '用户', description: '棋谱的用户或作者。', valueType: 'simpletext' },
  },
  SO: {
    en: { name: 'Source', description: 'Source of the game record.', valueType: 'simpletext' },
    'zh-cn': { name: '来源', description: '棋谱来源。', valueType: 'simpletext' },
  },
  GC: {
    en: { name: 'Game comment', description: 'General comment about the game.', valueType: 'text' },
    'zh-cn': { name: '对局说明', description: '关于对局的总体说明。', valueType: 'text' },
  },
  ON: {
    en: { name: 'Opening', description: 'Opening name or moves.', valueType: 'simpletext' },
    'zh-cn': { name: '开局', description: '开局名称或招法。', valueType: 'simpletext' },
  },
  OT: {
    en: { name: 'Overtime', description: 'Overtime (byoyomi) method.', valueType: 'simpletext' },
    'zh-cn': { name: '读秒方式', description: '读秒（byoyomi）方式。', valueType: 'simpletext' },
  },
  RE: {
    en: {
      name: 'Result',
      description: 'Result of the game (e.g., W+2.5, B+R).',
      valueType: 'simpletext',
    },
    'zh-cn': { name: '结果', description: '对局结果（如 W+2.5, B+R）。', valueType: 'simpletext' },
  },
  RU: {
    en: {
      name: 'Rules',
      description: 'Ruleset used (e.g., Japanese, Chinese).',
      valueType: 'simpletext',
    },
    'zh-cn': {
      name: '规则',
      description: '使用的规则（如 Japanese, Chinese）。',
      valueType: 'simpletext',
    },
  },
  KM: {
    en: { name: 'Komi', description: 'Komi (compensation points for White).', valueType: 'real' },
    'zh-cn': { name: '贴目', description: '贴目（白方的补偿点数）。', valueType: 'real' },
  },
  HA: {
    en: { name: 'Handicap', description: 'Number of handicap stones.', valueType: 'number' },
    'zh-cn': { name: '让子', description: '让子数。', valueType: 'number' },
  },
  TM: {
    en: { name: 'Time limit', description: 'Time limit in seconds.', valueType: 'real' },
    'zh-cn': { name: '时限', description: '时限（秒）。', valueType: 'real' },
  },

  // Timing properties
  BL: {
    en: {
      name: 'Black time left',
      description: 'Time left for Black in seconds.',
      valueType: 'real',
    },
    'zh-cn': { name: '黑方剩余时间', description: '黑方剩余时间（秒）。', valueType: 'real' },
  },
  WL: {
    en: {
      name: 'White time left',
      description: 'Time left for White in seconds.',
      valueType: 'real',
    },
    'zh-cn': { name: '白方剩余时间', description: '白方剩余时间（秒）。', valueType: 'real' },
  },
  OB: {
    en: {
      name: 'Black overtime',
      description: 'Number of Black overtime periods left.',
      valueType: 'number',
    },
    'zh-cn': { name: '黑方读秒次数', description: '黑方剩余读秒次数。', valueType: 'number' },
  },
  OW: {
    en: {
      name: 'White overtime',
      description: 'Number of White overtime periods left.',
      valueType: 'number',
    },
    'zh-cn': { name: '白方读秒次数', description: '白方剩余读秒次数。', valueType: 'number' },
  },

  // Miscellaneous properties
  VW: {
    en: {
      name: 'View',
      description: 'Restrict view to these points.',
      valueType: 'elist of point',
    },
    'zh-cn': { name: '视图', description: '限制视图只显示这些点位。', valueType: 'elist of point' },
  },
  TB: {
    en: {
      name: 'Black territory',
      description: 'Mark points as Black territory.',
      valueType: 'elist of point',
    },
    'zh-cn': { name: '黑方地域', description: '标记黑方地域。', valueType: 'elist of point' },
  },
  TW: {
    en: {
      name: 'White territory',
      description: 'Mark points as White territory.',
      valueType: 'elist of point',
    },
    'zh-cn': { name: '白方地域', description: '标记白方地域。', valueType: 'elist of point' },
  },
};

/** 按语言取属性说明，locale 为 messages 模块支持的语言（en、zh-cn），其余按英文处理 */
function getPropertyInfo(propName: string, locale: string): PropertyInfo | null {
  const info = PROPERTY_INFO[propName];
  if (!info) return null;
  return locale === 'zh-cn' ? info['zh-cn'] : info.en;
}

/** 遍历 token 时每层括号（GameTree）的状态 */
interface TreeFrame {
  /** 从根节点到当前节点的手数 */
  moves: number;
  /** 是否处于变化图中：路径上任一分叉点选的不是第一个子分支（即不在主线上） */
  inVariation: boolean;
  /** 本层已遇到的子分支数 */
  children: number;
}

/** 行棋属性，每个节点最多计一手 */
const MOVE_PROPS = new Set(['B', 'W']);

export class SgfHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Hover> {
    if (token.isCancellationRequested) return null;

    const text = document.getText();
    const offset = document.offsetAt(position);

    // 最外层是哨兵帧，每遇到一个顶层 '(' 开始一局新棋
    const stack: TreeFrame[] = [{ moves: 0, inVariation: false, children: 0 }];
    let nodeCounted = false;

    try {
      // 从头 tokenize 到光标处，沿途按括号嵌套累计手数
      for (const sgfToken of tokenizeIter(text)) {
        if (token.isCancellationRequested) return null;

        const tokenStart = sgfToken.pos;
        const tokenEnd = sgfToken.pos + sgfToken.value.length;
        const frame = stack[stack.length - 1];

        if (sgfToken.type === 'parenthesis') {
          if (sgfToken.value === '(') {
            const index = frame.children++;
            stack.push(
              stack.length === 1
                ? { moves: 0, inVariation: false, children: 0 }
                : { moves: frame.moves, inVariation: frame.inVariation || index > 0, children: 0 },
            );
          } else if (stack.length > 1) {
            stack.pop();
          }
          nodeCounted = false;
        } else if (sgfToken.type === 'semicolon') {
          nodeCounted = false;
        }

        // SGF 属性标识只取大写字母，小写字母会被忽略
        const propName =
          sgfToken.type === 'prop_ident' ? sgfToken.value.replace(/[^A-Z]/g, '') : '';
        if (MOVE_PROPS.has(propName) && !nodeCounted) {
          frame.moves++;
          nodeCounted = true;
        }

        // 光标在当前 token 范围内
        if (offset >= tokenStart && offset < tokenEnd) {
          // 只对属性名提供 hover
          if (!propName) return null;
          // 与预览面板一致，跟随 sgfPreview.language 设置
          const locale = messages.getLocale();
          const zh = locale === 'zh-cn';
          const info = getPropertyInfo(propName, locale);

          if (!info) {
            // 非标准属性，显示通用说明
            const markdown = new vscode.MarkdownString();
            markdown.appendCodeblock(propName, 'sgf');
            markdown.appendText(
              zh ? '未在 FF[4] 规范中定义的属性' : 'Property not defined in FF[4] specification',
            );
            return new vscode.Hover(
              markdown,
              new vscode.Range(document.positionAt(tokenStart), document.positionAt(tokenEnd)),
            );
          }

          // 构造 hover 内容
          const markdown = new vscode.MarkdownString();
          markdown.appendMarkdown(`**${propName}** — ${info.name}\n\n`);
          if (MOVE_PROPS.has(propName)) {
            // 手数只在主线上有全局意义；变化图里同一个手数对应多个不同局面，只标注是变化图
            const current = stack[stack.length - 1];
            const label = current.inVariation
              ? zh
                ? '变化图中的一手'
                : 'Move in a variation'
              : zh
                ? `第 ${current.moves} 手`
                : `Move ${current.moves}`;
            markdown.appendMarkdown(`**${label}**\n\n`);
          }
          markdown.appendText(info.description);
          markdown.appendText('\n\n');
          markdown.appendMarkdown(`*${zh ? '类型' : 'Type'}:* \`${info.valueType}\``);

          return new vscode.Hover(
            markdown,
            new vscode.Range(document.positionAt(tokenStart), document.positionAt(tokenEnd)),
          );
        }
      }
    } catch (err) {
      // tokenize 失败时不提供 hover
      console.error('SGF tokenize error in hover:', err);
    }

    return null;
  }
}
