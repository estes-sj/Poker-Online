export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

export function buildDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

export function shuffleDeck(inputDeck: Card[] = buildDeck(), random: () => number = Math.random): Card[] {
  const deck = [...inputDeck];

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const next = deck[index];
    deck[index] = deck[swapIndex]!;
    deck[swapIndex] = next!;
  }

  return deck;
}

export function dealHoleCards(
  accountIds: string[],
  deck: Card[]
): { holeCards: Record<string, [Card, Card]>; remainingDeck: Card[] } {
  if (accountIds.length < 2) {
    throw new Error("At least two players are required to deal a hand.");
  }

  const remainingDeck = [...deck];
  const interimCards = new Map<string, Card[]>();

  for (const accountId of accountIds) {
    interimCards.set(accountId, []);
  }

  for (let round = 0; round < 2; round += 1) {
    for (const accountId of accountIds) {
      const nextCard = remainingDeck.shift();

      if (!nextCard) {
        throw new Error("Deck exhausted while dealing hole cards.");
      }

      interimCards.get(accountId)!.push(nextCard);
    }
  }

  const holeCards = Object.fromEntries(
    accountIds.map((accountId) => {
      const cards = interimCards.get(accountId)!;
      return [accountId, [cards[0]!, cards[1]!] as [Card, Card]];
    })
  );

  return { holeCards, remainingDeck };
}
