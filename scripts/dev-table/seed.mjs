// Seeds a bot table on the isolated dev stack (scripts/dev-table/compose.yml).
// Registers a hero account, creates a room, seats the hero plus named bots, and
// starts the first hand. Prints the room URL and the session JSON to put in
// localStorage["river-club-session"].
//
//   node scripts/dev-table/seed.mjs [botCount=7] [slug]
const API = process.env.DEV_API_URL ?? "http://localhost:14100";
const GAME = process.env.DEV_GAME_URL ?? "http://localhost:14200";
const WEB = process.env.DEV_WEB_URL ?? "http://localhost:3100";
const BOT_NAMES = ["Priya", "Rex", "Talia", "Wes", "Mira", "Leo", "Jules", "Nina", "Omar"];

const botCount = Math.min(Number(process.argv[2] ?? 7), BOT_NAMES.length);
const suffix = Date.now().toString(36);
const slug = process.argv[3] ?? `bot-table-${suffix}`;

async function call(base, path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${path}: ${json.error ?? response.status}`);
  }
  return json;
}

const username = `sam${suffix}`;
const session = await call(API, "/v1/auth/register", {
  email: `${username}@example.test`,
  username,
  password: "dev-table-password",
});
const token = session.token;

await call(GAME, "/v1/rooms", {
  slug,
  name: "Friday Night Holdem",
  maxPlayers: 9,
  startingStack: 10_000,
  autoStartNextHand: true,
  autoStartDelaySeconds: 6,
  blindSchedule: [
    { level: 1, smallBlind: 50, bigBlind: 100, durationMinutes: 20 },
    { level: 2, smallBlind: 100, bigBlind: 200, durationMinutes: 20 },
    { level: 3, smallBlind: 200, bigBlind: 400, ante: 50, durationMinutes: 20 },
  ],
}, token);

await call(GAME, `/v1/rooms/${slug}/seat`, { displayName: "Sam", seatIndex: 0 }, token);
await call(GAME, `/v1/rooms/${slug}/ready`, { isReady: true }, token);

for (let index = 0; index < botCount; index += 1) {
  await call(GAME, `/v1/rooms/${slug}/admin/seat-bot`, {
    displayName: BOT_NAMES[index],
    seatIndex: index + 1,
  }, token);
}

if (!process.env.NO_START) {
  await call(GAME, `/v1/rooms/${slug}/start`, {}, token);
}

console.log(JSON.stringify({ url: `${WEB}/rooms/${slug}`, slug, session }, null, 2));
