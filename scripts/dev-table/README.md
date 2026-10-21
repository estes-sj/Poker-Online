# Dev bot table

An isolated stack with a seeded bot game, for layout work and screenshots. It never touches the main stack's database.

```sh
# 1. API + game on :14100/:14200 with their own throwaway Postgres (needs the poker-api/poker-game images from `docker compose build`)
docker compose -f scripts/dev-table/compose.yml up -d

# 2. Web app on :3100 against that stack
cd apps/web && API_INTERNAL_BASE_URL=http://localhost:14100 GAME_INTERNAL_BASE_URL=http://localhost:14200 \
  LIVEKIT_INTERNAL_BASE_URL=http://localhost:17880 HOUSE_RULES_CONFIG_PATH=$PWD/../../config/house-rules.json node_modules/.bin/next dev -p 3100

# 3. Hero "Sam" + 8 named bots, first hand dealt; writes the room URL and session
#    NO_START=1 seats everyone without dealing; SPECTATE=1 leaves the hero standing so open seats show
node scripts/dev-table/seed.mjs 8 > /tmp/seed.json

# 4. Keep the hero playing so hands reach the flop, showdown and the hero's turn
node scripts/dev-table/autoplay.mjs /tmp/seed.json 1800 &

# 5. Phone screenshots (default 393x852 @3x, i.e. iPhone 15/16 Pro), N shots every M ms
CHROMIUM_PATH=/path/to/chrome node scripts/dev-table/shoot.mjs /tmp/seed.json /tmp/shots 12 2500
```

`shoot.mjs` needs `playwright-core` installed outside the repo (`PLAYWRIGHT_DIR`, default `~/.cache/poker-shot`). It signs in by writing the session to localStorage, dismisses the phone-layout notice and hides the Next.js dev badge. Pass width and height as extra arguments for other devices (for example `375 667`).

`media-check.mjs` taps Cam and then Mic on the phone dock, using Chromium's fake camera and microphone against the dev LiveKit (:17880). It checks that each tap turns its device on. Run it on a `NO_START=1` seed.

`/rooms/sample-table` is the static demo table, with mocked camera tiles and reactions. Shoot it with a seed file whose `url` points there.

Tear down with `docker compose -f scripts/dev-table/compose.yml down`. Postgres runs on tmpfs, so data does not survive.
