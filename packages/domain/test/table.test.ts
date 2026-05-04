import { describe, expect, it } from "vitest";

import { getBlindLevelAtElapsedMinutes } from "../src/blinds";
import { buildDeck } from "../src/cards";
import {
  createTable,
  applyPlayerAction,
  applyRunItTwiceDecision,
  expirePendingRunItTwiceDecision,
  finishHand,
  leaveSeat,
  resolvePendingRunItTwiceDecision,
  seatPlayer,
  setPlayerConnection,
  setPlayerReady,
  setPlayerSittingOut,
  startHand,
  addPlayerChips,
} from "../src/table";

const blindSchedule = [
  { level: 1, smallBlind: 100, bigBlind: 200, durationMinutes: 20 },
  { level: 2, smallBlind: 200, bigBlind: 400, durationMinutes: 20 },
];

describe("blind schedule", () => {
  it("keeps the last configured level after the schedule expires", () => {
    const level = getBlindLevelAtElapsedMinutes(blindSchedule, 47);
    expect(level.level).toBe(2);
    expect(level.bigBlind).toBe(400);
  });
});

describe("table start", () => {
  it("deals unique hole cards and posts the blinds", () => {
    let table = createTable({
      slug: "club-night",
      name: "Club Night",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 6,
      startingStack: 10_000,
      blindSchedule,
      autoStartNextHand: true,
      autoStartDelaySeconds: 10,
      passwordProtected: true,
    }, new Date("2026-04-09T20:00:00.000Z"));

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 });
    table = seatPlayer(table, { accountId: "c", displayName: "C", seatIndex: 2 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);
    table = setPlayerReady(table, "c", true);
    table = startHand(table, {
      now: new Date("2026-04-09T20:01:00.000Z"),
      random: () => 0.42,
    });

    expect(table.currentHand).not.toBeNull();
    expect(table.currentHand?.dealerSeat).toBe(0);
    expect(table.currentHand?.smallBlindSeat).toBe(1);
    expect(table.currentHand?.bigBlindSeat).toBe(2);
    expect(table.currentHand?.actorSeat).toBe(0);
    expect(table.currentHand?.pot).toBe(300);
    expect(table.currentHand?.actions).toHaveLength(2);

    const dealtCards = Object.values(table.currentHand!.holeCards).flat();
    expect(new Set(dealtCards.map((card) => `${card.rank}-${card.suit}`)).size).toBe(6);
    expect(table.players.find((player) => player.accountId === "b")?.stack).toBe(9_900);
    expect(table.players.find((player) => player.accountId === "c")?.stack).toBe(9_800);
  });

  it("posts antes for every active player when configured", () => {
    let table = createTable({
      slug: "ante-night",
      name: "Ante Night",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 4,
      startingStack: 5_000,
      blindSchedule: [{ level: 1, smallBlind: 50, bigBlind: 100, ante: 10, durationMinutes: 20 }],
      autoStartNextHand: false,
      autoStartDelaySeconds: 0,
      passwordProtected: false,
    });

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 });
    table = seatPlayer(table, { accountId: "c", displayName: "C", seatIndex: 2 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);
    table = setPlayerReady(table, "c", true);
    table = startHand(table, { random: () => 0.18 });

    expect(table.currentHand?.pot).toBe(180);
    expect(table.currentHand?.actions.map((action) => action.type)).toEqual([
      "post_ante",
      "post_ante",
      "post_ante",
      "post_small_blind",
      "post_big_blind",
    ]);
    expect(table.players.find((player) => player.accountId === "a")?.stack).toBe(4_990);
    expect(table.players.find((player) => player.accountId === "b")?.stack).toBe(4_940);
    expect(table.players.find((player) => player.accountId === "c")?.stack).toBe(4_890);
  });

  it("rotates the dealer button between hands", () => {
    let table = createTable({
      slug: "club-night",
      name: "Club Night",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 6,
      startingStack: 10_000,
      blindSchedule,
      autoStartNextHand: false,
      autoStartDelaySeconds: 0,
      passwordProtected: false,
    });

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 3 });
    table = seatPlayer(table, { accountId: "c", displayName: "C", seatIndex: 5 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);
    table = setPlayerReady(table, "c", true);
    table = startHand(table, { random: () => 0.3 });

    expect(table.currentHand?.dealerSeat).toBe(0);

    table = finishHand(table);
    table = startHand(table, { random: () => 0.3 });

    expect(table.currentHand?.dealerSeat).toBe(3);
  });

  it("excludes disconnected players from the next hand", () => {
    let table = createTable({
      slug: "presence-check",
      name: "Presence Check",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 3,
      startingStack: 10_000,
      blindSchedule,
      autoStartNextHand: true,
      autoStartDelaySeconds: 5,
      passwordProtected: false,
    });

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 });
    table = seatPlayer(table, { accountId: "c", displayName: "C", seatIndex: 2 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);
    table = setPlayerReady(table, "c", true);
    table = setPlayerConnection(table, { accountId: "c", isConnected: false });
    table = startHand(table, { random: () => 0.25 });

    expect(Object.keys(table.currentHand?.holeCards ?? {})).toEqual(["a", "b"]);
    expect(table.currentHand?.dealerSeat).toBe(0);
  });

  it("supports sitting out between hands", () => {
    let table = createTable({
      slug: "sit-out-check",
      name: "Sit Out Check",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 4,
      startingStack: 10_000,
      blindSchedule,
      autoStartNextHand: true,
      autoStartDelaySeconds: 5,
      passwordProtected: false,
    });

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 });
    table = seatPlayer(table, { accountId: "c", displayName: "C", seatIndex: 2 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);
    table = setPlayerReady(table, "c", true);
    table = setPlayerSittingOut(table, "c", true);
    table = startHand(table, { random: () => 0.2 });

    expect(table.players.find((player) => player.accountId === "c")?.isSittingOut).toBe(true);
    expect(Object.keys(table.currentHand?.holeCards ?? {})).toEqual(["a", "b"]);
  });

  it("allows leaving a seat only when no hand is active", () => {
    let table = createTable({
      slug: "leave-seat",
      name: "Leave Seat",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 4,
      startingStack: 10_000,
      blindSchedule,
      autoStartNextHand: false,
      autoStartDelaySeconds: 0,
      passwordProtected: false,
    });

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);
    table = startHand(table, { random: () => 0.25 });

    expect(() => leaveSeat(table, "a")).toThrow(/Cannot leave a seat while a hand is in progress/);

    table = finishHand(table);
    table = leaveSeat(table, "a");

    expect(table.players.map((player) => player.accountId)).toEqual(["b"]);
  });

  it("supports adding chips between hands but not during an active hand", () => {
    let table = createTable({
      slug: "heads-up",
      name: "Heads Up",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 2,
      startingStack: 5_000,
      blindSchedule,
      autoStartNextHand: false,
      autoStartDelaySeconds: 0,
      passwordProtected: false,
    });

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);

    table = addPlayerChips(table, "a", 2_000);
    expect(table.players.find((player) => player.accountId === "a")?.stack).toBe(7_000);

    table = startHand(table, {
      deck: buildDeck(),
    });

    expect(() => addPlayerChips(table, "a", 2_000)).toThrow("Cannot adjust a stack while that player is in the current hand.");
  });

  it("advances through betting rounds and resolves a showdown", () => {
    let table = createTable({
      slug: "heads-up",
      name: "Heads Up",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 2,
      startingStack: 5_000,
      blindSchedule,
      autoStartNextHand: false,
      autoStartDelaySeconds: 0,
      passwordProtected: false,
    });

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);
    table = startHand(table, {
      deck: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
        { rank: "A", suit: "hearts" },
        { rank: "Q", suit: "diamonds" },
        { rank: "2", suit: "clubs" },
        { rank: "7", suit: "hearts" },
        { rank: "8", suit: "clubs" },
        { rank: "3", suit: "spades" },
        { rank: "9", suit: "clubs" },
        { rank: "4", suit: "spades" },
        { rank: "T", suit: "clubs" },
        { rank: "J", suit: "clubs" },
      ],
    });

    table = applyPlayerAction(table, { accountId: "a", type: "call" });
    expect(table.currentHand?.street).toBe("preflop");

    table = applyPlayerAction(table, { accountId: "b", type: "check" });
    expect(table.currentHand?.street).toBe("flop");
    expect(table.currentHand?.board.map((card) => `${card.rank}${card.suit[0]}`)).toEqual(["7h", "8c", "3s"]);

    table = applyPlayerAction(table, { accountId: "b", type: "check" });
    table = applyPlayerAction(table, { accountId: "a", type: "check" });
    expect(table.currentHand?.street).toBe("turn");

    table = applyPlayerAction(table, { accountId: "b", type: "check" });
    table = applyPlayerAction(table, { accountId: "a", type: "check" });
    expect(table.currentHand?.street).toBe("river");

    table = applyPlayerAction(table, { accountId: "b", type: "check" });
    table = applyPlayerAction(table, { accountId: "a", type: "check" });

    expect(table.currentHand).toBeNull();
    expect(table.lastCompletedHand?.winningReason).toBe("showdown");
    expect(table.lastCompletedHand?.winners).toHaveLength(1);
    expect(table.lastCompletedHand?.winners[0]?.accountId).toBe("a");
    expect(table.lastCompletedHand?.actions).toHaveLength(10);
    expect(table.lastCompletedHand?.revealedHoleCards).toEqual({
      a: [
        { rank: "A", suit: "spades" },
        { rank: "A", suit: "hearts" },
      ],
    });
    expect(table.players.find((player) => player.accountId === "a")?.stack).toBe(5_200);
    expect(table.players.find((player) => player.accountId === "b")?.stack).toBe(4_800);
  });

  it("can reveal every showdown hand when configured", () => {
    let table = createTable({
      slug: "reveal-all",
      name: "Reveal All",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 2,
      startingStack: 5_000,
      blindSchedule,
      autoStartNextHand: false,
      autoStartDelaySeconds: 0,
      revealAllShowdownHands: true,
      passwordProtected: false,
    });

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);
    table = startHand(table, {
      deck: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
        { rank: "A", suit: "hearts" },
        { rank: "Q", suit: "diamonds" },
        { rank: "2", suit: "clubs" },
        { rank: "7", suit: "hearts" },
        { rank: "8", suit: "clubs" },
        { rank: "3", suit: "spades" },
        { rank: "9", suit: "clubs" },
        { rank: "4", suit: "spades" },
        { rank: "T", suit: "clubs" },
        { rank: "J", suit: "clubs" },
      ],
    });

    table = applyPlayerAction(table, { accountId: "a", type: "call" });
    table = applyPlayerAction(table, { accountId: "b", type: "check" });
    table = applyPlayerAction(table, { accountId: "b", type: "check" });
    table = applyPlayerAction(table, { accountId: "a", type: "check" });
    table = applyPlayerAction(table, { accountId: "b", type: "check" });
    table = applyPlayerAction(table, { accountId: "a", type: "check" });
    table = applyPlayerAction(table, { accountId: "b", type: "check" });
    table = applyPlayerAction(table, { accountId: "a", type: "check" });

    expect(table.lastCompletedHand?.revealedHoleCards).toEqual({
      a: [
        { rank: "A", suit: "spades" },
        { rank: "A", suit: "hearts" },
      ],
      b: [
        { rank: "K", suit: "diamonds" },
        { rank: "Q", suit: "diamonds" },
      ],
    });
  });

  it("adds all-in runout metadata and auto-reveals all-in players before the full board is shown", () => {
    const now = new Date("2026-04-11T00:00:00.000Z");
    let table = createTable({
      slug: "all-in-runout",
      name: "All In Runout",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 2,
      startingStack: 5_000,
      blindSchedule,
      autoStartNextHand: true,
      autoStartDelaySeconds: 0,
      passwordProtected: false,
    }, now);

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 }, now);
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 }, now);
    table = setPlayerReady(table, "a", true, now);
    table = setPlayerReady(table, "b", true, now);
    table = startHand(table, {
      now,
      deck: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
        { rank: "A", suit: "hearts" },
        { rank: "Q", suit: "diamonds" },
        { rank: "2", suit: "clubs" },
        { rank: "7", suit: "hearts" },
        { rank: "8", suit: "clubs" },
        { rank: "3", suit: "spades" },
        { rank: "9", suit: "clubs" },
        { rank: "4", suit: "spades" },
        { rank: "T", suit: "clubs" },
        { rank: "J", suit: "clubs" },
      ],
    });

    table = applyPlayerAction(table, { accountId: "a", type: "all_in" }, now);
    table = applyPlayerAction(table, { accountId: "b", type: "all_in" }, now);

    expect(table.currentHand).toBeNull();
    expect(table.lastCompletedHand?.allInRunout).toEqual({
      startBoardCount: 0,
      revealIntervalMs: 2_000,
      revealedAccountIds: ["a", "b"],
    });
    expect(table.lastCompletedHand?.revealedHoleCards).toEqual({
      a: [
        { rank: "A", suit: "spades" },
        { rank: "A", suit: "hearts" },
      ],
      b: [
        { rank: "K", suit: "diamonds" },
        { rank: "Q", suit: "diamonds" },
      ],
    });
    expect(table.nextHandStartsAt).toBe(new Date(now.getTime() + 10_000).toISOString());
  });

  it("can run the board twice and split each pot across both runouts", () => {
    const now = new Date("2026-04-12T00:00:00.000Z");
    let table = createTable({
      slug: "run-it-twice",
      name: "Run It Twice",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 2,
      startingStack: 5_000,
      blindSchedule,
      autoStartNextHand: true,
      autoStartDelaySeconds: 0,
      runItTwiceEnabled: true,
      passwordProtected: false,
    }, now);

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 }, now);
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 }, now);
    table = setPlayerReady(table, "a", true, now);
    table = setPlayerReady(table, "b", true, now);
    table = startHand(table, {
      now,
      deck: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
        { rank: "A", suit: "hearts" },
        { rank: "Q", suit: "diamonds" },
        { rank: "5", suit: "clubs" },
        { rank: "2", suit: "clubs" },
        { rank: "7", suit: "hearts" },
        { rank: "8", suit: "clubs" },
        { rank: "6", suit: "spades" },
        { rank: "3", suit: "spades" },
        { rank: "J", suit: "hearts" },
        { rank: "9", suit: "clubs" },
        { rank: "4", suit: "hearts" },
        { rank: "2", suit: "diamonds" },
        { rank: "7", suit: "diamonds" },
        { rank: "8", suit: "spades" },
        { rank: "6", suit: "clubs" },
        { rank: "3", suit: "diamonds" },
        { rank: "J", suit: "spades" },
        { rank: "9", suit: "diamonds" },
      ],
    });

    table = applyPlayerAction(table, { accountId: "a", type: "all_in" }, now);
    table = applyPlayerAction(table, { accountId: "b", type: "all_in" }, now);

    expect(table.currentHand?.runItTwicePrompt).toEqual({
      eligibleAccountIds: ["a", "b"],
      responsesByAccountId: {},
      createdAt: now.toISOString(),
    });

    table = applyRunItTwiceDecision(table, { accountId: "a", willing: true }, now);

    expect(table.currentHand?.runItTwicePrompt).toEqual({
      eligibleAccountIds: ["a", "b"],
      responsesByAccountId: { a: "yes" },
      createdAt: now.toISOString(),
    });

    table = applyRunItTwiceDecision(table, { accountId: "b", willing: true }, now);

    expect(table.currentHand?.runItTwicePrompt).toEqual({
      eligibleAccountIds: ["a", "b"],
      responsesByAccountId: { a: "yes", b: "yes" },
      createdAt: now.toISOString(),
    });

    table = resolvePendingRunItTwiceDecision(table, now);

    expect(table.currentHand).toBeNull();
    expect(table.lastCompletedHand?.board).toEqual([
      { rank: "2", suit: "clubs" },
      { rank: "7", suit: "hearts" },
      { rank: "8", suit: "clubs" },
      { rank: "3", suit: "spades" },
      { rank: "9", suit: "clubs" },
    ]);
    expect(table.lastCompletedHand?.winners).toEqual([
      {
        accountId: "a",
        seatIndex: 0,
        amountWon: 5_000,
        netChips: 0,
        finalStack: 5_000,
        handLabel: "Pair",
      },
      {
        accountId: "b",
        seatIndex: 1,
        amountWon: 5_000,
        netChips: 0,
        finalStack: 5_000,
        handLabel: "Flush",
      },
    ]);
    expect(table.lastCompletedHand?.allInRunout).toEqual({
      startBoardCount: 0,
      revealIntervalMs: 2_000,
      revealedAccountIds: ["a", "b"],
      runouts: [
        {
          board: [
            { rank: "2", suit: "clubs" },
            { rank: "7", suit: "hearts" },
            { rank: "8", suit: "clubs" },
            { rank: "3", suit: "spades" },
            { rank: "9", suit: "clubs" },
          ],
          winners: [{ accountId: "a", seatIndex: 0, amountWon: 5_000, handLabel: "Pair" }],
        },
        {
          board: [
            { rank: "2", suit: "diamonds" },
            { rank: "7", suit: "diamonds" },
            { rank: "8", suit: "spades" },
            { rank: "3", suit: "diamonds" },
            { rank: "9", suit: "diamonds" },
          ],
          winners: [{ accountId: "b", seatIndex: 1, amountWon: 5_000, handLabel: "Flush" }],
        },
      ],
    });
    expect(table.players.find((player) => player.accountId === "a")?.stack).toBe(5_000);
    expect(table.players.find((player) => player.accountId === "b")?.stack).toBe(5_000);
    expect(table.nextHandStartsAt).toBe(new Date(now.getTime() + 20_000).toISOString());
  });

  it("falls back to a single runout when any involved player votes no", () => {
    const now = new Date("2026-04-12T00:05:00.000Z");
    let table = createTable({
      slug: "run-it-twice-no",
      name: "Run It Twice No",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 2,
      startingStack: 5_000,
      blindSchedule,
      autoStartNextHand: true,
      autoStartDelaySeconds: 0,
      runItTwiceEnabled: true,
      passwordProtected: false,
    }, now);

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 }, now);
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 }, now);
    table = setPlayerReady(table, "a", true, now);
    table = setPlayerReady(table, "b", true, now);
    table = startHand(table, {
      now,
      deck: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
        { rank: "A", suit: "hearts" },
        { rank: "Q", suit: "diamonds" },
        { rank: "5", suit: "clubs" },
        { rank: "2", suit: "clubs" },
        { rank: "7", suit: "hearts" },
        { rank: "8", suit: "clubs" },
        { rank: "6", suit: "spades" },
        { rank: "3", suit: "spades" },
        { rank: "J", suit: "hearts" },
        { rank: "9", suit: "clubs" },
      ],
    });

    table = applyPlayerAction(table, { accountId: "a", type: "all_in" }, now);
    table = applyPlayerAction(table, { accountId: "b", type: "all_in" }, now);
    table = applyRunItTwiceDecision(table, { accountId: "a", willing: false }, now);

    expect(table.currentHand?.runItTwicePrompt).toEqual({
      eligibleAccountIds: ["a", "b"],
      responsesByAccountId: { a: "no" },
      createdAt: now.toISOString(),
    });

    table = resolvePendingRunItTwiceDecision(table, now);

    expect(table.currentHand).toBeNull();
    expect(table.lastCompletedHand?.allInRunout).toEqual({
      startBoardCount: 0,
      revealIntervalMs: 2_000,
      revealedAccountIds: ["a", "b"],
    });
    expect(table.lastCompletedHand?.board).toEqual([
      { rank: "2", suit: "clubs" },
      { rank: "7", suit: "hearts" },
      { rank: "8", suit: "clubs" },
      { rank: "3", suit: "spades" },
      { rank: "9", suit: "clubs" },
    ]);
  });

  it("defaults unanswered run-it-twice votes to no when the prompt expires", () => {
    const now = new Date("2026-04-12T00:10:00.000Z");
    let table = createTable({
      slug: "run-it-twice-timeout",
      name: "Run It Twice Timeout",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 2,
      startingStack: 5_000,
      blindSchedule,
      autoStartNextHand: true,
      autoStartDelaySeconds: 0,
      runItTwiceEnabled: true,
      passwordProtected: false,
    }, now);

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 }, now);
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 }, now);
    table = setPlayerReady(table, "a", true, now);
    table = setPlayerReady(table, "b", true, now);
    table = startHand(table, {
      now,
      deck: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
        { rank: "A", suit: "hearts" },
        { rank: "Q", suit: "diamonds" },
        { rank: "5", suit: "clubs" },
        { rank: "2", suit: "clubs" },
        { rank: "7", suit: "hearts" },
        { rank: "8", suit: "clubs" },
        { rank: "6", suit: "spades" },
        { rank: "3", suit: "spades" },
        { rank: "J", suit: "hearts" },
        { rank: "9", suit: "clubs" },
      ],
    });

    table = applyPlayerAction(table, { accountId: "a", type: "all_in" }, now);
    table = applyPlayerAction(table, { accountId: "b", type: "all_in" }, now);
    table = applyRunItTwiceDecision(table, { accountId: "a", willing: true }, now);
    table = expirePendingRunItTwiceDecision(table, now);

    expect(table.currentHand?.runItTwicePrompt).toEqual({
      eligibleAccountIds: ["a", "b"],
      responsesByAccountId: { a: "yes", b: "no" },
      createdAt: now.toISOString(),
    });

    table = resolvePendingRunItTwiceDecision(table, now);

    expect(table.currentHand).toBeNull();
    expect(table.lastCompletedHand?.allInRunout).toEqual({
      startBoardCount: 0,
      revealIntervalMs: 2_000,
      revealedAccountIds: ["a", "b"],
    });
  });

  it("awards the pot immediately when everyone else folds", () => {
    let table = createTable({
      slug: "three-way",
      name: "Three Way",
      adminAccountId: "admin-1",
      visibility: "private",
      maxPlayers: 3,
      startingStack: 5_000,
      blindSchedule,
      autoStartNextHand: false,
      autoStartDelaySeconds: 0,
      passwordProtected: false,
    });

    table = seatPlayer(table, { accountId: "a", displayName: "A", seatIndex: 0 });
    table = seatPlayer(table, { accountId: "b", displayName: "B", seatIndex: 1 });
    table = seatPlayer(table, { accountId: "c", displayName: "C", seatIndex: 2 });
    table = setPlayerReady(table, "a", true);
    table = setPlayerReady(table, "b", true);
    table = setPlayerReady(table, "c", true);
    table = startHand(table, { random: () => 0.5 });

    table = applyPlayerAction(table, { accountId: "a", type: "raise", amount: 600 });
    table = applyPlayerAction(table, { accountId: "b", type: "fold" });
    table = applyPlayerAction(table, { accountId: "c", type: "fold" });

    expect(table.currentHand).toBeNull();
    expect(table.lastCompletedHand?.winningReason).toBe("fold");
    expect(table.lastCompletedHand?.winners[0]?.accountId).toBe("a");
    expect(table.lastCompletedHand?.actions.at(-1)?.type).toBe("fold");
    expect(table.lastCompletedHand?.revealedHoleCards).toEqual({});
    expect(table.players.find((player) => player.accountId === "a")?.stack).toBe(5_300);
  });
});
