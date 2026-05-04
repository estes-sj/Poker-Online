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
    accountId: string;
    username: string;
    displayName?: string;
    totalProfit: number;
    gamesPlayed: number;
    updatedAt: string;
    isSynthetic: boolean;
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
            ...Object.fromEntries(activeClub.leaderboard.map((entry) => [entry.accountId, {
                totalProfit: String(entry.totalProfit),
                gamesPlayed: String(entry.gamesPlayed),
            }])),
        }));
        setGameDrafts((currentDrafts) => ({
            ...currentDrafts,
            ...buildGameDraftPatch(activeClub.gameHistory),
        }));
    }, [activeClub]);

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
                ...Object.fromEntries(payload.flatMap((club) => club.leaderboard.map((entry) => [entry.accountId, {
                    totalProfit: String(entry.totalProfit),
                    gamesPlayed: String(entry.gamesPlayed),
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
            ...Object.fromEntries(updatedClub.leaderboard.map((entry) => [entry.accountId, {
                totalProfit: String(entry.totalProfit),
                gamesPlayed: String(entry.gamesPlayed),
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

    async function handleSaveEntry(accountId: string) {
        if (!session || !activeClub) {
            return;
        }

        const draft = leaderboardDrafts[accountId];

        if (!draft) {
            return;
        }

        let totalProfit = 0;
        let gamesPlayed = 0;

        try {
            totalProfit = parseWholeNumber(draft.totalProfit, "Total profit", true);
            gamesPlayed = parseWholeNumber(draft.gamesPlayed, "Games played");
        } catch (parseError) {
            setError(parseError instanceof Error ? parseError.message : "Enter whole-number leaderboard values.");
            return;
        }

        setIsMutating(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, `/v1/admin/clubs/${activeClub.clubId}/leaderboard/${accountId}`), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ totalProfit, gamesPlayed }),
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

    function handleDraftChange(accountId: string, field: keyof LeaderboardDraft, value: string) {
        setLeaderboardDrafts((currentDrafts) => ({
            ...currentDrafts,
            [accountId]: {
                totalProfit: currentDrafts[accountId]?.totalProfit ?? "0",
                gamesPlayed: currentDrafts[accountId]?.gamesPlayed ?? "0",
                [field]: value,
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
                    <h2 className="ui-panel__title">Leaderboards, memberships, and imported totals</h2>
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
                        <p className="muted-copy">Tie a room to a club and every settled hand updates that club's all-time ranking. Imported games can also be edited here.</p>
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
                                    <span>Imported games</span>
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
                                </div>

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
                            </section>

                            <section className="admin-club-manager__section">
                                <div className="admin-club-manager__section-header">
                                    <div>
                                        <strong>Leaderboard entries</strong>
                                        <p className="muted-copy">Adjust club totals directly for testing or historical imports.</p>
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
                                                    <th scope="col">Type</th>
                                                    <th scope="col">Save</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {activeClub.leaderboard.map((entry) => {
                                                    const draft = leaderboardDrafts[entry.accountId] ?? {
                                                        totalProfit: String(entry.totalProfit),
                                                        gamesPlayed: String(entry.gamesPlayed),
                                                    };

                                                    return (
                                                        <tr key={entry.accountId}>
                                                            <td>
                                                                <div className="admin-club-manager__table-player">
                                                                    <strong>{entry.displayName ?? entry.username}</strong>
                                                                    <span>{entry.isSynthetic ? "Imported player" : "Registered account"}</span>
                                                                </div>
                                                            </td>
                                                            <td>
                                                                <input
                                                                    className="control-input"
                                                                    type="number"
                                                                    step={1}
                                                                    value={draft.totalProfit}
                                                                    onChange={(event) => handleDraftChange(entry.accountId, "totalProfit", event.target.value)}
                                                                />
                                                            </td>
                                                            <td>
                                                                <input
                                                                    className="control-input"
                                                                    type="number"
                                                                    min={0}
                                                                    step={1}
                                                                    value={draft.gamesPlayed}
                                                                    onChange={(event) => handleDraftChange(entry.accountId, "gamesPlayed", event.target.value)}
                                                                />
                                                            </td>
                                                            <td>{entry.isSynthetic ? "Imported" : "Account"}</td>
                                                            <td>
                                                                <button className="button button--secondary" type="button" onClick={() => void handleSaveEntry(entry.accountId)} disabled={isMutating}>
                                                                    Save
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="muted-copy">No leaderboard rows exist yet. Imported players or club-linked hands will populate this list.</p>
                                )}
                            </section>

                            <section className="admin-club-manager__section">
                                <div className="admin-club-manager__section-header">
                                    <div>
                                        <strong>Imported games</strong>
                                        <p className="muted-copy">Edit imported game dates and ledger rows. Saving a game recalculates the affected leaderboard totals.</p>
                                    </div>
                                </div>

                                {activeClub.gameHistory.length ? (
                                    <div className="admin-club-manager__game-list">
                                        {activeClub.gameHistory.map((game) => {
                                            const draft = gameDrafts[game.gameId] ?? buildGameDraft(game);

                                            return (
                                                <article key={game.gameId} className="club-game-card admin-club-manager__game-card">
                                                    <div className="club-game-card__header">
                                                        <div className="admin-club-manager__game-fields">
                                                            <label className="admin-club-manager__field">
                                                                <span>Label</span>
                                                                <input
                                                                    className="control-input"
                                                                    type="text"
                                                                    value={draft.label}
                                                                    onChange={(event) => handleGameDraftChange(game.gameId, "label", event.target.value)}
                                                                />
                                                            </label>
                                                            <label className="admin-club-manager__field admin-club-manager__field--compact">
                                                                <span>Played at</span>
                                                                <input
                                                                    className="control-input"
                                                                    type="date"
                                                                    value={draft.playedAt}
                                                                    onChange={(event) => handleGameDraftChange(game.gameId, "playedAt", event.target.value)}
                                                                />
                                                            </label>
                                                        </div>

                                                        <div className="admin-club-manager__game-actions">
                                                            <div className="club-game-card__meta">
                                                                <span>{draft.entries.length} players</span>
                                                                <span>Imported {formatTimestamp(game.importedAt)}</span>
                                                            </div>
                                                            <button className="button button--secondary" type="button" onClick={() => void handleSaveGame(game.gameId)} disabled={isMutating}>
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
                                                                {draft.entries.map((entry) => {
                                                                    const netResult = getDraftNetResult(entry);

                                                                    return (
                                                                        <tr key={entry.accountId}>
                                                                            <td>
                                                                                <div className="admin-club-manager__table-player">
                                                                                    <input
                                                                                        className="control-input"
                                                                                        type="text"
                                                                                        value={entry.displayName}
                                                                                        onChange={(event) => handleGameEntryDraftChange(game.gameId, entry.accountId, "displayName", event.target.value)}
                                                                                    />
                                                                                    <span>{entry.username}</span>
                                                                                </div>
                                                                            </td>
                                                                            <td>
                                                                                <input
                                                                                    className="control-input"
                                                                                    type="text"
                                                                                    value={entry.hoursPlayed}
                                                                                    onChange={(event) => handleGameEntryDraftChange(game.gameId, entry.accountId, "hoursPlayed", event.target.value)}
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
                                                                                    onChange={(event) => handleGameEntryDraftChange(game.gameId, entry.accountId, "totalBuyIn", event.target.value)}
                                                                                />
                                                                            </td>
                                                                            <td>
                                                                                <input
                                                                                    className="control-input"
                                                                                    type="number"
                                                                                    min={0}
                                                                                    step={1}
                                                                                    value={entry.cashOut}
                                                                                    onChange={(event) => handleGameEntryDraftChange(game.gameId, entry.accountId, "cashOut", event.target.value)}
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
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="muted-copy">No imported games are stored for this club yet.</p>
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