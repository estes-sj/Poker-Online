const suffix = Date.now().toString(36);
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4100";
const gameBaseUrl = process.env.GAME_BASE_URL ?? "http://localhost:4200";
const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";

async function request(path, options = {}, baseUrl = apiBaseUrl) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${baseUrl}${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function waitForRoomState(slug, predicate, timeoutMs = 15000, intervalMs = 500) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const snapshot = await request(`/v1/rooms/${slug}`, {}, gameBaseUrl);

    if (predicate(snapshot)) {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for room ${slug} to satisfy the expected state.`);
}

async function main() {
  const apiHealth = await request("/health");
  const gameHealth = await request("/health", {}, gameBaseUrl);

  const admin = await request(
    "/v1/auth/register",
    {
      method: "POST",
      body: JSON.stringify({
        email: `admin-${suffix}@example.com`,
        username: `admin-${suffix}`,
        password: "password123",
      }),
    },
    apiBaseUrl
  );

  const guest = await request(
    "/v1/auth/register",
    {
      method: "POST",
      body: JSON.stringify({
        email: `guest-${suffix}@example.com`,
        username: `guest-${suffix}`,
        password: "password123",
      }),
    },
    apiBaseUrl
  );

  const room = await request(
    "/v1/rooms",
    {
      method: "POST",
      body: JSON.stringify({
        name: `Container Smoke ${suffix}`,
        slug: `container-smoke-${suffix}`,
        adminAccountId: admin.account.id,
        password: "tablepass",
        maxPlayers: 6,
        startingStack: 10000,
      }),
    },
    gameBaseUrl
  );

  const mediaToken = await request(
    "/v1/media/token",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${admin.token}`,
      },
      body: JSON.stringify({
        slug: room.slug,
        participantName: "Smoke Admin",
      }),
    },
    apiBaseUrl
  );

  const joined = await request(
    `/v1/rooms/${room.slug}/join`,
    {
      method: "POST",
      body: JSON.stringify({
        accountId: guest.account.id,
        password: "tablepass",
      }),
    },
    gameBaseUrl
  );

  await request(
    `/v1/rooms/${room.slug}/seat`,
    {
      method: "POST",
      body: JSON.stringify({
        accountId: admin.account.id,
        displayName: "Admin",
        seatIndex: 0,
      }),
    },
    gameBaseUrl
  );

  const seatedGuest = await request(
    `/v1/rooms/${room.slug}/seat`,
    {
      method: "POST",
      body: JSON.stringify({
        accountId: guest.account.id,
        displayName: "Guest",
        seatIndex: 1,
      }),
    },
    gameBaseUrl
  );

  await request(
    `/v1/rooms/${room.slug}/ready`,
    {
      method: "POST",
      body: JSON.stringify({
        accountId: admin.account.id,
        isReady: true,
      }),
    },
    gameBaseUrl
  );

  await request(
    `/v1/rooms/${room.slug}/ready`,
    {
      method: "POST",
      body: JSON.stringify({
        accountId: guest.account.id,
        isReady: true,
      }),
    },
    gameBaseUrl
  );

  const started = await request(
    `/v1/rooms/${room.slug}/start`,
    {
      method: "POST",
      body: JSON.stringify({
        accountId: admin.account.id,
      }),
    },
    gameBaseUrl
  );
  let currentSnapshot = started;
  const streetsSeen = new Set(currentSnapshot.currentHand ? [currentSnapshot.currentHand.street] : []);

  for (let turnIndex = 0; turnIndex < 12 && currentSnapshot.currentHand; turnIndex += 1) {
    const actorAccountId = currentSnapshot.currentHand.actorAccountId;

    if (!actorAccountId) {
      break;
    }

    const actorView = await request(`/v1/rooms/${room.slug}?accountId=${actorAccountId}`, {}, gameBaseUrl);
    const actionState = actorView.currentHand?.heroActionState;

    if (!actionState) {
      throw new Error(`Missing heroActionState for actor ${actorAccountId}`);
    }

    const actionType = actionState.allowedActions.includes("call")
      ? "call"
      : actionState.allowedActions.includes("check")
        ? "check"
        : actionState.allowedActions.includes("all_in")
          ? "all_in"
          : actionState.allowedActions[0];

    currentSnapshot = await request(
      `/v1/rooms/${room.slug}/action`,
      {
        method: "POST",
        body: JSON.stringify({
          accountId: actorAccountId,
          actionType,
        }),
      },
      gameBaseUrl
    );

    if (currentSnapshot.currentHand?.street) {
      streetsSeen.add(currentSnapshot.currentHand.street);
    }
  }

  const completed = currentSnapshot;
  const autoStartedSnapshot = completed.lastCompletedHand
    ? await waitForRoomState(room.slug, (snapshot) => {
        return Boolean(snapshot.currentHand && snapshot.currentHand.handNumber === completed.lastCompletedHand.handNumber + 1);
      })
    : null;

  const roomPageResponse = await fetch(`${webBaseUrl}/rooms/${room.slug}?accountId=${admin.account.id}`);
  const roomPageHtml = await roomPageResponse.text();

  if (!roomPageResponse.ok) {
    throw new Error(`GET ${webBaseUrl}/rooms/${room.slug} failed with ${roomPageResponse.status}`);
  }

  console.log(
    JSON.stringify(
      {
        apiHealth,
        gameHealth,
        roomSlug: room.slug,
        roomJoinSucceeded: joined.slug === room.slug,
        seatedPlayers: seatedGuest.players.filter((player) => player.seatIndex !== null).length,
        handCount: started.handCount,
        startedHand: Boolean(started.currentHand),
        reachedFlop: streetsSeen.has("flop"),
        reachedTurn: streetsSeen.has("turn"),
        reachedRiver: streetsSeen.has("river"),
        handResolved: Boolean(completed.lastCompletedHand),
        winningReason: completed.lastCompletedHand?.winningReason ?? null,
        nextHandAutoStarted: Boolean(autoStartedSnapshot?.currentHand),
        autoStartedHandNumber: autoStartedSnapshot?.currentHand?.handNumber ?? null,
        mediaTokenIssued: typeof mediaToken.token === "string" && mediaToken.token.length > 20,
        mediaRoomName: mediaToken.roomName,
        mediaWsUrl: mediaToken.wsUrl,
        webRoomPageContainsRoomName: roomPageHtml.includes(room.name),
        webRoomPageContainsSeatViewPanel: roomPageHtml.includes("Current seat view"),
        webRoomPageContainsActionLog: roomPageHtml.includes("Action log"),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
