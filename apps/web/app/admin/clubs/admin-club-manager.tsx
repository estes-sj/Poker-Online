"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
    isConfiguredRoomCreationAdmin,
    readStoredBrowserSession,
    type BrowserSessionState,
} from "../../lib/browser-session";
import { buildBrowserHttpUrl, getBrowserGameHttpBaseUrl } from "../../lib/public-service-urls";

interface ClubLeaderboardEntry {
    entryKey: string;
    accountId: string;
    accountIds: string[];
    username: string;
    displayName?: string;
    totalProfit: number;
    gamesPlayed: number;
    updatedAt: string;
    isSynthetic: boolean;
    isVisibleInLeaderboard: boolean;
    isDerivedFromRecordedGames: boolean;
}

interface ClubGameLedgerEntry {
    accountId: string;
    username: string;
    displayName: string;
    hoursPlayed: string | null;
    totalBuyIn: number;
    cashOut: number;
    netResult: number;
    isSynthetic: boolean;
}

interface ClubGameLedger {
    gameId: string;
    label: string;
    playedAt: string;
    importedAt: string;
    entryCount: number;
    ledger: ClubGameLedgerEntry[];
}

interface ClubMemberSummary {
    accountId: string;
    username: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    canManageRooms: boolean;
    isVisibleInLeaderboard: boolean;
    joinedAt: string;
    isSynthetic: boolean;
}

interface ManagedClubSummary {
    clubId: string;
    slug: string;
    name: string;
    ownerAccountId: string;
    ownerUsername: string;
    memberCount: number;
    linkedRoomCount: number;
    createdAt: string;
    updatedAt: string;
    members: ClubMemberSummary[];
    leaderboard: ClubLeaderboardEntry[];
    gameHistory: ClubGameLedger[];
}

interface ClubUserSearchResult {
    accountId: string;
    username: string;
    email: string;
    createdAt: string;
    isMember: boolean;
}

interface LeaderboardDraft {
    totalProfit: string;
    gamesPlayed: string;
    isVisibleInLeaderboard: boolean;
}

interface GameEntryDraft {
    accountId: string;
    username: string;
    displayName: string;
    hoursPlayed: string;
    totalBuyIn: string;
    cashOut: string;
}

interface GameDraft {
    label: string;
    playedAt: string;
    entries: GameEntryDraft[];
}

interface AdminClubManagerProps {
    roomCreationPolicy: {
        adminOnly: boolean;
        adminUsername: string | null;
    };
}

