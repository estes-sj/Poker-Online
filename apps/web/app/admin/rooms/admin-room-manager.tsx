"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
    isConfiguredRoomCreationAdmin,
    readStoredBrowserSession,
    type BrowserSessionState,
} from "../../lib/browser-session";
import { buildBrowserHttpUrl, getBrowserGameHttpBaseUrl } from "../../lib/public-service-urls";

interface ManagedRoomSummary {
    roomId: string;
    slug: string;
    name: string;
    clubName: string | null;
    adminAccountId: string;
    adminUsername: string;
    visibility: "private" | "club";
    status: string;
    passwordProtected: boolean;
    maxPlayers: number;
    seatedPlayerCount: number;
    connectedPlayerCount: number;
    handCount: number;
    pendingSeatRequestCount: number;
    pendingRebuyRequestCount: number;
    createdAt: string;
    lastActivityAt: string;
    archivedAt: string | null;
    autoExpireAfterHours: number | null;
    expiresAt: string | null;
}

interface DeleteManagedRoomsResult {
    deletedRoomIds: string[];
    deletedSlugs: string[];
}

interface AdminRoomManagerProps {
    roomCreationPolicy: {
        adminOnly: boolean;
        adminUsername: string | null;
    };
}

export function AdminRoomManager({ roomCreationPolicy }: AdminRoomManagerProps) {
    const [session, setSession] = useState<BrowserSessionState | null>(null);
    const [rooms, setRooms] = useState<ManagedRoomSummary[]>([]);
    const [selectedLiveRoomIds, setSelectedLiveRoomIds] = useState<string[]>([]);
    const [selectedArchivedRoomIds, setSelectedArchivedRoomIds] = useState<string[]>([]);
    const [expirationHoursInput, setExpirationHoursInput] = useState("24");
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isApplyingExpiration, setIsApplyingExpiration] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const canManageRooms = Boolean(
        session
        && isConfiguredRoomCreationAdmin(session.account.username, roomCreationPolicy.adminUsername),
    );
    const liveRooms = rooms.filter((room) => room.status !== "archived");
    const archivedRooms = rooms.filter((room) => room.status === "archived");
    const selectedLiveCount = selectedLiveRoomIds.length;
    const selectedArchivedCount = selectedArchivedRoomIds.length;
    const allLiveSelected = liveRooms.length > 0 && selectedLiveCount === liveRooms.length;
    const allArchivedSelected = archivedRooms.length > 0 && selectedArchivedCount === archivedRooms.length;

    useEffect(() => {
        const storedSession = readStoredBrowserSession();

        setSession(storedSession);

        if (!storedSession || !isConfiguredRoomCreationAdmin(storedSession.account.username, roomCreationPolicy.adminUsername)) {
            setIsLoading(false);
            return;
        }

        void loadRooms(storedSession.token, true);
    }, [roomCreationPolicy.adminUsername]);

    async function loadRooms(token: string, initialLoad = false) {
        if (initialLoad) {
            setIsLoading(true);
        } else {
            setIsRefreshing(true);
        }

        setError(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, "/v1/admin/rooms"), {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const payload = (await response.json()) as ManagedRoomSummary[] | { error?: string };

            if (!response.ok || !Array.isArray(payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to load rooms.");
            }

            const liveRoomIds = new Set(payload.filter((room) => room.status !== "archived").map((room) => room.roomId));
            const archivedRoomIds = new Set(payload.filter((room) => room.status === "archived").map((room) => room.roomId));

            setRooms(payload);
            setSelectedLiveRoomIds((currentSelection) => currentSelection.filter((roomId) => liveRoomIds.has(roomId)));
            setSelectedArchivedRoomIds((currentSelection) => currentSelection.filter((roomId) => archivedRoomIds.has(roomId)));
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Unable to load rooms.");
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }

    function toggleLiveRoom(roomId: string) {
        setSelectedLiveRoomIds((currentSelection) => (
            currentSelection.includes(roomId)
                ? currentSelection.filter((currentRoomId) => currentRoomId !== roomId)
                : [...currentSelection, roomId]
        ));
    }

    function toggleArchivedRoom(roomId: string) {
        setSelectedArchivedRoomIds((currentSelection) => (
            currentSelection.includes(roomId)
                ? currentSelection.filter((currentRoomId) => currentRoomId !== roomId)
                : [...currentSelection, roomId]
        ));
    }

    function handleToggleAllLiveRooms() {
        setSelectedLiveRoomIds(allLiveSelected ? [] : liveRooms.map((room) => room.roomId));
    }

    function handleToggleAllArchivedRooms() {
        setSelectedArchivedRoomIds(allArchivedSelected ? [] : archivedRooms.map((room) => room.roomId));
    }

    async function handleApplyExpiration(clearExpiration: boolean) {
        if (!session || selectedLiveRoomIds.length === 0) {
            return;
        }

        let autoExpireAfterHours: number | null = null;

        if (!clearExpiration) {
            const parsed = Number(expirationHoursInput.trim());

            if (!Number.isInteger(parsed) || parsed < 1) {
                setError("Enter a whole number of hours greater than zero.");
                return;
            }

            autoExpireAfterHours = parsed;
        }

        setIsApplyingExpiration(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, "/v1/admin/rooms/expiration"), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    roomIds: selectedLiveRoomIds,
                    autoExpireAfterHours,
                }),
            });

            const payload = (await response.json()) as ManagedRoomSummary[] | { error?: string };

            if (!response.ok || !Array.isArray(payload)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to update room expiration.");
            }

            setNotice(clearExpiration
                ? `Cleared idle expiration for ${payload.length} room${payload.length === 1 ? "" : "s"}.`
                : `Set idle expiration to ${autoExpireAfterHours} hour${autoExpireAfterHours === 1 ? "" : "s"} for ${payload.length} room${payload.length === 1 ? "" : "s"}.`);
            await loadRooms(session.token);
        } catch (updateError) {
            setError(updateError instanceof Error ? updateError.message : "Unable to update room expiration.");
        } finally {
            setIsApplyingExpiration(false);
        }
    }

    async function deleteSelectedRooms(roomIds: string[], scopeLabel: string) {
        if (!session || roomIds.length === 0) {
            return;
        }

        const confirmed = window.confirm(`Delete ${roomIds.length} ${scopeLabel}${roomIds.length === 1 ? "" : "s"}? This permanently removes the room and its archived session history.`);

        if (!confirmed) {
            return;
        }

        setIsDeleting(true);
        setError(null);
        setNotice(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, "/v1/admin/rooms/delete"), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    roomIds,
                }),
            });

            const payload = (await response.json()) as DeleteManagedRoomsResult | { error?: string };

            if (!response.ok || !payload || !Array.isArray((payload as DeleteManagedRoomsResult).deletedRoomIds)) {
                throw new Error((payload as { error?: string }).error ?? "Unable to delete rooms.");
            }

            const deletedRoomIds = (payload as DeleteManagedRoomsResult).deletedRoomIds;
            setRooms((currentRooms) => currentRooms.filter((room) => !deletedRoomIds.includes(room.roomId)));
            setSelectedLiveRoomIds((currentSelection) => currentSelection.filter((roomId) => !deletedRoomIds.includes(roomId)));
            setSelectedArchivedRoomIds((currentSelection) => currentSelection.filter((roomId) => !deletedRoomIds.includes(roomId)));
            setNotice(`Deleted ${deletedRoomIds.length} ${scopeLabel}${deletedRoomIds.length === 1 ? "" : "s"}.`);
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : "Unable to delete rooms.");
        } finally {
            setIsDeleting(false);
        }
    }

    async function handleDeleteSelectedLiveRooms() {
        await deleteSelectedRooms(selectedLiveRoomIds, "live room");
    }

    async function handleDeleteSelectedArchivedRooms() {
        await deleteSelectedRooms(selectedArchivedRoomIds, "archived game");
    }

    if (!session) {
        return (
            <section className="ui-panel admin-room-manager admin-room-manager--locked">
                <header className="ui-panel__header">
                    <span className="ui-panel__eyebrow">Admin access</span>
                    <h2 className="ui-panel__title">Sign in to manage rooms</h2>
                </header>
                <div className="ui-panel__body admin-room-manager__message">
                    <p>Room management is only available to the configured admin account. Sign in on the home page, then return here.</p>
                    <div className="action-row">
                        <Link className="button button--primary" href="/">
                            Return home
                        </Link>
                    </div>
                </div>
            </section>
        );
    }

    if (!canManageRooms) {
        return (
            <section className="ui-panel admin-room-manager admin-room-manager--locked">
                <header className="ui-panel__header">
                    <span className="ui-panel__eyebrow">Admin access</span>
                    <h2 className="ui-panel__title">This account cannot manage rooms</h2>
                </header>
                <div className="ui-panel__body admin-room-manager__message">
                    <p>
                        You are signed in as <strong>{session.account.username}</strong>, but room management is limited to the configured admin account.
                    </p>
                    <div className="action-row">
                        <Link className="button button--primary" href="/">
                            Return home
                        </Link>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="admin-room-manager">
            <section className="ui-panel admin-room-manager__panel">
                <header className="ui-panel__header admin-room-manager__header">
                    <div>
                        <span className="ui-panel__eyebrow">Live rooms</span>
                        <h2 className="ui-panel__title">Manage live tables</h2>
                    </div>
                    <button className="button button--secondary" type="button" onClick={() => void loadRooms(session.token)} disabled={isLoading || isRefreshing}>
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                    </button>
                </header>

                <div className="ui-panel__body admin-room-manager__content">
                    <div className="admin-room-manager__toolbar">
                        <div className="admin-room-manager__toolbar-copy">
                            <p>Signed in as {session.account.username}.</p>
                            <p>{selectedLiveCount} live room{selectedLiveCount === 1 ? "" : "s"} selected.</p>
                        </div>
                        <div className="action-row admin-room-manager__toolbar-actions">
                            <button className="button button--secondary" type="button" onClick={handleToggleAllLiveRooms} disabled={liveRooms.length === 0 || isLoading}>
                                {allLiveSelected ? "Clear selection" : "Select all"}
                            </button>
                        </div>
                    </div>

                    <div className="admin-room-manager__bulk-actions">
                        <label className="control-field admin-room-manager__expiration-field" htmlFor="admin-room-expiration-hours">
                            <span className="control-field__label">Idle auto-expiration (hours)</span>
                            <input
                                className="control-input"
                                id="admin-room-expiration-hours"
                                type="number"
                                min={1}
                                step={1}
                                inputMode="numeric"
                                value={expirationHoursInput}
                                onChange={(event) => setExpirationHoursInput(event.target.value)}
                                placeholder="24"
                            />
                        </label>

                        <div className="action-row admin-room-manager__bulk-buttons">
                            <button className="button button--secondary" type="button" onClick={() => void handleApplyExpiration(false)} disabled={selectedLiveCount === 0 || isApplyingExpiration || isDeleting}>
                                {isApplyingExpiration ? "Applying..." : "Apply to selected"}
                            </button>
                            <button className="button button--secondary" type="button" onClick={() => void handleApplyExpiration(true)} disabled={selectedLiveCount === 0 || isApplyingExpiration || isDeleting}>
                                Clear expiration
                            </button>
                            <button className="button button--primary admin-room-manager__delete-button" type="button" onClick={() => void handleDeleteSelectedLiveRooms()} disabled={selectedLiveCount === 0 || isDeleting || isApplyingExpiration}>
                                {isDeleting ? "Deleting..." : "Delete selected"}
                            </button>
                        </div>
                    </div>

                    {error ? <p className="form-error admin-room-manager__feedback">{error}</p> : null}
                    {notice ? <p className="admin-room-manager__feedback admin-room-manager__feedback--notice">{notice}</p> : null}

                    {isLoading ? (
                        <div className="admin-room-manager__empty-state">
                            <p>Loading room inventory...</p>
                        </div>
                    ) : liveRooms.length === 0 ? (
                        <div className="admin-room-manager__empty-state">
                            <p>No live tables are currently stored.</p>
                        </div>
                    ) : (
                        <div className="admin-room-manager__table-wrap">
                            <table className="admin-room-table">
                                <thead>
                                    <tr>
                                        <th scope="col" className="admin-room-table__checkbox-cell">
                                            <input type="checkbox" checked={allLiveSelected} onChange={handleToggleAllLiveRooms} aria-label="Select all live rooms" />
                                        </th>
                                        <th scope="col">Room</th>
                                        <th scope="col">Seats</th>
                                        <th scope="col">Requests</th>
                                        <th scope="col">Last activity</th>
                                        <th scope="col">Auto-expire</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {liveRooms.map((room) => {
                                        const selected = selectedLiveRoomIds.includes(room.roomId);

                                        return (
                                            <tr key={room.roomId} className={selected ? "admin-room-table__row admin-room-table__row--selected" : "admin-room-table__row"}>
                                                <td className="admin-room-table__checkbox-cell">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected}
                                                        onChange={() => toggleLiveRoom(room.roomId)}
                                                        aria-label={`Select ${room.name}`}
                                                    />
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__room-cell">
                                                        <Link className="admin-room-table__room-link" href={`/rooms/${room.slug}`}>
                                                            {room.name}
                                                        </Link>
                                                        <div className="admin-room-table__room-meta">
                                                            <span>{capitalizeLabel(room.status)}</span>
                                                            <span>{room.visibility === "club" ? "Club" : "Private"}</span>
                                                            {room.clubName ? <span>Club: {room.clubName}</span> : null}
                                                            <span>{room.handCount} hand{room.handCount === 1 ? "" : "s"}</span>
                                                            {room.passwordProtected ? <span>Password</span> : null}
                                                            <span>Admin: {room.adminUsername}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__metric">
                                                        <strong>{room.seatedPlayerCount}/{room.maxPlayers}</strong>
                                                        <span>{room.connectedPlayerCount} connected</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__metric">
                                                        <strong>{room.pendingSeatRequestCount + room.pendingRebuyRequestCount}</strong>
                                                        <span>{room.pendingSeatRequestCount} seat, {room.pendingRebuyRequestCount} rebuy</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__metric">
                                                        <strong>{formatRelativeTime(room.lastActivityAt)}</strong>
                                                        <span>{formatTimestamp(room.lastActivityAt)}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__metric">
                                                        <strong>{room.autoExpireAfterHours ? `${room.autoExpireAfterHours}h` : "Off"}</strong>
                                                        <span>{room.expiresAt ? `Deletes ${formatRelativeTime(room.expiresAt)}` : "No idle deletion"}</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>

            <section className="ui-panel admin-room-manager__panel">
                <header className="ui-panel__header admin-room-manager__header">
                    <div>
                        <span className="ui-panel__eyebrow">Archive</span>
                        <h2 className="ui-panel__title">Archived tables</h2>
                    </div>
                </header>

                <div className="ui-panel__body admin-room-manager__content">
                    <div className="admin-room-manager__toolbar">
                        <div className="admin-room-manager__toolbar-copy">
                            <p>Select archived games to delete preserved sessions in bulk.</p>
                            <p>{selectedArchivedCount} archived game{selectedArchivedCount === 1 ? "" : "s"} selected.</p>
                        </div>
                        <div className="action-row admin-room-manager__toolbar-actions">
                            <button className="button button--secondary" type="button" onClick={handleToggleAllArchivedRooms} disabled={archivedRooms.length === 0 || isLoading || isDeleting}>
                                {allArchivedSelected ? "Clear selection" : "Select all"}
                            </button>
                            <button className="button button--primary admin-room-manager__delete-button" type="button" onClick={() => void handleDeleteSelectedArchivedRooms()} disabled={selectedArchivedCount === 0 || isDeleting || isApplyingExpiration}>
                                {isDeleting ? "Deleting..." : "Delete selected"}
                            </button>
                        </div>
                    </div>

                    {isLoading ? (
                        <div className="admin-room-manager__empty-state">
                            <p>Loading archived tables...</p>
                        </div>
                    ) : archivedRooms.length === 0 ? (
                        <div className="admin-room-manager__empty-state">
                            <p>No archived tables are currently stored.</p>
                        </div>
                    ) : (
                        <div className="admin-room-manager__table-wrap">
                            <table className="admin-room-table">
                                <thead>
                                    <tr>
                                        <th scope="col" className="admin-room-table__checkbox-cell">
                                            <input type="checkbox" checked={allArchivedSelected} onChange={handleToggleAllArchivedRooms} aria-label="Select all archived games" />
                                        </th>
                                        <th scope="col">Room</th>
                                        <th scope="col">Seats</th>
                                        <th scope="col">Hands</th>
                                        <th scope="col">Archived</th>
                                        <th scope="col">Last activity</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {archivedRooms.map((room) => {
                                        const archivedAt = room.archivedAt ?? room.lastActivityAt;
                                        const selected = selectedArchivedRoomIds.includes(room.roomId);

                                        return (
                                            <tr key={room.roomId} className={selected ? "admin-room-table__row admin-room-table__row--selected" : "admin-room-table__row"}>
                                                <td className="admin-room-table__checkbox-cell">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected}
                                                        onChange={() => toggleArchivedRoom(room.roomId)}
                                                        aria-label={`Select archived game ${room.name}`}
                                                    />
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__room-cell">
                                                        <Link className="admin-room-table__room-link" href={`/rooms/${room.slug}`}>
                                                            {room.name}
                                                        </Link>
                                                        <div className="admin-room-table__room-meta">
                                                            <span>Archived</span>
                                                            <span>{room.visibility === "club" ? "Club" : "Private"}</span>
                                                            {room.clubName ? <span>Club: {room.clubName}</span> : null}
                                                            {room.passwordProtected ? <span>Password</span> : null}
                                                            <span>Admin: {room.adminUsername}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__metric">
                                                        <strong>{room.seatedPlayerCount}/{room.maxPlayers}</strong>
                                                        <span>{room.connectedPlayerCount} connected at archive</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__metric">
                                                        <strong>{room.handCount}</strong>
                                                        <span>{room.handCount === 1 ? "Completed hand" : "Completed hands"}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__metric">
                                                        <strong>{formatRelativeTime(archivedAt)}</strong>
                                                        <span>{formatTimestamp(archivedAt)}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="admin-room-table__metric">
                                                        <strong>{formatRelativeTime(room.lastActivityAt)}</strong>
                                                        <span>{formatTimestamp(room.lastActivityAt)}</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>
        </section>
    );
}

function formatTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Unknown";
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}

function formatRelativeTime(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Unknown";
    }

    const deltaMs = date.getTime() - Date.now();
    const absDeltaMs = Math.abs(deltaMs);
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

    if (absDeltaMs < hourMs) {
        return formatter.format(Math.round(deltaMs / minuteMs), "minute");
    }

    if (absDeltaMs < dayMs) {
        return formatter.format(Math.round(deltaMs / hourMs), "hour");
    }

    return formatter.format(Math.round(deltaMs / dayMs), "day");
}

function capitalizeLabel(value: string): string {
    return value.length > 0 ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}