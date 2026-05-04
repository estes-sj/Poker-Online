import Link from "next/link";

import { getRoomCreationPolicy } from "../../lib/room-creation-policy";
import { AdminClubManager } from "./admin-club-manager";

export const dynamic = "force-dynamic";

export default function AdminClubsPage() {
    const roomCreationPolicy = getRoomCreationPolicy();

    return (
        <main className="landing-shell admin-rooms-page">
            <section className="room-header admin-rooms-page__header">
                <div className="admin-rooms-page__intro">
                    <Link className="hero-brand" href="/">
                        <img className="hero-brand__mark" src="/poker.svg" alt="Poker Poker logo" />
                        <span className="hero-brand__text">
                            <span className="hero-brand__name">Poker Poker</span>
                            <span className="hero-brand__tagline">Admin club controls</span>
                        </span>
                    </Link>
                    <span className="eyebrow">Admin</span>
                    <h1>Manage clubs, leaderboard entries, and imported games</h1>
                    <p>Create clubs, add existing users, seed imported players for old PokerNow ledgers, and edit imported games without replaying historical sessions.</p>
                </div>

                <div className="admin-rooms-page__actions">
                    <Link className="button button--secondary" href="/admin/rooms">
                        Manage rooms
                    </Link>
                    <Link className="button button--secondary" href="/">
                        Return home
                    </Link>
                </div>
            </section>

            <AdminClubManager roomCreationPolicy={roomCreationPolicy} />
        </main>
    );
}