export function AdminClubManager({ roomCreationPolicy }: AdminClubManagerProps) {
    const [session, setSession] = useState<BrowserSessionState | null>(null);
    const [clubs, setClubs] = useState<ManagedClubSummary[]>([]);
    const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
    const [createClubName, setCreateClubName] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<ClubUserSearchResult[]>([]);
    const [importDisplayName, setImportDisplayName] = useState("");
    const [importTotalProfit, setImportTotalProfit] = useState("0");
    const [importGamesPlayed, setImportGamesPlayed] = useState("0");
    const [leaderboardDrafts, setLeaderboardDrafts] = useState<Record<string, LeaderboardDraft>>({});
    const [gameDrafts, setGameDrafts] = useState<Record<string, GameDraft>>({});
    const [newGameDraft, setNewGameDraft] = useState<GameDraft | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
    const [isMembersExpanded, setIsMembersExpanded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isCreatingClub, setIsCreatingClub] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [isMutating, setIsMutating] = useState(false);

    const canManageClubs = Boolean(
        session
        && isConfiguredRoomCreationAdmin(session.account.username, roomCreationPolicy.adminUsername),
    );
    const activeClub = clubs.find((club) => club.clubId === selectedClubId) ?? clubs[0] ?? null;
    const selectedGame = activeClub?.gameHistory.find((game) => game.gameId === selectedGameId) ?? activeClub?.gameHistory[0] ?? null;
    const selectedGameDraft = selectedGame ? (gameDrafts[selectedGame.gameId] ?? buildGameDraft(selectedGame)) : null;

    useEffect(() => {
        const storedSession = readStoredBrowserSession();

        setSession(storedSession);

        if (!storedSession || !isConfiguredRoomCreationAdmin(storedSession.account.username, roomCreationPolicy.adminUsername)) {
            setIsLoading(false);
            return;
        }

        void loadClubs(storedSession.token, true);
    }, [roomCreationPolicy.adminUsername]);

    useEffect(() => {
        if (!activeClub) {
            return;
        }

        setLeaderboardDrafts((currentDrafts) => ({
            ...currentDrafts,
            ...Object.fromEntries(activeClub.leaderboard.map((entry) => [entry.entryKey, {
                totalProfit: String(entry.totalProfit),
                gamesPlayed: String(entry.gamesPlayed),
                isVisibleInLeaderboard: entry.isVisibleInLeaderboard,
            }])),
        }));
        setGameDrafts((currentDrafts) => ({
            ...currentDrafts,
            ...buildGameDraftPatch(activeClub.gameHistory),
        }));
    }, [activeClub]);

    useEffect(() => {
        if (!activeClub) {
            setSelectedGameId(null);
            return;
        }

        setSelectedGameId((currentGameId) => (
            currentGameId && activeClub.gameHistory.some((game) => game.gameId === currentGameId)
                ? currentGameId
                : activeClub.gameHistory[0]?.gameId ?? null
        ));
    }, [activeClub]);

    useEffect(() => {
        if (!activeClub) {
            setNewGameDraft(null);
            setIsMembersExpanded(false);
            return;
        }

        setNewGameDraft(buildNewGameDraft(activeClub.members));
        setIsMembersExpanded(false);
    }, [activeClub?.clubId]);

    async function loadClubs(token: string, initialLoad = false) {
        if (initialLoad) {
            setIsLoading(true);
        } else {
            setIsRefreshing(true);
        }

        setError(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, "/v1/admin/clubs"), {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const payload = (await response.json()) as ManagedClubSummary[] | { error?: string };

            if (!response.ok || !Array.isArray(payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to load clubs.");
            }

            setClubs(payload);
            setSelectedClubId((currentClubId) => {
                if (currentClubId && payload.some((club) => club.clubId === currentClubId)) {
                    return currentClubId;
                }

                return payload[0]?.clubId ?? null;
            });
            setLeaderboardDrafts((currentDrafts) => ({
                ...currentDrafts,
                ...Object.fromEntries(payload.flatMap((club) => club.leaderboard.map((entry) => [entry.entryKey, {
                    totalProfit: String(entry.totalProfit),
                    gamesPlayed: String(entry.gamesPlayed),
                    isVisibleInLeaderboard: entry.isVisibleInLeaderboard,
                }]))),
            }));
            setGameDrafts((currentDrafts) => ({
                ...currentDrafts,
                ...Object.fromEntries(payload.flatMap((club) => club.gameHistory.map((game) => [game.gameId, buildGameDraft(game)]))),
            }));
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Unable to load clubs.");
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }

    function applyClubUpdate(updatedClub: ManagedClubSummary, noticeMessage?: string) {
        setClubs((currentClubs) => {
            const exists = currentClubs.some((club) => club.clubId === updatedClub.clubId);
            const nextClubs = exists
                ? currentClubs.map((club) => club.clubId === updatedClub.clubId ? updatedClub : club)
                : [...currentClubs, updatedClub];

            return nextClubs.slice().sort((left, right) => left.name.localeCompare(right.name));
        });
        setSelectedClubId(updatedClub.clubId);
        setSearchResults([]);
        setLeaderboardDrafts((currentDrafts) => ({
            ...currentDrafts,
            ...Object.fromEntries(updatedClub.leaderboard.map((entry) => [entry.entryKey, {
                totalProfit: String(entry.totalProfit),
                gamesPlayed: String(entry.gamesPlayed),
                isVisibleInLeaderboard: entry.isVisibleInLeaderboard,
            }])),
        }));
        setGameDrafts((currentDrafts) => ({
            ...currentDrafts,
            ...buildGameDraftPatch(updatedClub.gameHistory),
        }));

        if (noticeMessage) {
            setNotice(noticeMessage);
        }
    }

    async function handleCreateClub(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!session) {
            setError("Sign in as the admin before creating clubs.");
            return;
        }

        const name = createClubName.trim();

        if (name.length < 2) {
            setError("Club name must contain at least 2 characters.");
            return;
        }

        setIsCreatingClub(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, "/v1/admin/clubs"), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ name }),
            });

            const payload = (await response.json()) as ManagedClubSummary | { error?: string };

            if (!response.ok || !("clubId" in payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to create club.");
            }

            setCreateClubName("");
            applyClubUpdate(payload, `Created club ${payload.name}.`);
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : "Unable to create club.");
        } finally {
            setIsCreatingClub(false);
        }
    }

    async function handleSearchUsers(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!session || !activeClub) {
            setError("Load a club before searching for members.");
            return;
        }

        const query = searchQuery.trim();

        if (query.length < 2) {
            setError("Enter at least 2 characters before searching users.");
            return;
        }

        setIsSearching(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const url = new URL(buildBrowserHttpUrl(gameBaseUrl, "/v1/admin/users/search"), window.location.origin);
            url.searchParams.set("query", query);
            url.searchParams.set("clubId", activeClub.clubId);

            const response = await fetch(url.toString(), {
                headers: {
                    Authorization: `Bearer ${session.token}`,
                },
            });

            const payload = (await response.json()) as ClubUserSearchResult[] | { error?: string };

            if (!response.ok || !Array.isArray(payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to search users.");
            }

            setSearchResults(payload);
        } catch (searchError) {
            setError(searchError instanceof Error ? searchError.message : "Unable to search users.");
        } finally {
            setIsSearching(false);
        }
    }

    async function handleAddMember(accountId: string) {
        if (!session || !activeClub) {
            return;
        }

        setIsMutating(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, `/v1/admin/clubs/${activeClub.clubId}/members`), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ accountId }),
            });

            const payload = (await response.json()) as ManagedClubSummary | { error?: string };

            if (!response.ok || !("clubId" in payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to add club member.");
            }

            applyClubUpdate(payload, "Added account to the club.");
        } catch (mutationError) {
            setError(mutationError instanceof Error ? mutationError.message : "Unable to add club member.");
        } finally {
            setIsMutating(false);
        }
    }

    async function handleCreateImportedPlayer(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!session || !activeClub) {
            setError("Load a club before creating imported players.");
            return;
        }

        let totalProfit = 0;
        let gamesPlayed = 0;

        try {
            totalProfit = parseWholeNumber(importTotalProfit, "Total profit", true);
            gamesPlayed = parseWholeNumber(importGamesPlayed, "Games played");
        } catch (parseError) {
            setError(parseError instanceof Error ? parseError.message : "Enter whole-number leaderboard values.");
            return;
        }

        setIsMutating(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, `/v1/admin/clubs/${activeClub.clubId}/leaderboard/import-player`), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    displayName: importDisplayName,
                    totalProfit,
                    gamesPlayed,
                }),
            });

            const payload = (await response.json()) as ManagedClubSummary | { error?: string };

            if (!response.ok || !("clubId" in payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to create imported player.");
            }

            setImportDisplayName("");
            setImportTotalProfit("0");
            setImportGamesPlayed("0");
            applyClubUpdate(payload, "Created imported leaderboard entry.");
        } catch (mutationError) {
            setError(mutationError instanceof Error ? mutationError.message : "Unable to create imported player.");
        } finally {
            setIsMutating(false);
        }
    }

    async function handleSaveEntry(entry: ClubLeaderboardEntry) {
        if (!session || !activeClub) {
            return;
        }

        const draft = leaderboardDrafts[entry.entryKey];

        if (!draft) {
            return;
        }

        setIsMutating(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, `/v1/admin/clubs/${activeClub.clubId}/leaderboard/${entry.accountId}`), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    accountIds: entry.accountIds,
                    displayName: entry.displayName ?? entry.username,
                    isVisibleInLeaderboard: draft.isVisibleInLeaderboard,
                }),
            });

            const payload = (await response.json()) as ManagedClubSummary | { error?: string };

            if (!response.ok || !("clubId" in payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to update leaderboard entry.");
            }

            applyClubUpdate(payload, "Updated leaderboard entry.");
        } catch (mutationError) {
            setError(mutationError instanceof Error ? mutationError.message : "Unable to update leaderboard entry.");
        } finally {
            setIsMutating(false);
        }
    }

    function handleVisibilityDraftChange(entryKey: string, isVisibleInLeaderboard: boolean) {
        setLeaderboardDrafts((currentDrafts) => ({
            ...currentDrafts,
            [entryKey]: {
                totalProfit: currentDrafts[entryKey]?.totalProfit ?? "0",
                gamesPlayed: currentDrafts[entryKey]?.gamesPlayed ?? "0",
                isVisibleInLeaderboard,
            },
        }));
    }

    function handleGameDraftChange(gameId: string, field: keyof Omit<GameDraft, "entries">, value: string) {
        if (!activeClub) {
            return;
        }

        const sourceGame = activeClub.gameHistory.find((game) => game.gameId === gameId);

        if (!sourceGame) {
            return;
        }

        setGameDrafts((currentDrafts) => ({
            ...currentDrafts,
            [gameId]: {
                ...(currentDrafts[gameId] ?? buildGameDraft(sourceGame)),
                [field]: value,
            },
        }));
    }

    function handleGameEntryDraftChange(gameId: string, accountId: string, field: keyof GameEntryDraft, value: string) {
        if (!activeClub) {
            return;
        }

        const sourceGame = activeClub.gameHistory.find((game) => game.gameId === gameId);

        if (!sourceGame) {
            return;
        }

        setGameDrafts((currentDrafts) => {
            const currentDraft = currentDrafts[gameId] ?? buildGameDraft(sourceGame);

            return {
                ...currentDrafts,
                [gameId]: {
                    ...currentDraft,
                    entries: currentDraft.entries.map((entry) => (
                        entry.accountId === accountId
                            ? {
                                ...entry,
                                [field]: value,
                            }
                            : entry
                    )),
                },
            };
        });
    }

    function handleNewGameDraftChange(field: keyof Omit<GameDraft, "entries">, value: string) {
        setNewGameDraft((currentDraft) => (
            currentDraft
                ? {
                    ...currentDraft,
                    [field]: value,
                }
                : currentDraft
        ));
    }

    function handleNewGameEntryDraftChange(accountId: string, field: keyof GameEntryDraft, value: string) {
        setNewGameDraft((currentDraft) => {
            if (!currentDraft) {
                return currentDraft;
            }

            return {
                ...currentDraft,
                entries: currentDraft.entries.map((entry) => (
                    entry.accountId === accountId
                        ? {
                            ...entry,
                            [field]: value,
                        }
                        : entry
                )),
            };
        });
    }

    function handleRemoveNewGameEntry(accountId: string) {
        setNewGameDraft((currentDraft) => {
            if (!currentDraft) {
                return currentDraft;
            }

            return {
                ...currentDraft,
                entries: currentDraft.entries.filter((entry) => entry.accountId !== accountId),
            };
        });
    }

    function handleResetNewGamePlayers() {
        if (!activeClub) {
            return;
        }

        setNewGameDraft((currentDraft) => ({
            label: currentDraft?.label ?? "",
            playedAt: currentDraft?.playedAt ?? buildNewGameDraft(activeClub.members).playedAt,
            entries: buildNewGameDraft(activeClub.members).entries,
        }));
    }

    async function handleSaveGame(gameId: string) {
        if (!session || !activeClub) {
            return;
        }

        const sourceGame = activeClub.gameHistory.find((game) => game.gameId === gameId);
        const draft = sourceGame ? (gameDrafts[gameId] ?? buildGameDraft(sourceGame)) : null;

        if (!draft) {
            return;
        }

        let entries;

        try {
            const label = draft.label.trim();
            const playedAt = draft.playedAt.trim();

            if (!label.length) {
                throw new Error("Game label must not be empty.");
            }

            if (!playedAt.length) {
                throw new Error("Played date must not be empty.");
            }

            entries = draft.entries.map((entry) => ({
                accountId: entry.accountId,
                displayName: entry.displayName.trim(),
                hoursPlayed: entry.hoursPlayed.trim() || null,
                totalBuyIn: parseWholeNumber(entry.totalBuyIn, "Total buy-in"),
                cashOut: parseWholeNumber(entry.cashOut, "Cash-out"),
            }));
        } catch (parseError) {
            setError(parseError instanceof Error ? parseError.message : "Enter valid game ledger values.");
            return;
        }

        setIsMutating(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, `/v1/admin/clubs/${activeClub.clubId}/games/${gameId}`), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    label: draft.label.trim(),
                    playedAt: draft.playedAt.trim(),
                    entries,
                }),
            });

            const payload = (await response.json()) as ManagedClubSummary | { error?: string };

            if (!response.ok || !("clubId" in payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to update imported game.");
            }

            applyClubUpdate(payload, `Updated game ${draft.label.trim()}.`);
        } catch (mutationError) {
            setError(mutationError instanceof Error ? mutationError.message : "Unable to update imported game.");
        } finally {
            setIsMutating(false);
        }
    }

    async function handleCreateGame(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!session || !activeClub || !newGameDraft) {
            setError("Load a club before creating a recorded game.");
            return;
        }

        const existingGameIds = new Set(activeClub.gameHistory.map((game) => game.gameId));
        let entries;
        let label = "";
        let playedAt = "";

        try {
            label = newGameDraft.label.trim();
            playedAt = newGameDraft.playedAt.trim();

            if (!label.length) {
                throw new Error("Game label must not be empty.");
            }

            if (!playedAt.length) {
                throw new Error("Played date must not be empty.");
            }

            entries = newGameDraft.entries.map((entry) => ({
                accountId: entry.accountId,
                displayName: entry.displayName.trim(),
                hoursPlayed: entry.hoursPlayed.trim() || null,
                totalBuyIn: parseWholeNumber(entry.totalBuyIn, "Total buy-in"),
                cashOut: parseWholeNumber(entry.cashOut, "Cash-out"),
            }));

            if (entries.length === 0) {
                throw new Error("Games must include at least one ledger entry.");
            }
        } catch (parseError) {
            setError(parseError instanceof Error ? parseError.message : "Enter valid game ledger values.");
            return;
        }

        setIsMutating(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, `/v1/admin/clubs/${activeClub.clubId}/games`), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    label,
                    playedAt,
                    entries,
                }),
            });

            const payload = (await response.json()) as ManagedClubSummary | { error?: string };

            if (!response.ok || !("clubId" in payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to create recorded game.");
            }

            const createdGame = payload.gameHistory.find((game) => !existingGameIds.has(game.gameId)) ?? null;

            applyClubUpdate(payload, `Created game ${label}.`);
            setSelectedGameId(createdGame?.gameId ?? null);
            setNewGameDraft(buildNewGameDraft(payload.members));
        } catch (mutationError) {
            setError(mutationError instanceof Error ? mutationError.message : "Unable to create recorded game.");
        } finally {
            setIsMutating(false);
        }
    }

    if (!canManageClubs) {
        return (
            <section className="ui-panel admin-club-manager__panel">
                <div className="admin-room-manager__empty-state">
                    <p className="muted-copy">Sign in as the configured admin account to manage clubs.</p>
                </div>
            </section>
        );
    }

    return (
        <section className="ui-panel admin-club-manager__panel">
            <header className="admin-club-manager__header">
                <div>
                    <span className="ui-panel__eyebrow">Club administration</span>
                    <h2 className="ui-panel__title">Leaderboards, memberships, and recorded games</h2>
                </div>
                <div className="status-card__actions">
                    <button className="button button--secondary" type="button" onClick={() => session ? void loadClubs(session.token) : undefined} disabled={isRefreshing || isMutating}>
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                    </button>
                </div>
            </header>

            <div className="ui-panel__body admin-club-manager__content">
                <div className="admin-club-manager__toolbar">
                    <div className="admin-room-manager__toolbar-copy">
                        <strong>Clubs use the existing room ledger data.</strong>
                        <p className="muted-copy">Tie a room to a club and every settled hand updates that club's all-time ranking. Recorded games can be added and edited here.</p>
                    </div>

                    <form className="admin-club-manager__create-form" onSubmit={handleCreateClub}>
                        <input
                            className="control-input"
                            type="text"
                            value={createClubName}
                            onChange={(event) => setCreateClubName(event.target.value)}
                            placeholder="New club name"
                        />
                        <button className="button button--primary" type="submit" disabled={isCreatingClub}>
                            {isCreatingClub ? "Creating..." : "Create club"}
                        </button>
                    </form>
                </div>

                {error ? <p className="admin-room-manager__feedback">{error}</p> : null}
                {notice ? <p className="admin-room-manager__feedback admin-room-manager__feedback--notice">{notice}</p> : null}

                {isLoading ? (
                    <div className="admin-room-manager__empty-state">
                        <p className="muted-copy">Loading club manager...</p>
                    </div>
                ) : clubs.length === 0 ? (
                    <div className="admin-room-manager__empty-state">
                        <p className="muted-copy">Create the first club to start building a leaderboard.</p>
                    </div>
                ) : activeClub ? (
                    <div className="admin-club-manager__workspace">
                        <aside className="admin-club-manager__club-list">
                            {clubs.map((club) => (
                                <button
                                    key={club.clubId}
                                    className={[
                                        "admin-club-manager__club-button",
                                        club.clubId === activeClub.clubId ? "admin-club-manager__club-button--active" : "",
                                    ].filter(Boolean).join(" ")}
                                    type="button"
                                    onClick={() => setSelectedClubId(club.clubId)}
                                >
                                    <strong>{club.name}</strong>
                                    <span>{club.memberCount} members</span>
                                    <span>{club.linkedRoomCount} linked rooms</span>
                                </button>
                            ))}
                        </aside>

                        <div className="admin-club-manager__detail">
                            <div className="admin-club-manager__detail-header">
                                <div>
                                    <span className="eyebrow">Selected club</span>
                                    <h3>{activeClub.name}</h3>
                                    <p className="muted-copy">Owned by {activeClub.ownerUsername}. Public leaderboard: <Link href={`/clubs/${activeClub.slug}`}>{activeClub.slug}</Link></p>
                                </div>

                                <div className="status-card__actions">
                                    <Link className="button button--secondary" href={`/clubs/${activeClub.slug}`}>
                                        Open public leaderboard
                                    </Link>
                                </div>
                            </div>

                            <div className="admin-club-manager__metrics">
                                <article className="admin-club-manager__metric">
                                    <strong>{activeClub.memberCount}</strong>
                                    <span>Members</span>
                                </article>
                                <article className="admin-club-manager__metric">
                                    <strong>{activeClub.linkedRoomCount}</strong>
                                    <span>Linked rooms</span>
                                </article>
                                <article className="admin-club-manager__metric">
                                    <strong>{activeClub.leaderboard.length}</strong>
                                    <span>Leaderboard entries</span>
                                </article>
                                <article className="admin-club-manager__metric">
                                    <strong>{activeClub.gameHistory.length}</strong>
                                    <span>Recorded games</span>
                                </article>
                            </div>

                            <div className="admin-club-manager__forms">
                                <section className="admin-club-manager__section">
                                    <div className="admin-club-manager__section-header">
                                        <div>
                                            <strong>Add existing user</strong>
                                            <p className="muted-copy">Search registered accounts and add them directly to the club.</p>
                                        </div>
                                    </div>

                                    <form className="admin-club-manager__search-form" onSubmit={handleSearchUsers}>
                                        <div className="admin-club-manager__search-row">
                                            <input
                                                className="control-input"
                                                type="text"
                                                value={searchQuery}
                                                onChange={(event) => setSearchQuery(event.target.value)}
                                                placeholder="Search by username or email"
                                            />
                                            <button className="button button--secondary" type="submit" disabled={isSearching}>
                                                {isSearching ? "Searching..." : "Search"}
                                            </button>
                                        </div>
                                    </form>

                                    {searchResults.length ? (
                                        <div className="table-admin-list">
                                            {searchResults.map((result) => (
                                                <article key={result.accountId} className="table-admin-list__item">
                                                    <div>
                                                        <strong>{result.username}</strong>
                                                        <span>{result.email}</span>
                                                    </div>
                                                    <button
                                                        className="button button--secondary"
                                                        type="button"
                                                        onClick={() => void handleAddMember(result.accountId)}
                                                        disabled={isMutating || result.isMember}
                                                    >
                                                        {result.isMember ? "Already added" : "Add to club"}
                                                    </button>
                                                </article>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="muted-copy">Search results will appear here.</p>
                                    )}
                                </section>

                                <section className="admin-club-manager__section">
                                    <div className="admin-club-manager__section-header">
                                        <div>
                                            <strong>Add imported player</strong>
                                            <p className="muted-copy">Create a synthetic account for legacy PokerNow results or UI testing.</p>
                                        </div>
                                    </div>

                                    <form className="admin-club-manager__import-form" onSubmit={handleCreateImportedPlayer}>
                                        <input
                                            className="control-input"
                                            type="text"
                                            value={importDisplayName}
                                            onChange={(event) => setImportDisplayName(event.target.value)}
                                            placeholder="Imported player name"
                                        />
                                        <div className="control-grid">
                                            <input
                                                className="control-input"
                                                type="number"
                                                step={1}
                                                value={importTotalProfit}
                                                onChange={(event) => setImportTotalProfit(event.target.value)}
                                                placeholder="Total profit"
                                            />
                                            <input
                                                className="control-input"
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={importGamesPlayed}
                                                onChange={(event) => setImportGamesPlayed(event.target.value)}
                                                placeholder="Games played"
                                            />
                                        </div>
                                        <button className="button button--primary" type="submit" disabled={isMutating}>
                                            {isMutating ? "Saving..." : "Create imported entry"}
                                        </button>
                                    </form>
                                </section>
                            </div>

                            <section className="admin-club-manager__section">
                                <div className="admin-club-manager__section-header">
                                    <div>
                                        <strong>Members</strong>
                                        <p className="muted-copy">Synthetic imported players appear here alongside registered accounts.</p>
                                    </div>

                                    <div className="status-card__actions">
                                        <button
                                            className="button button--secondary"
                                            type="button"
                                            onClick={() => setIsMembersExpanded((currentValue) => !currentValue)}
                                        >
                                            {isMembersExpanded ? "Collapse" : `Expand (${activeClub.memberCount})`}
                                        </button>
                                    </div>
                                </div>

                                {isMembersExpanded ? (
                                    <div className="table-admin-list">
                                        {activeClub.members.map((member) => (
                                            <article key={member.accountId} className="table-admin-list__item">
                                                <div>
                                                    <strong>{member.username}</strong>
                                                    <span>{member.email}</span>
                                                </div>
                                                <div className="admin-club-manager__member-meta">
                                                    <span>{member.role}</span>
                                                    <span>{member.isSynthetic ? "Imported" : "Account"}</span>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="muted-copy">Members are collapsed by default. Expand this section to review the full roster.</p>
                                )}
                            </section>

                            <section className="admin-club-manager__section">
                                <div className="admin-club-manager__section-header">
                                    <div>
                                        <strong>Leaderboard entries</strong>
                                        <p className="muted-copy">Recorded display names appear here automatically. Profit and games totals are read-only here; use recorded games to change them and use this table for visibility only.</p>
                                    </div>
                                </div>

                                {activeClub.leaderboard.length ? (
                                    <div className="admin-club-manager__table-wrap">
                                        <table className="admin-club-manager__table">
                                            <thead>
                                                <tr>
                                                    <th scope="col">Player</th>
                                                    <th scope="col">Profit</th>
                                                    <th scope="col">Games</th>
                                                    <th scope="col">Visible</th>
                                                    <th scope="col">Type</th>
                                                    <th scope="col">Save</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {activeClub.leaderboard.map((entry) => {
                                                    const draft = leaderboardDrafts[entry.entryKey] ?? {
                                                        totalProfit: String(entry.totalProfit),
                                                        gamesPlayed: String(entry.gamesPlayed),
                                                        isVisibleInLeaderboard: entry.isVisibleInLeaderboard,
                                                    };

                                                    return (
                                                        <tr key={entry.entryKey}>
                                                            <td>
                                                                <div className="admin-club-manager__table-player">
                                                                    <strong>{entry.displayName ?? entry.username}</strong>
                                                                    <span>{entry.isDerivedFromRecordedGames ? (entry.accountIds.length > 1 ? `${entry.accountIds.length} recorded accounts grouped under this display name` : "Derived from recorded games") : entry.isSynthetic ? "Imported player" : "Registered account"}</span>
                                                                </div>
                                                            </td>
                                                            <td className={[
                                                                "admin-club-manager__result",
                                                                entry.totalProfit > 0 ? "admin-club-manager__result--positive" : "",
                                                                entry.totalProfit < 0 ? "admin-club-manager__result--negative" : "",
                                                            ].filter(Boolean).join(" ")}>
                                                                {formatSignedChipAmount(entry.totalProfit)}
                                                            </td>
                                                            <td>{entry.gamesPlayed}</td>
                                                            <td>
                                                                <label>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={draft.isVisibleInLeaderboard}
                                                                        onChange={(event) => handleVisibilityDraftChange(entry.entryKey, event.target.checked)}
                                                                        disabled={isMutating}
                                                                    /> {draft.isVisibleInLeaderboard ? "Shown" : "Hidden"}
                                                                </label>
                                                            </td>
                                                            <td>{entry.isDerivedFromRecordedGames ? "Recorded" : entry.isSynthetic ? "Imported" : "Account"}</td>
                                                            <td>
                                                                <button className="button button--secondary" type="button" onClick={() => void handleSaveEntry(entry)} disabled={isMutating}>
                                                                    Save visibility
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="muted-copy">No leaderboard rows exist yet. Imported players, recorded sessions, or club-linked hands will populate this list.</p>
                                )}
                            </section>

                            <section className="admin-club-manager__section">
                                <div className="admin-club-manager__section-header">
                                    <div>
                                        <strong>Recorded games</strong>
                                        <p className="muted-copy">Add a recorded game with a row for each player, then page through existing games by label or date. Saving a game recalculates the affected leaderboard totals.</p>
                                    </div>
                                </div>

                                {newGameDraft ? (
                                    <form className="club-game-card admin-club-manager__game-card admin-club-manager__game-create" onSubmit={handleCreateGame}>
                                        <div className="club-game-card__header">
                                            <div className="admin-club-manager__game-fields">
                                                <label className="admin-club-manager__field">
                                                    <span>New game label</span>
                                                    <input
                                                        className="control-input"
                                                        type="text"
                                                        value={newGameDraft.label}
                                                        onChange={(event) => handleNewGameDraftChange("label", event.target.value)}
                                                        placeholder="Friday cash game"
                                                    />
                                                </label>
                                                <label className="admin-club-manager__field admin-club-manager__field--compact">
                                                    <span>Played at</span>
                                                    <input
                                                        className="control-input"
                                                        type="date"
                                                        value={newGameDraft.playedAt}
                                                        onChange={(event) => handleNewGameDraftChange("playedAt", event.target.value)}
                                                    />
                                                </label>
                                            </div>

                                            <div className="admin-club-manager__game-actions">
                                                <div className="club-game-card__meta">
                                                    <span>{newGameDraft.entries.length} players</span>
                                                    <span>Seeded from the current club roster</span>
                                                </div>
                                                <div className="status-card__actions">
                                                    <button className="button button--secondary" type="button" onClick={handleResetNewGamePlayers} disabled={isMutating}>
                                                        Reset players
                                                    </button>
                                                    <button className="button button--primary" type="submit" disabled={isMutating}>
                                                        {isMutating ? "Saving..." : "Create game"}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="admin-club-manager__table-wrap">
                                            <table className="admin-club-manager__table">
                                                <thead>
                                                    <tr>
                                                        <th scope="col">Player</th>
                                                        <th scope="col">Hours</th>
                                                        <th scope="col">Buy-in</th>
                                                        <th scope="col">Cash-out</th>
                                                        <th scope="col">Result</th>
                                                        <th scope="col">Row</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {newGameDraft.entries.map((entry) => {
                                                        const netResult = getDraftNetResult(entry);

                                                        return (
                                                            <tr key={entry.accountId}>
                                                                <td>
                                                                    <div className="admin-club-manager__table-player">
                                                                        <input
                                                                            className="control-input"
                                                                            type="text"
                                                                            value={entry.displayName}
                                                                            onChange={(event) => handleNewGameEntryDraftChange(entry.accountId, "displayName", event.target.value)}
                                                                        />
                                                                        <span>{entry.username}</span>
                                                                    </div>
                                                                </td>
                                                                <td>
                                                                    <input
                                                                        className="control-input"
                                                                        type="text"
                                                                        value={entry.hoursPlayed}
                                                                        onChange={(event) => handleNewGameEntryDraftChange(entry.accountId, "hoursPlayed", event.target.value)}
                                                                        placeholder="Optional"
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <input
                                                                        className="control-input"
                                                                        type="number"
                                                                        min={0}
                                                                        step={1}
                                                                        value={entry.totalBuyIn}
                                                                        onChange={(event) => handleNewGameEntryDraftChange(entry.accountId, "totalBuyIn", event.target.value)}
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <input
                                                                        className="control-input"
                                                                        type="number"
                                                                        min={0}
                                                                        step={1}
                                                                        value={entry.cashOut}
                                                                        onChange={(event) => handleNewGameEntryDraftChange(entry.accountId, "cashOut", event.target.value)}
                                                                    />
                                                                </td>
                                                                <td className={[
                                                                    "admin-club-manager__result",
                                                                    netResult !== null && netResult > 0 ? "admin-club-manager__result--positive" : "",
                                                                    netResult !== null && netResult < 0 ? "admin-club-manager__result--negative" : "",
                                                                ].filter(Boolean).join(" ")}>
                                                                    {netResult === null ? "--" : formatSignedChipAmount(netResult)}
                                                                </td>
                                                                <td>
                                                                    <button
                                                                        className="button button--secondary"
                                                                        type="button"
                                                                        onClick={() => handleRemoveNewGameEntry(entry.accountId)}
                                                                        disabled={isMutating}
                                                                    >
                                                                        Remove
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {newGameDraft.entries.length === 0 ? (
                                            <p className="muted-copy">Reset players to restore the current club roster before saving.</p>
                                        ) : null}
                                    </form>
                                ) : null}

                                {activeClub.gameHistory.length ? (
                                    <div className="admin-club-manager__game-workspace">
                                        <div className="admin-club-manager__game-pagination">
                                            {activeClub.gameHistory.map((game) => (
                                                <button
                                                    key={game.gameId}
                                                    className={[
                                                        "admin-club-manager__game-page",
                                                        game.gameId === selectedGame?.gameId ? "admin-club-manager__game-page--active" : "",
                                                    ].filter(Boolean).join(" ")}
                                                    type="button"
                                                    onClick={() => setSelectedGameId(game.gameId)}
                                                >
                                                    <strong>{game.label}</strong>
                                                    <span>{formatDateLabel(game.playedAt)}</span>
                                                </button>
                                            ))}
                                        </div>

                                        {selectedGame && selectedGameDraft ? (
                                            <article className="club-game-card admin-club-manager__game-card">
                                                <div className="club-game-card__header">
                                                    <div className="admin-club-manager__game-fields">
                                                        <label className="admin-club-manager__field">
                                                            <span>Label</span>
                                                            <input
                                                                className="control-input"
                                                                type="text"
                                                                value={selectedGameDraft.label}
                                                                onChange={(event) => handleGameDraftChange(selectedGame.gameId, "label", event.target.value)}
                                                            />
                                                        </label>
                                                        <label className="admin-club-manager__field admin-club-manager__field--compact">
                                                            <span>Played at</span>
                                                            <input
                                                                className="control-input"
                                                                type="date"
                                                                value={selectedGameDraft.playedAt}
                                                                onChange={(event) => handleGameDraftChange(selectedGame.gameId, "playedAt", event.target.value)}
                                                            />
                                                        </label>
                                                    </div>

                                                    <div className="admin-club-manager__game-actions">
                                                        <div className="club-game-card__meta">
                                                            <span>{selectedGameDraft.entries.length} players</span>
                                                            <span>Recorded {formatTimestamp(selectedGame.importedAt)}</span>
                                                        </div>
                                                        <button className="button button--secondary" type="button" onClick={() => void handleSaveGame(selectedGame.gameId)} disabled={isMutating}>
                                                            {isMutating ? "Saving..." : "Save game"}
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="admin-club-manager__table-wrap">
                                                    <table className="admin-club-manager__table">
                                                        <thead>
                                                            <tr>
                                                                <th scope="col">Player</th>
                                                                <th scope="col">Hours</th>
                                                                <th scope="col">Buy-in</th>
                                                                <th scope="col">Cash-out</th>
                                                                <th scope="col">Result</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {selectedGameDraft.entries.map((entry) => {
                                                                const netResult = getDraftNetResult(entry);

                                                                return (
                                                                    <tr key={entry.accountId}>
                                                                        <td>
                                                                            <div className="admin-club-manager__table-player">
                                                                                <input
                                                                                    className="control-input"
                                                                                    type="text"
                                                                                    value={entry.displayName}
                                                                                    onChange={(event) => handleGameEntryDraftChange(selectedGame.gameId, entry.accountId, "displayName", event.target.value)}
                                                                                />
                                                                                <span>{entry.username}</span>
                                                                            </div>
                                                                        </td>
                                                                        <td>
                                                                            <input
                                                                                className="control-input"
                                                                                type="text"
                                                                                value={entry.hoursPlayed}
                                                                                onChange={(event) => handleGameEntryDraftChange(selectedGame.gameId, entry.accountId, "hoursPlayed", event.target.value)}
                                                                                placeholder="Optional"
                                                                            />
                                                                        </td>
                                                                        <td>
                                                                            <input
                                                                                className="control-input"
                                                                                type="number"
                                                                                min={0}
                                                                                step={1}
                                                                                value={entry.totalBuyIn}
                                                                                onChange={(event) => handleGameEntryDraftChange(selectedGame.gameId, entry.accountId, "totalBuyIn", event.target.value)}
                                                                            />
                                                                        </td>
                                                                        <td>
                                                                            <input
                                                                                className="control-input"
                                                                                type="number"
                                                                                min={0}
                                                                                step={1}
                                                                                value={entry.cashOut}
                                                                                onChange={(event) => handleGameEntryDraftChange(selectedGame.gameId, entry.accountId, "cashOut", event.target.value)}
                                                                            />
                                                                        </td>
                                                                        <td className={[
                                                                            "admin-club-manager__result",
                                                                            netResult !== null && netResult > 0 ? "admin-club-manager__result--positive" : "",
                                                                            netResult !== null && netResult < 0 ? "admin-club-manager__result--negative" : "",
                                                                        ].filter(Boolean).join(" ")}>
                                                                            {netResult === null ? "--" : formatSignedChipAmount(netResult)}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </article>
                                        ) : null}
                                    </div>
                                ) : (
                                    <p className="muted-copy">No recorded games are stored for this club yet. Create the first one above.</p>
                                )}
                            </section>
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    );
}

function parseWholeNumber(value: string, fieldName: string, allowNegative = false): number {
    const parsed = Number(value.trim());

    if (!Number.isInteger(parsed)) {
        throw new Error(`${fieldName} must be a whole number.`);
    }

    if (!allowNegative && parsed < 0) {
        throw new Error(`${fieldName} must be zero or greater.`);
    }

    return parsed;
}

function buildGameDraft(game: ClubGameLedger): GameDraft {
    return {
        label: game.label,
        playedAt: game.playedAt.slice(0, 10),
        entries: game.ledger.map((entry) => ({
            accountId: entry.accountId,
            username: entry.username,
            displayName: entry.displayName,
            hoursPlayed: entry.hoursPlayed ?? "",
            totalBuyIn: String(entry.totalBuyIn),
            cashOut: String(entry.cashOut),
        })),
    };
}

function buildNewGameDraft(members: ClubMemberSummary[]): GameDraft {
    return {
        label: "",
        playedAt: new Date().toISOString().slice(0, 10),
        entries: members.map((member) => ({
            accountId: member.accountId,
            username: member.username,
            displayName: member.username,
            hoursPlayed: "",
            totalBuyIn: "0",
            cashOut: "0",
        })),
    };
}

function buildGameDraftPatch(games: ClubGameLedger[]): Record<string, GameDraft> {
    return Object.fromEntries(games.map((game) => [game.gameId, buildGameDraft(game)]));
}

function getDraftNetResult(entry: GameEntryDraft): number | null {
    const totalBuyIn = Number(entry.totalBuyIn);
    const cashOut = Number(entry.cashOut);

    if (!Number.isInteger(totalBuyIn) || !Number.isInteger(cashOut)) {
        return null;
    }

    return cashOut - totalBuyIn;
}

function formatSignedChipAmount(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function formatTimestamp(value: string): string {
    return new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

function formatDateLabel(value: string): string {
    return new Date(value).toLocaleDateString(undefined, {
        dateStyle: "medium",
    });
}