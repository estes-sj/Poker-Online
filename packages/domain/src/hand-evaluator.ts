import type { Card } from "./cards.js";

export interface EvaluatedHand {
  category: number;
  tiebreakers: number[];
  label: string;
}

const RANK_VALUES: Record<Card["rank"], number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const CATEGORY_LABELS = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
];

export function evaluateHoldemHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error("Hold'em hand evaluation expects 5 to 7 cards.");
  }

  let best: EvaluatedHand | null = null;

  for (const combination of getFiveCardCombinations(cards)) {
    const candidate = evaluateFiveCardHand(combination);

    if (!best || compareEvaluatedHands(candidate, best) > 0) {
      best = candidate;
    }
  }

  return best!;
}

export function compareEvaluatedHands(left: EvaluatedHand, right: EvaluatedHand): number {
  if (left.category !== right.category) {
    return left.category - right.category;
  }

  const limit = Math.max(left.tiebreakers.length, right.tiebreakers.length);

  for (let index = 0; index < limit; index += 1) {
    const difference = (left.tiebreakers[index] ?? 0) - (right.tiebreakers[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function evaluateFiveCardHand(cards: Card[]): EvaluatedHand {
  const ranks = cards.map((card) => RANK_VALUES[card.rank]).sort((left, right) => right - left);
  const rankCounts = buildRankCounts(ranks);
  const countEntries = Array.from(rankCounts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return right[0] - left[0];
  });
  const isFlush = new Set(cards.map((card) => card.suit)).size === 1;
  const straightHigh = getStraightHigh(ranks);

  if (isFlush && straightHigh) {
    return buildEvaluation(8, [straightHigh]);
  }

  if (countEntries[0]?.[1] === 4) {
    const quadRank = countEntries[0][0];
    const kicker = countEntries[1]![0];
    return buildEvaluation(7, [quadRank, kicker]);
  }

  if (countEntries[0]?.[1] === 3 && countEntries[1]?.[1] === 2) {
    return buildEvaluation(6, [countEntries[0][0], countEntries[1][0]]);
  }

  if (isFlush) {
    return buildEvaluation(5, ranks);
  }

  if (straightHigh) {
    return buildEvaluation(4, [straightHigh]);
  }

  if (countEntries[0]?.[1] === 3) {
    const kickers = countEntries.slice(1).map(([rank]) => rank).sort((left, right) => right - left);
    return buildEvaluation(3, [countEntries[0][0], ...kickers]);
  }

  if (countEntries[0]?.[1] === 2 && countEntries[1]?.[1] === 2) {
    const highPair = Math.max(countEntries[0][0], countEntries[1][0]);
    const lowPair = Math.min(countEntries[0][0], countEntries[1][0]);
    const kicker = countEntries[2]![0];
    return buildEvaluation(2, [highPair, lowPair, kicker]);
  }

  if (countEntries[0]?.[1] === 2) {
    const pairRank = countEntries[0][0];
    const kickers = countEntries.slice(1).map(([rank]) => rank).sort((left, right) => right - left);
    return buildEvaluation(1, [pairRank, ...kickers]);
  }

  return buildEvaluation(0, ranks);
}

function buildEvaluation(category: number, tiebreakers: number[]): EvaluatedHand {
  return {
    category,
    tiebreakers,
    label: CATEGORY_LABELS[category]!,
  };
}

function buildRankCounts(ranks: number[]): Map<number, number> {
  const counts = new Map<number, number>();

  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }

  return counts;
}

function getStraightHigh(ranks: number[]): number | null {
  const uniqueRanks = Array.from(new Set(ranks)).sort((left, right) => right - left);

  if (uniqueRanks.includes(14)) {
    uniqueRanks.push(1);
  }

  for (let index = 0; index <= uniqueRanks.length - 5; index += 1) {
    const window = uniqueRanks.slice(index, index + 5);

    if (window[0]! - window[4]! === 4 && isSequential(window)) {
      return window[0] === 1 ? 5 : window[0]!;
    }
  }

  return null;
}

function isSequential(values: number[]): boolean {
  for (let index = 0; index < values.length - 1; index += 1) {
    if (values[index]! - values[index + 1]! !== 1) {
      return false;
    }
  }

  return true;
}

function getFiveCardCombinations(cards: Card[]): Card[][] {
  const combinations: Card[][] = [];

  for (let first = 0; first < cards.length - 4; first += 1) {
    for (let second = first + 1; second < cards.length - 3; second += 1) {
      for (let third = second + 1; third < cards.length - 2; third += 1) {
        for (let fourth = third + 1; fourth < cards.length - 1; fourth += 1) {
          for (let fifth = fourth + 1; fifth < cards.length; fifth += 1) {
            combinations.push([cards[first]!, cards[second]!, cards[third]!, cards[fourth]!, cards[fifth]!]);
          }
        }
      }
    }
  }

  return combinations;
}