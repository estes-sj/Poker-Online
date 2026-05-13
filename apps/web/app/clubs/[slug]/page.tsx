import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchClub } from "../../lib/clubs";

export const dynamic = "force-dynamic";

export default async function ClubDetailPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { slug } = await params;
    const resolvedSearchParams = await searchParams;
    const club = await fetchClub(slug);

    if (!club) {
        notFound();
    }

    const requestedGameId = typeof resolvedSearchParams.game === "string"
        ? resolvedSearchParams.game
        : Array.isArray(resolvedSearchParams.game)
            ? resolvedSearchParams.game[0]
            : undefined;
    const selectedGame = club.gameHistory.find((game) => game.gameId === requestedGameId) ?? club.gameHistory[0] ?? null;

    return (
        <main className="landing-shell club-detail-page">
            <section className="room-header club-detail-page__header">
                <div className="club-detail-page__intro">
                    <Link className="hero-brand" href="/">
                        <img className="hero-brand__mark" src="/poker.svg" alt="Poker Poker logo" />
                        <span className="hero-brand__text">
                            <span className="hero-brand__name">Poker Poker</span>
                            <span className="hero-brand__tagline">Club leaderboard</span>
                        </span>
                    </Link>
                    <span className="eyebrow">{club.memberCount} members</span>
                    <h1>{club.name}</h1>
                    <p>Managed by {club.ownerUsername}. Winnings from linked club rooms accumulate here over time.</p>
                </div>

                <div className="club-detail-page__actions">
                    <Link className="button button--secondary" href="/clubs">
                        All clubs
                    </Link>
                    <Link className="button button--secondary" href="/rooms">
                        Browse rooms
                    </Link>
                </div>
            </section>

            <section className="club-detail-page__metrics">
                <article className="ui-panel club-detail-page__metric">
                    <strong>{club.memberCount}</strong>
                    <span>Members</span>
                </article>
                <article className="ui-panel club-detail-page__metric">
                    <strong>{club.linkedRoomCount}</strong>
                    <span>Linked rooms</span>
                </article>
                <article className="ui-panel club-detail-page__metric">
                    <strong>{club.leaderboard.length}</strong>
                    <span>Leaderboard entries</span>
                </article>
                <article className="ui-panel club-detail-page__metric">
                    <strong>{club.gameHistory.length}</strong>
                    <span>Recorded games</span>
                </article>
            </section>

            <section className="ui-panel club-leaderboard">
                <header className="club-leaderboard__header">
                    <div>
                        <span className="ui-panel__eyebrow">Leaderboard</span>
                        <h2 className="ui-panel__title">All-time winnings</h2>
                    </div>
                    <p className="muted-copy">Updated {formatTimestamp(club.updatedAt)}</p>
                </header>

                {club.leaderboard.length ? (
                    <div className="club-leaderboard__table-wrap">
                        <table className="club-leaderboard__table">
                            <thead>
                                <tr>
                                    <th scope="col">Rank</th>
                                    <th scope="col">Player</th>
                                    <th scope="col">Profit</th>
                                    <th scope="col">Games</th>
                                    <th scope="col">Type</th>
                                    <th scope="col">Updated</th>
                                </tr>
                            </thead>
                            <tbody>
                                {club.leaderboard.map((entry, index) => (
                                    <tr key={entry.entryKey}>
                                        <td>{index + 1}</td>
                                        <td>{entry.displayName ?? entry.username}</td>
                                        <td className={entry.totalProfit >= 0 ? "club-leaderboard__profit club-leaderboard__profit--positive" : "club-leaderboard__profit club-leaderboard__profit--negative"}>
                                            {formatProfit(entry.totalProfit)}
                                        </td>
                                        <td>{entry.gamesPlayed}</td>
                                        <td>{entry.isBalancingEntry ? "Balance" : entry.isDerivedFromRecordedGames ? "Recorded" : entry.isSynthetic ? "Imported" : "Account"}</td>
                                        <td>{formatTimestamp(entry.updatedAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="muted-copy">No leaderboard entries have been recorded for this club yet.</p>
                )}
            </section>

            <section className="ui-panel club-game-history">
                <header className="club-game-history__header">
                    <div>
                        <span className="ui-panel__eyebrow">Game history</span>
                        <h2 className="ui-panel__title">Per-game ledgers</h2>
                    </div>
                    <p className="muted-copy">Recorded sessions are grouped by game date rather than individual poker hands.</p>
                </header>

                {club.gameHistory.length ? (
                    <div className="club-game-history__workspace">
                        <div className="club-game-history__pagination">
                            {club.gameHistory.map((game) => (
                                <Link
                                    className={[
                                        "club-game-history__page",
                                        game.gameId === selectedGame?.gameId ? "club-game-history__page--active" : "",
                                    ].filter(Boolean).join(" ")}
                                    key={game.gameId}
                                    href={`/clubs/${club.slug}?game=${game.gameId}`}
                                    scroll={false}
                                >
                                    <strong>{game.label}</strong>
                                    <span>{formatTimestamp(game.playedAt)}</span>
                                </Link>
                            ))}
                        </div>

                        {selectedGame ? (
                            <article className="club-game-card" key={selectedGame.gameId}>
                                <header className="club-game-card__header">
                                    <div>
                                        <strong>{formatTimestamp(selectedGame.playedAt)}</strong>
                                        <p className="muted-copy">{selectedGame.label}</p>
                                    </div>
                                    <div className="club-game-card__meta">
                                        <span>{selectedGame.entryCount} players</span>
                                        <span>Recorded {formatTimestamp(selectedGame.importedAt)}</span>
                                    </div>
                                </header>

                                <div className="club-game-card__table-wrap">
                                    <table className="club-game-card__table">
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
                                            {selectedGame.ledger.map((entry) => (
                                                <tr key={`${selectedGame.gameId}-${entry.accountId}`}>
                                                    <td>{entry.displayName}</td>
                                                    <td>{entry.hoursPlayed ?? "-"}</td>
                                                    <td>{formatAmount(entry.totalBuyIn)}</td>
                                                    <td>{formatAmount(entry.cashOut)}</td>
                                                    <td className={entry.netResult >= 0 ? "club-game-card__result club-game-card__result--positive" : "club-game-card__result club-game-card__result--negative"}>
                                                        {formatProfit(entry.netResult)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </article>
                        ) : null}
                    </div>
                ) : (
                    <p className="muted-copy">No per-game ledgers have been imported for this club yet.</p>
                )}
            </section>
        </main>
    );
}

function formatProfit(value: number): string {
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${value.toLocaleString()}`;
}

function formatAmount(value: number): string {
    return value.toLocaleString();
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