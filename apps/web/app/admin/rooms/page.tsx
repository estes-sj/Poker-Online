import Link from "next/link";

import { getRoomCreationPolicy } from "../../lib/room-creation-policy";
import { AdminRoomManager } from "./admin-room-manager";

export const dynamic = "force-dynamic";

export default function AdminRoomsPage() {
    const roomCreationPolicy = getRoomCreationPolicy();

    return (
        <main className="landing-shell admin-rooms-page">
            <section className="room-header admin-rooms-page__header">
                <div className="admin-rooms-page__intro">
                    <Link className="hero-brand" href="/">
                        <img className="hero-brand__mark" src="/poker.svg" alt="Poker Poker logo" />
                        <span className="hero-brand__text">
                            <span className="hero-brand__name">Poker Poker</span>
                            <span className="hero-brand__tagline">Admin room controls</span>
                        </span>
                    </Link>
                    <span className="eyebrow">Admin</span>
                    <h1>Manage live and archived rooms</h1>
                    <p>Review live tables, browse archived sessions, bulk delete live rooms or archived games, and configure optional idle cleanup when a table has been inactive for a set number of hours.</p>
                </div>

                <div className="admin-rooms-page__actions">
                    <Link className="button button--secondary" href="/">
                        Return home
                    </Link>
                </div>
            </section>

            <AdminRoomManager roomCreationPolicy={roomCreationPolicy} />
        </main>
    );
}