import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, SiteHeader } from "../../components/site-header";
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
        <div className="site">
            <SiteHeader current="clubs" />
            <main className="site-main">
                <PageHeader
                    meta={<Link className="breadcrumb" href="/clubs">Clubs</Link>}
                    title={club.name}
                    description={`Run by ${club.ownerUsername}. Updated ${formatTimestamp(club.updatedAt)}.`}
                />

                <dl className="stat-strip">
                    <div>
                        <dt>Members</dt>
                        <dd>{club.memberCount}</dd>
                    </div>
                    <div>
                        <dt>Linked tables</dt>
                        <dd>{club.linkedRoomCount}</dd>
                    </div>
                    <div>
                        <dt>Ranked players</dt>
                        <dd>{club.leaderboard.length}</dd>
                    </div>
                    <div>
                        <dt>Games recorded</dt>
                        <dd>{club.gameHistory.length}</dd>
                    </div>
                </dl>

                <section className="page-section">
                    <div className="section-header">
                        <h2>Leaderboard</h2>
                        <span className="section-header__note">All-time net results</span>
                    </div>

                    {club.leaderboard.length ? (
                        <div className="data-table-wrap">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th scope="col" className="data-table__rank">#</th>
                                        <th scope="col">Player</th>
                                        <th scope="col" className="data-table__num">Games</th>
                                        <th scope="col">Source</th>
                                        <th scope="col" className="data-table__num">Net</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {club.leaderboard.map((entry, index) => (
                                        <tr key={entry.entryKey}>
                                            <td className="data-table__rank">{index + 1}</td>
                                            <td className="data-table__strong">{entry.displayName ?? entry.username}</td>
                                            <td className="data-table__num">{entry.gamesPlayed}</td>
                                            <td className="data-table__muted">{entry.isBalancingEntry ? "Balance" : entry.isDerivedFromRecordedGames ? "Recorded" : entry.isSynthetic ? "Imported" : "Account"}</td>
                                            <td className={`data-table__num ${profitClass(entry.totalProfit)}`}>
                                                {formatProfit(entry.totalProfit)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="empty-state">No results recorded for this club yet.</p>
                    )}
                </section>

                <section className="page-section">
                    <div className="section-header">
                        <h2>Game history</h2>
                        <span className="section-header__note">One ledger per game night</span>
                    </div>

                    {club.gameHistory.length ? (
                        <div className="split-view">
                            <nav className="split-view__nav" aria-label="Recorded games">
                                {club.gameHistory.map((game) => {
                                    const isActive = game.gameId === selectedGame?.gameId;

                                    return (
                                        <Link
                                            className={isActive ? "nav-item nav-item--active" : "nav-item"}
                                            key={game.gameId}
                                            href={`/clubs/${club.slug}?game=${game.gameId}`}
                                            scroll={false}
                                            aria-current={isActive ? "page" : undefined}
                                        >
                                            <span className="nav-item__title">{game.label}</span>
                                            <span className="nav-item__hint">{formatTimestamp(game.playedAt)}</span>
                                        </Link>
                                    );
                                })}
                            </nav>

                            {selectedGame ? (
                                <div className="split-view__detail" key={selectedGame.gameId}>
                                    <div className="split-view__header">
                                        <h3>{selectedGame.label}</h3>
                                        <p>
                                            Played {formatTimestamp(selectedGame.playedAt)} · {selectedGame.entryCount} players
                                        </p>
                                    </div>
                                    <div className="data-table-wrap">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th scope="col">Player</th>
                                                    <th scope="col" className="data-table__num">Hours</th>
                                                    <th scope="col" className="data-table__num">Buy-in</th>
                                                    <th scope="col" className="data-table__num">Cash-out</th>
                                                    <th scope="col" className="data-table__num">Net</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedGame.ledger.map((entry) => (
                                                    <tr key={`${selectedGame.gameId}-${entry.accountId}`}>
                                                        <td className="data-table__strong">{entry.displayName}</td>
                                                        <td className="data-table__num data-table__muted">{entry.hoursPlayed ?? "–"}</td>
                                                        <td className="data-table__num">{formatAmount(entry.totalBuyIn)}</td>
                                                        <td className="data-table__num">{formatAmount(entry.cashOut)}</td>
                                                        <td className={`data-table__num ${profitClass(entry.netResult)}`}>
                                                            {formatProfit(entry.netResult)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <p className="empty-state">No game ledgers recorded for this club yet.</p>
                    )}
                </section>
            </main>
        </div>
    );
}

function profitClass(value: number): string {
    if (value > 0) {
        return "value--positive";
    }

    return value < 0 ? "value--negative" : "";
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