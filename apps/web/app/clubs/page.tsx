import Link from "next/link";

import { getBrandName } from "../lib/brand";
import { fetchClubs } from "../lib/clubs";

export const dynamic = "force-dynamic";

export default async function ClubsPage() {
    const brandName = getBrandName();
    const clubs = await fetchClubs();

    return (
        <main className="landing-shell clubs-page">
            <section className="room-header clubs-page__header">
                <div className="clubs-page__intro">
                    <Link className="hero-brand" href="/">
                        <img className="hero-brand__mark" src="/poker.svg" alt={`${brandName} logo`} />
                        <span className="hero-brand__text">
                            <span className="hero-brand__name">{brandName}</span>
                            <span className="hero-brand__tagline">Club leaderboards</span>
                        </span>
                    </Link>
                    <span className="eyebrow">Clubs</span>
                    <h1>Track long-run winners across recurring home games.</h1>
                    <p>Club leaderboards roll up winnings from any room tied to that club. Open one to browse the current standings.</p>
                </div>

                <div className="clubs-page__actions">
                    <Link className="button button--secondary" href="/rooms">
                        Browse rooms
                    </Link>
                    <Link className="button button--secondary" href="/">
                        Return home
                    </Link>
                </div>
            </section>

            {clubs.length ? (
                <section className="clubs-grid">
                    {clubs.map((club) => (
                        <article key={club.clubId} className="room-card club-card">
                            <div className="room-card__header">
                                <div>
                                    <strong>{club.name}</strong>
                                    <p>{club.ownerUsername}</p>
                                </div>
                                <span className="chip-pill">{club.memberCount} members</span>
                            </div>

                            <div className="room-card__meta">
                                <span>{club.linkedRoomCount} linked rooms</span>
                                <span>Updated {formatTimestamp(club.updatedAt)}</span>
                            </div>

                            <p className="room-card__timestamp">Created {formatTimestamp(club.createdAt)}</p>

                            <div className="room-card__actions">
                                <Link className="button button--primary" href={`/clubs/${club.slug}`}>
                                    Open leaderboard
                                </Link>
                            </div>
                        </article>
                    ))}
                </section>
            ) : (
                <section className="ui-panel clubs-page__empty-state">
                    <p className="muted-copy">No clubs have been created yet.</p>
                </section>
            )}
        </main>
    );
}

function formatTimestamp(value: string): string {
    try {
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        }).format(new Date(value));
    } catch {
        return value;
    }
}