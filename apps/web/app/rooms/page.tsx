import Link from "next/link";

import { PageHeader, SiteHeader } from "../components/site-header";

export const dynamic = "force-dynamic";

interface PublicRoomSummary {
    roomId: string;
    slug: string;
    name: string;
    clubName: string | null;
    adminUsername: string;
    visibility: "private" | "club";
    status: string;
    passwordProtected: boolean;
    maxPlayers: number;
    seatedPlayerCount: number;
    handCount: number;
    createdAt: string;
    lastActivityAt: string;
    archivedAt: string | null;
    guestsAllowed?: boolean;
}

export default async function RoomsPage() {
    const rooms = await fetchRooms();
    const liveRooms = rooms.filter((room) => room.status !== "archived");
    const archivedRooms = rooms.filter((room) => room.status === "archived");

    return (
        <div className="site">
            <SiteHeader current="rooms" />
            <main className="site-main">
                <PageHeader
                    title="Tables"
                    description="Join a live table, or open an archived session to review its ledger and replay hands."
                />

                <section className="page-section">
                    <div className="section-header">
                        <h2>Live</h2>
                        <span className="count">{liveRooms.length}</span>
                    </div>
                    {liveRooms.length ? (
                        <ul className="row-list">
                            {liveRooms.map((room) => (
                                <RoomRow key={room.roomId} room={room} />
                            ))}
                        </ul>
                    ) : (
                        <p className="empty-state">No live tables right now.</p>
                    )}
                </section>

                <section className="page-section">
                    <div className="section-header">
                        <h2>Archived</h2>
                        <span className="count">{archivedRooms.length}</span>
                    </div>
                    {archivedRooms.length ? (
                        <ul className="row-list">
                            {archivedRooms.map((room) => (
                                <RoomRow key={room.roomId} room={room} />
                            ))}
                        </ul>
                    ) : (
                        <p className="empty-state">Archived sessions appear here after the host archives a table.</p>
                    )}
                </section>
            </main>
        </div>
    );
}

function RoomRow({ room }: { room: PublicRoomSummary }) {
    const isArchived = room.status === "archived";
    const access = room.passwordProtected ? "Password" : room.visibility === "club" ? "Club" : "Open";

    return (
        <li className="row-list__item">
            <div className="row-list__main">
                <div className="row-list__title">
                    <Link className="row-list__link" href={`/rooms/${room.slug}`}>{room.name}</Link>
                    {isArchived ? null : <StatusBadge status={room.status} />}
                </div>
                <div className="row-list__meta">
                    <span>Host {room.adminUsername}</span>
                    {room.clubName ? <span>{room.clubName}</span> : null}
                    <span>{access}</span>
                    {room.guestsAllowed && !isArchived ? <span>Guests welcome</span> : null}
                    <span>
                        {isArchived
                            ? `Archived ${formatTimestamp(room.archivedAt ?? room.lastActivityAt)}`
                            : `Active ${formatTimestamp(room.lastActivityAt)}`}
                    </span>
                </div>
            </div>
            <dl className="row-list__stats">
                <div>
                    <dt>Seated</dt>
                    <dd>{room.seatedPlayerCount}/{room.maxPlayers}</dd>
                </div>
                <div>
                    <dt>Hands</dt>
                    <dd>{room.handCount}</dd>
                </div>
            </dl>
            <div className="row-list__action">
                <Link className={isArchived ? "button button--secondary button--small" : "button button--primary button--small"} href={`/rooms/${room.slug}`}>
                    {isArchived ? "Review" : "Join"}
                </Link>
            </div>
        </li>
    );
}

function StatusBadge({ status }: { status: string }) {
    const label = formatRoomStatus(status);

    return <span className={`status-badge status-badge--${label.toLowerCase()}`}>{label}</span>;
}

async function fetchRooms(): Promise<PublicRoomSummary[]> {
    const baseUrl = process.env.GAME_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_GAME_HTTP_URL ?? "http://localhost:4200";

    try {
        const response = await fetch(new URL("/v1/rooms", baseUrl), {
            cache: "no-store",
        });

        if (!response.ok) {
            return [];
        }

        const payload = (await response.json()) as PublicRoomSummary[];
        return Array.isArray(payload) ? payload : [];
    } catch {
        return [];
    }
}

function formatRoomStatus(status: string): string {
    if (status === "archived") {
        return "Archived";
    }

    if (status === "active") {
        return "Active";
    }

    if (status === "paused") {
        return "Paused";
    }

    return "Waiting";
}

function formatTimestamp(value: string): string {
    const parsed = Date.parse(value);

    if (Number.isNaN(parsed)) {
        return value;
    }

    return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(parsed);
}