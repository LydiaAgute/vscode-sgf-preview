/**
 * 基于当前棋面的静态形势估算，用 @sabaki/influence 判定每个点的归属。
 * 估算不识别死子，棋盘上的子一律按活子计入。
 */

import influence from '@sabaki/influence';
import type GoBoard from '@sabaki/go-board';
import * as Compat from './compat';
import type { Captures, Game, GameInfo } from './game';

export interface Estimate {
  /** 每个点的归属：正数为黑，负数为白，0 为未定 */
  owner: number[][];
  black: number;
  white: number;
  /** 单位目 */
  komi: number;
  /** 黑减白再减贴目，单位目 */
  lead: number;
  method: 'territory' | 'area';
  chinese: boolean;
}

type EstimateInfo = Pick<GameInfo, 'rules' | 'komi'>;

const cache = new WeakMap<object, Estimate | null>();

/** 解析 KM 属性，返回 {points}（单位目）；无法解析返回 null */
export const parseKomi = Compat.normalizeKomi;

/** 日本、韩国规则按数目法（地 + 提子），其余按数子法（子 + 地） */
function usesTerritoryScoring(rules: string | undefined): boolean {
  return /japan|korea/i.test(rules || '');
}

export function estimateBoard(board: GoBoard, captures: Captures, info: EstimateInfo): Estimate {
  const data = board.signMap;
  const height = data.length;
  const width = height ? data[0].length : 0;
  const hasStones = data.some((row) => row.some((v) => v !== 0));
  const owner = hasStones
    ? influence.map(data, { discrete: true })
    : data.map((row) => row.map(() => 0));

  let blackArea = 0;
  let whiteArea = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = owner[y][x];
      const empty = data[y][x] === 0;
      if (o > 0) {
        blackArea++;
        if (empty) blackTerritory++;
      } else if (o < 0) {
        whiteArea++;
        if (empty) whiteTerritory++;
      }
    }
  }

  const territory = usesTerritoryScoring(info.rules);
  const black = territory ? blackTerritory + captures.black : blackArea;
  const white = territory ? whiteTerritory + captures.white : whiteArea;
  const komiInfo = parseKomi(info.komi);
  const komi = komiInfo ? komiInfo.points : 0;
  return {
    owner,
    black,
    white,
    komi,
    lead: black - white - komi,
    method: territory ? 'territory' : 'area',
    chinese: Compat.isChineseRule(info.rules),
  };
}

/** 第 index 手之后局面的估算结果，同一局面只算一次；估算失败返回 null */
export function estimateAt(game: Game, index: number): Estimate | null {
  const pos = game.positions[index];
  if (!pos) return null;
  const cached = cache.get(pos);
  if (cached !== undefined) return cached;
  let result: Estimate | null;
  try {
    result = estimateBoard(pos.board, pos.captures, game.info);
  } catch {
    result = null;
  }
  cache.set(pos, result);
  return result;
}
