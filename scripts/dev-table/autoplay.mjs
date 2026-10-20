// Plays the hero seat from a seed.json so hands run to showdown without a browser.
// Checks when free, calls modest bets, sometimes bets/raises, and folds big bets.
//   node scripts/dev-table/autoplay.mjs <seed.json> [seconds=600]
import { readFileSync } from "node:fs";

const GAME = process.env.DEV_GAME_URL ?? "http://localhost:14200";
const [seedPath, seconds = "600"] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const headers = { "content-type": "application/json", authorization: `Bearer ${seed.session.token}` };
const deadline = Date.now() + Number(seconds) * 1000;

function chooseAction(state, stack) {
  const allowed = new Set(state.allowedActions);
  const roll = Math.random();

  if (allowed.has("check")) {
    if (roll < 0.25 && allowed.has("bet") && state.minRaiseTo) {
      return { actionType: "bet", amount: state.minRaiseTo };
    }
    return { actionType: "check" };
  }

  if (allowed.has("call") && state.callAmount <= stack * 0.3) {
    if (roll < 0.12 && allowed.has("raise") && state.minRaiseTo) {
      return { actionType: "raise", amount: state.minRaiseTo };
    }
    return { actionType: "call" };
  }

  return { actionType: "fold" };
}

while (Date.now() < deadline) {
  try {
    const snapshot = await (await fetch(`${GAME}/v1/rooms/${seed.slug}`, { headers })).json();
    const state = snapshot.currentHand?.heroActionState;
    const hero = snapshot.players?.find((player) => player.accountId === seed.session.account.id);

    if (state?.canAct && hero) {
      const action = chooseAction(state, hero.stack);
      await fetch(`${GAME}/v1/rooms/${seed.slug}/action`, { method: "POST", headers, body: JSON.stringify(action) });
    }
  } catch (error) {
    console.error(error.message);
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
}
