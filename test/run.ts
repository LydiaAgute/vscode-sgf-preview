// 用法：pnpm test（先由 esbuild 打包到 test/dist/run.js，再执行 node test/dist/run.js <sgf 文件或目录>）
// 直接在 Node 中加载 webview 的回放模块，校验样例棋谱能完整解析、回放。

import * as fs from 'fs';
import * as path from 'path';
import GoBoard, { type SignMap } from '@sabaki/go-board';
import * as sgfTree from '../src/sgfTree';
import * as Messages from '../src/messages';
import * as SgfGame from '../webview/game';
import * as Analysis from '../webview/analysis';
import * as Compat from '../webview/compat';
import * as I18n from '../webview/i18n';

// 打包产物位于 test/dist/，项目根目录在上两级
const root = path.resolve(__dirname, '../..');

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** 断言 value 非空后返回，便于在表达式里直接取字段 */
function must<T>(value: T | null | undefined, msg: string): T {
  assert(value !== null && value !== undefined, msg);
  return value;
}

const build = (text: string) => SgfGame.build(sgfTree.fromText(text));

// 第三方写法兼容：命中表内编码时还原，标准棋谱的取值必须原样通过
function compatTests(): void {
  const fox = ['GNU Go:3.8', 'foxwq'];
  const view = (over: Partial<Compat.CompatInfo>) =>
    Compat.interpret({ applications: [], rules: '', komi: '', result: '', ...over });
  const komi = (raw: string) => must(Compat.normalizeKomi(raw), `KM ${raw} 应可解析`).points;

  // KM 编码：375/650 查表，不按比例换算
  assert(komi('375') === 7.5, 'KM 375 应为 7.5 目');
  assert(komi('650') === 6.5, 'KM 650 应为 6.5 目，不是 13 目');

  // 标准 KM 原样通过，包括 0 和边界值
  for (const [raw, want] of [
    ['6.5', 6.5],
    ['7.5', 7.5],
    ['0', 0],
    ['0.0', 0],
    ['5.5', 5.5],
    ['100', 100],
    ['-5', -5],
  ] as const) {
    assert(komi(raw) === want, `标准 KM ${raw} 不应被改写`);
  }
  assert(
    Compat.normalizeKomi('') === null && Compat.normalizeKomi('分先 黑贴3又3/4子') === null,
    '空值和无法解析的串应为 null',
  );

  // 来源判定看全部 AP，foxwq 排在后面也要识别
  assert(Compat.detectOrigin(fox) === Compat.ORIGIN_FOXWQ, 'AP 含 foxwq 应判为野狐');
  assert(Compat.detectOrigin(['tygo:1.0.0']) === Compat.ORIGIN_UNKNOWN, 'tygo 不是野狐');
  assert(Compat.detectOrigin([]) === Compat.ORIGIN_UNKNOWN, '无 AP 不是野狐');

  // RE 特殊值：精确匹配
  assert(view({ result: 'W+0.02' }).result === 'W+T', 'W+0.02 应为 W+T');
  assert(view({ result: 'B+0.03' }).result === 'B+O', 'B+0.03 应为 B+O');
  assert(view({ result: 'R+R' }).result === '0', 'R+R 应为和棋');

  // RE 子数换算：只有 野狐 + 中国规则 才 ×2
  assert(
    view({ applications: fox, rules: 'Chinese', result: 'W+1.25' }).result === 'W+2.5',
    '野狐中国规则 W+1.25 应换成 2.5 目',
  );
  assert(
    view({ applications: fox, rules: 'Chinese', result: 'W+17.25' }).result === 'W+34.5',
    '野狐中国规则 W+17.25 应换成 34.5 目',
  );
  assert(
    view({ applications: fox, rules: 'Chinese', result: 'W+R' }).result === 'W+R',
    '非数值后缀不处理',
  );
  assert(
    view({ applications: fox, rules: 'Chinese', result: 'B+0.05' }).result === 'B+0.05',
    '过小的数值不处理',
  );
  assert(
    view({ applications: fox, rules: 'Japanese', result: 'B+4.50' }).result === 'B+4.50',
    '野狐日本规则不换算',
  );
  assert(
    view({ applications: ['tygo:1.0.0'], rules: 'Chinese', result: 'B+5.5' }).result === 'B+5.5',
    '非野狐来源不换算',
  );
  assert(view({ rules: 'Chinese', result: 'W+0.02' }).result === 'W+T', '特殊值不依赖来源');

  // 标准棋谱的各种取值全部原样通过
  for (const re of ['B+3.5', 'W+R', 'B+T', 'W+Resign', 'B+F', 'Void', '0', 'Draw', '?', '']) {
    assert(view({ rules: 'Japanese', result: re }).result === re, `标准 RE ${re} 不应被改写`);
  }
  console.log('兼容层测试通过');
}

