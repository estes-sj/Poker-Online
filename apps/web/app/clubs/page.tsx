import Link from "next/link";

import { PageHeader, SiteHeader } from "../components/site-header";
import { fetchClubs } from "../lib/clubs";

export const dynamic = "force-dynamic";

export default async function ClubsPage() {
    const clubs = await fetchClubs();

    return (
        <div className="site">
            <SiteHeader current="clubs" />
            <main className="site-main">
                <PageHeader
                    title="Clubs"
                    description="Clubs track results across recurring games. Winnings from every linked table add up on the club leaderboard."
                />

                <section className="page-section">
                    {clubs.length ? (
                        <ul className="row-list">
                            {clubs.map((club) => (
                                <li key={club.clubId} className="row-list__item">
                                    <div className="row-list__main">
                                        <div className="row-list__title">
                                            <Link className="row-list__link" href={`/clubs/${club.slug}`}>{club.name}</Link>
                                        </div>
                                        <div className="row-list__meta">
                                            <span>Run by {club.ownerUsername}</span>
                                            <span>Since {formatTimestamp(club.createdAt)}</span>
                                            <span>Updated {formatTimestamp(club.updatedAt)}</span>
                                        </div>
                                    </div>
                                    <dl className="row-list__stats">
                                        <div>
                                            <dt>Members</dt>
                                            <dd>{club.memberCount}</dd>
                                        </div>
                                        <div>
                                            <dt>Tables</dt>
                                            <dd>{club.linkedRoomCount}</dd>
                                        </div>
                                    </dl>
                                    <div className="row-list__action">
                                        <Link className="button button--secondary button--small" href={`/clubs/${club.slug}`}>
                                            Leaderboard
                                        </Link>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="empty-state">No clubs yet.</p>
                    )}
                </section>
            </main>
        </div>
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