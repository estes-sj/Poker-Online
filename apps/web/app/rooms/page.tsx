import Link from "next/link";

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
}

export default async function RoomsPage() {
    const rooms = await fetchRooms();
    const liveRooms = rooms.filter((room) => room.status !== "archived");
    const archivedRooms = rooms.filter((room) => room.status === "archived");

    return (
        <main className="landing-shell rooms-page">
            <section className="room-header rooms-page__header">
                <div className="rooms-page__intro">
                    <Link className="hero-brand" href="/">
                        <img className="hero-brand__mark" src="/poker.svg" alt="Poker Poker logo" />
                        <span className="hero-brand__text">
                            <span className="hero-brand__name">Poker Poker</span>
                            <span className="hero-brand__tagline">Live tables and archived sessions</span>
                        </span>
                    </Link>
                    <span className="eyebrow">Rooms</span>
                    <h1>Browse tables and archives</h1>
                    <p>Open a live table, or review an archived session and replay any preserved hand on the felt.</p>
                </div>

                <div className="rooms-page__actions">
                    <Link className="button button--secondary" href="/">
                        Return home
                    </Link>
                </div>
            </section>

            <section className="rooms-page__section">
                <div className="rooms-page__section-header">
                    <div>
                        <span className="eyebrow">Live</span>
                        <h2>Open tables</h2>
                    </div>
                    <span className="chip-pill">{liveRooms.length}</span>
                </div>

                {liveRooms.length ? (
                    <div className="rooms-grid">
                        {liveRooms.map((room) => (
                            <RoomCard key={room.roomId} room={room} />
                        ))}
                    </div>
                ) : (
                    <p className="muted-copy rooms-page__empty">No live tables are open right now.</p>
                )}
            </section>

            <section className="rooms-page__section">
                <div className="rooms-page__section-header">
                    <div>
                        <span className="eyebrow">Archive</span>
                        <h2>Archived sessions</h2>
                    </div>
                    <span className="chip-pill">{archivedRooms.length}</span>
                </div>

                {archivedRooms.length ? (
                    <div className="rooms-archive-table-wrap">
                        <table className="rooms-archive-table">
                            <thead>
                                <tr>
                                    <th scope="col">Room</th>
                                    <th scope="col">Admin</th>
                                    <th scope="col">Seats</th>
                                    <th scope="col">Hands</th>
                                    <th scope="col">Archived</th>
                                    <th scope="col">Access</th>
                                    <th scope="col" aria-label="Open archive" />
                                </tr>
                            </thead>
                            <tbody>
                                {archivedRooms.map((room) => (
                                    <tr key={room.roomId}>
                                        <td>
                                            <div className="rooms-archive-table__room">
                                                <strong>{room.name}</strong>
                                                {room.clubName ? <span>Club: {room.clubName}</span> : null}
                                                <span>{room.slug}</span>
                                            </div>
                                        </td>
                                        <td>{room.adminUsername}</td>
                                        <td>{room.seatedPlayerCount}/{room.maxPlayers}</td>
                                        <td>{room.handCount}</td>
                                        <td>{formatTimestamp(room.archivedAt ?? room.lastActivityAt)}</td>
                                        <td>{room.passwordProtected ? "Password" : room.visibility === "club" ? "Club" : "Private"}</td>
                                        <td className="rooms-archive-table__action-cell">
                                            <Link className="button button--primary" href={`/rooms/${room.slug}`}>
                                                Open archive
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="muted-copy rooms-page__empty">Archived tables will appear here after the admin archives a finished session.</p>
                )}
            </section>
        </main>
    );
}

function RoomCard({ room }: { room: PublicRoomSummary }) {
    return (
        <article className={["room-card", room.status === "archived" ? "room-card--archived" : ""].filter(Boolean).join(" ")}>
            <div className="room-card__header">
                <div>
                    <strong>{room.name}</strong>
                    <p>{room.adminUsername}</p>
                </div>
                <span className="chip-pill">{formatRoomStatus(room.status)}</span>
            </div>

            <div className="room-card__meta">
                <span>{room.seatedPlayerCount}/{room.maxPlayers} seated</span>
                <span>{room.passwordProtected ? "Password" : room.visibility === "club" ? "Club" : "Private"}</span>
                {room.clubName ? <span>Club: {room.clubName}</span> : null}
                <span>{room.handCount} hands</span>
            </div>

            <p className="room-card__timestamp">
                {room.archivedAt
                    ? `Archived ${formatTimestamp(room.archivedAt)}`
                    : `Last active ${formatTimestamp(room.lastActivityAt)}`}
            </p>

            <div className="room-card__actions">
                <Link className="button button--primary" href={`/rooms/${room.slug}`}>
                    {room.status === "archived" ? "Open archive" : "Open table"}
                </Link>
            </div>
        </article>
    );
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