// 多语言：各语言包的键必须一致，占位符必须一致，回退和单复数规则要生效
function i18nTests(): void {
  // 同一占位符出现几次不同语言可以不同（如“{n}×{n}”与“{n} 路”），只比较用到了哪些
  const placeholders = (s: string) =>
    [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');

  const base = I18n.catalogs[I18n.DEFAULT_LOCALE];
  for (const [locale, catalog] of Object.entries(I18n.catalogs)) {
    if (locale === I18n.DEFAULT_LOCALE) continue;
    for (const key of Object.keys(base)) {
      if (key.endsWith('.one')) continue; // 单数形式只在需要区分单复数的语言里提供
      assert(key in catalog, `${locale} 缺少键 ${key}`);
      assert(
        placeholders(catalog[key]) === placeholders(base[key]),
        `${locale} 的 ${key} 占位符与英文不一致`,
      );
    }
    for (const key of Object.keys(catalog))
      assert(key in base, `${locale} 多出键 ${key}，英文里没有`);
  }

  // 回退：未收录的语言用英文，不会抛错
  assert(
    I18n.resolveLocale('fr') === 'en' && I18n.resolveLocale('') === 'en',
    '未收录的语言应回退到英文',
  );
  assert(I18n.resolveLocale('zh-CN') === 'zh-cn', '语言标识不区分大小写');
  I18n.setLocale('zh-cn');
  assert(I18n.t('opt.numbers') === '显示手数', '中文文案');
  I18n.setLocale('en');
  assert(I18n.t('opt.numbers') === 'Show move numbers', '英文文案');
  assert(I18n.t('no.such.key') === 'no.such.key', '缺失的键应原样返回');
  assert(I18n.t('nav.totalSuffix', { total: 9 }) === '/ 9', '占位符替换');
  assert(I18n.t('nav.totalSuffix') === '/ {total}', '缺少的参数保留占位符');

  // 单复数：英文区分，中文不区分
  assert(I18n.tn('unit.points', 1, { n: '1' }) === '1 point', '英文单数');
  assert(I18n.tn('unit.points', 7.5, { n: '7.5' }) === '7.5 points', '英文复数');
  assert(I18n.tn('unit.stones', 1, { n: '1' }) === '1 stone', '英文子单数');
  I18n.setLocale('zh-cn');
  assert(I18n.tn('unit.points', 1, { n: '1' }) === '1 目', '中文不区分单复数');
  I18n.setLocale('en');

  // 扩展端：package.nls 的键齐全，且 package.json 引用的 %key% 都有定义
  const readText = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
  const readJson = (f: string) => JSON.parse(readText(f));
  const nls: Record<string, string> = readJson('package.nls.json');
  const nlsZh: Record<string, string> = readJson('package.nls.zh-cn.json');
  assert(
    Object.keys(nls).sort().join() === Object.keys(nlsZh).sort().join(),
    'package.nls 中英文键不一致',
  );
  const refs = [...readText('package.json').matchAll(/"%([\w.]+)%"/g)].map((m) => m[1]);
  for (const ref of refs)
    assert(ref in nls, `package.json 引用的 %${ref}% 在 package.nls.json 里没有定义`);

  // 扩展端运行时文案：中文包必须覆盖源码中 t(...) 调用的英文原文
  const zh: Record<string, string> = readJson('l10n/bundle.l10n.zh-cn.json');
  for (const f of ['src/extension.ts', 'src/sgfTree.ts']) {
    for (const m of readText(f).matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      assert(m[1] in zh, `l10n 中文包缺少 ${f} 里的文案: ${m[1]}`);
    }
  }

  // 语言设置：auto 跟随 VS Code，指定语言时固定，未支持的语言回退英文
  assert(Messages.resolve('auto', 'zh-cn') === 'zh-cn', 'auto 应跟随 VS Code 的中文');
  assert(Messages.resolve('auto', 'ZH-CN') === 'zh-cn', '语言标识不区分大小写');
  assert(Messages.resolve('auto', 'fr') === 'en', 'auto 遇到未支持的语言应回退英文');
  assert(
    Messages.resolve('auto', undefined) === 'en' &&
      Messages.resolve(undefined, 'zh-cn') === 'zh-cn',
    '缺省值按 auto 处理',
  );
  assert(Messages.resolve('en', 'zh-cn') === 'en', '固定英文时不随 VS Code 变化');
  assert(Messages.resolve('zh-cn', 'en') === 'zh-cn', '固定中文时不随 VS Code 变化');
  assert(Messages.resolve('klingon', 'zh-cn') === 'en', '无效的设置值应回退英文');
  Messages.setLocale('zh-cn');
  assert(Messages.t('Game: {0}', 'a.sgf') === '棋谱: a.sgf', '扩展提示的中文');
  Messages.setLocale('en');
  assert(Messages.t('Game: {0}', 'a.sgf') === 'Game: a.sgf', '扩展提示的英文');
  assert(Messages.t('Game: {0}') === 'Game: {0}', '缺少参数时保留占位符');

  // 设置项的可选值必须与实际支持的语言一致，webview 的语言包也要有对应的
  const pkg = readJson('package.json');
  const setting = pkg.contributes.configuration.properties['sgfPreview.language'];
  assert(setting.default === 'auto', '语言设置默认应为 auto');
  assert(
    setting.enum.join() === ['auto', ...Messages.SUPPORTED].join(),
    `语言设置的可选值与支持的语言不一致: ${setting.enum}`,
  );
  assert(setting.enumDescriptions.length === setting.enum.length, '每个可选值都要有说明');

  // 打开位置设置：默认在当前视窗，可选值与代码里识别的值一致，每个值都有说明
  const where = pkg.contributes.configuration.properties['sgfPreview.openLocation'];
  assert(where.default === 'current', '打开位置默认应为 current');
  assert(where.enum.join() === 'current,beside', `打开位置的可选值不符: ${where.enum}`);
  assert(where.enumDescriptions.length === where.enum.length, '打开位置的每个可选值都要有说明');
  const extensionCode = readText('src/extension.ts');
  assert(
    extensionCode.includes("'sgfPreview'") && extensionCode.includes("'openLocation'"),
    '源码应读取 openLocation 设置',
  );
  for (const locale of Messages.SUPPORTED)
    assert(locale in I18n.catalogs, `webview 缺少语言包 ${locale}`);
  console.log('多语言测试通过');
}

function unitTests(): void {
  // 提子：白子被四面包围后应被提
  const g = build('(;SZ[9];B[ba];W[aa];B[ab])');
  const end = g.positions[g.positions.length - 1];
  assert(end.board.get([0, 0]) === SgfGame.EMPTY, '角上白子应被提');
  assert(end.captures.black === 1, '黑提子数应为 1');

  // 转义与软换行
  const tree = sgfTree.fromText('(;C[a\\]b\\\nc])');
  assert(
    tree.nodes[0].data.C[0] === 'a]bc',
    `转义解析错误: ${JSON.stringify(tree.nodes[0].data.C[0])}`,
  );

  // 让子 + 压缩点列表 + 停一手
  const h = build('(;SZ[19]HA[2]AB[dd][pp]AE[aa:bb];W[];B[qq])');
  assert(h.positions.length === 3, '应有开局+2手');
  assert(must(h.positions[1].move, '第1手应有落子').pass, '第1手应为停一手');

  // 分支只走主线
  const v = build('(;SZ[9];B[ee](;W[cc];B[gg])(;W[gc]))');
  assert(v.positions.length === 4 && v.variationCount === 1, '主线应为3手且有1处分支');

  // 切换分支：在 B[ee] 处改走第二个分支
  const vt = sgfTree.fromText('(;SZ[9];B[ee](;W[cc];B[gg])(;W[gc];B[cg];W[gg]))');
  const fork = must(
    vt.nodes.find((n) => n.data.B && n.data.B[0] === 'ee'),
    '应找到 B[ee] 分叉点',
  );
  const main = SgfGame.build(vt);
  assert(
    main.positions[1].branches.length === 2 && !main.positions[2].inVariation,
    '分叉点应列出 2 个分支',
  );
  const alt = SgfGame.build(vt, { [fork.id]: 1 });
  assert(
    alt.positions.length === 5 && alt.positions[2].inVariation,
    '切到第二分支后应有 4 手且处于变化中',
  );
  const altPoint = must(must(alt.positions[2].move, '变化第一手应有落子').point, '不应停一手');
  assert(altPoint[0] === 6 && altPoint[1] === 2, '变化第一手应为 gc');
  assert(alt.mainMoveCount === 3, '主线手数不随分支选择变化');

  // 贴目：野狐百分之一子单位与普通目数
  assert(must(Analysis.parseKomi('375'), '375 应可解析').points === 7.5, '375 应为 7.5 目');
  assert(must(Analysis.parseKomi('6.5'), '6.5 应可解析').points === 6.5, '6.5 应为 6.5 目');
  assert(Analysis.parseKomi('') === null, '空贴目应为 null');

  compatTests();
  i18nTests();

  // 形势估算：左半黑右半白的 9 路棋盘，双方各占一半
  const rows: SignMap = [];
  for (let y = 0; y < 9; y++) {
    rows.push(([0, 0, 1, 0, 0, 0, -1, 0, 0] as const).map((s, x) => (x === 3 || x === 5 ? 0 : s)));
  }
  const half = Analysis.estimateBoard(
    new GoBoard(rows),
    { black: 0, white: 0 },
    { rules: 'Chinese', komi: '0' },
  );
  assert(half.black > 0 && half.white > 0, '双方都应有地');
  assert(Math.abs(half.lead) <= 1, `对称局面不应有明显领先: ${half.lead}`);
  const empty = Analysis.estimateBoard(
    GoBoard.fromDimensions(9),
    { black: 0, white: 0 },
    { rules: '', komi: '7.5' },
  );
  assert(empty.black === 0 && empty.white === 0 && empty.lead === -7.5, '空盘只剩贴目');
  console.log('单元测试通过');
}

function check(file: string): void {
  const t0 = Date.now();
  const game = SgfGame.build(sgfTree.fromBytes(fs.readFileSync(file)));
  const last = game.positions[game.positions.length - 1];
  const t1 = Date.now();
  let worst = 0;
  for (let i = 0; i < game.positions.length; i++) {
    const t = Date.now();
    must(Analysis.estimateAt(game, i), `第 ${i} 手估算失败`);
    worst = Math.max(worst, Date.now() - t);
  }
  const fin = must(Analysis.estimateAt(game, game.positions.length - 1), '终局估算失败');
  console.log(
    `${path.basename(file)}: ${game.info.blackName} vs ${game.info.whiteName}, ` +
      `${last.moveNumber} 手, 结果 ${game.info.result}, 提子 黑${last.captures.black}/白${last.captures.white}, ` +
      `分叉 ${game.branchPoints}/变化 ${game.variationCount}, 回放 ${t1 - t0}ms, 全程估算 ${Date.now() - t1}ms(单次最慢 ${worst}ms), ` +
      `终局估算 黑${fin.black}/白${fin.white} 领先${fin.lead}`,
  );
}

unitTests();
// 样例棋谱不随仓库分发。目录不存在或没有 .sgf 文件时跳过，只跑上面的单元测试
const target = process.argv[2];
if (target) {
  if (!fs.existsSync(target)) {
    console.log(`样例路径不存在，跳过样例检查: ${target}`);
  } else {
    const files = fs.statSync(target).isDirectory()
      ? fs
          .readdirSync(target)
          .filter((f) => /\.sgf$/i.test(f))
          .map((f) => path.join(target, f))
      : [target];
    if (!files.length) console.log(`样例目录中没有 .sgf 文件，跳过样例检查: ${target}`);
    files.forEach(check);
  }
}
