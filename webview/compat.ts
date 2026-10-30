/**
 * 第三方棋谱非标准写法的识别与还原，只在展示层使用，不改动 @sabaki/sgf 解析出的棋谱树。
 *
 * 每条规则都是精确匹配，并按需限定来源，保证标准棋谱不会命中：
 * - KM 编码值：只匹配原串恰好为表中的编码，标准贴目（6.5、7.5、0）不在表内。
 * - RE 特殊值：只匹配表中的完整串；围棋不存在 0.02 目、0.03 目的胜差，不会与真实结果冲突。
 * - RE 子数换算：仅限来源为野狐（AP 含 foxwq）且中国规则。
 *
 * 目数（points）是内部统一单位。中国规则的展示单位是子，1 子 = 2 目。
 */

export const ORIGIN_FOXWQ = 'foxwq';
export const ORIGIN_UNKNOWN = 'unknown';

export type Origin = typeof ORIGIN_FOXWQ | typeof ORIGIN_UNKNOWN;

export interface Komi {
  /** 单位目 */
  points: number;
}

export interface ResultContext {
  origin: Origin;
  chinese: boolean;
}

/** interpret 需要的对局信息字段 */
export interface CompatInfo {
  applications: string[];
  rules: string;
  komi: string;
  result: string;
}

export interface Interpretation extends ResultContext {
  komi: Komi | null;
  result: string;
}

/**
 * 野狐、99 围棋的 KM 编码。编码不是按比例换算：375 对应 7.5 目，650 对应 6.5 目，只能查表。
 */
const KOMI_CODES: Readonly<Record<string, number>> = { 375: 7.5, 650: 6.5 };

/** 野狐 RE 特殊值，归一到 SGF 常用的结果串：T=超时，O=断线，0=和棋。首字母恒为胜方 */
const RESULT_CODES: Readonly<Record<string, string>> = {
  'W+0.02': 'W+T',
  'B+0.02': 'B+T',
  'W+0.03': 'W+O',
  'B+0.03': 'B+O',
  'R+R': '0',
};

// 野狐 RE 记的是子数，下界挡住 0 和编码残留值
const MIN_FOXWQ_MARGIN = 0.1;

const has = (table: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key);

/** 野狐谱在同一根节点写多个 AP，如 `AP[GNU Go:3.8]AP[foxwq]`，所以要看全部 AP 值 */
export function detectOrigin(applications: readonly string[] | undefined): Origin {
  const found = (applications || []).some((v) => String(v).includes('foxwq'));
  return found ? ORIGIN_FOXWQ : ORIGIN_UNKNOWN;
}

/** 中国规则：标准写法 Chinese，另兼容弈客的 cn */
export function isChineseRule(rules: string | undefined): boolean {
  return /^(chinese|cn)$/i.test((rules || '').trim());
}

/** 返回 {points}（单位目）；空值或无法解析返回 null */
export function normalizeKomi(raw: string | number | null | undefined): Komi | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (has(KOMI_CODES, s)) return { points: KOMI_CODES[s] };
  const v = parseFloat(s);
  return Number.isFinite(v) ? { points: v } : null;
}

/** 返回归一后的 RE 串；比分部分统一为目数 */
export function normalizeResult(raw: string | undefined, ctx?: ResultContext): string {
  const s = (raw || '').trim();
  if (has(RESULT_CODES, s)) return RESULT_CODES[s];

  if (ctx && ctx.origin === ORIGIN_FOXWQ && ctx.chinese) {
    const m = /^([BW])\+(\d+(?:\.\d+)?)$/.exec(s);
    if (m) {
      const margin = parseFloat(m[2]);
      if (margin > MIN_FOXWQ_MARGIN) return `${m[1]}+${Math.round(margin * 2 * 100) / 100}`;
    }
  }
  return s;
}

/** 根据对局信息得出来源、规则类别以及归一后的贴目和结果 */
export function interpret(info: CompatInfo): Interpretation {
  const origin = detectOrigin(info.applications);
  const chinese = isChineseRule(info.rules);
  return {
    origin,
    chinese,
    komi: normalizeKomi(info.komi),
    result: normalizeResult(info.result, { origin, chinese }),
  };
}
