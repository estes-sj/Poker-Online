import Link from "next/link";

import { ControlDesk } from "./components/control-desk";
import { SiteHeader } from "./components/site-header";
import { getBrandName } from "./lib/brand";
import { getRoomCreationPolicy } from "./lib/room-creation-policy";

export const dynamic = "force-dynamic";

const features = [
    {
        title: "Voice and video",
        copy: "Cameras and mics sit at each seat, served by your own LiveKit.",
    },
    {
        title: "Host controls at the table",
        copy: "Approve seats and rebuys, change blinds, pause, or archive without leaving the game.",
    },
    {
        title: "Ledgers and replays",
        copy: "Every session keeps a ledger, and archived hands replay on the felt.",
    },
    {
        title: "Club leaderboards",
        copy: "Link tables to a club and results roll up into all-time standings.",
    },
];

export default function HomePage() {
    const brandName = getBrandName();
    const roomCreationPolicy = getRoomCreationPolicy();

    return (
        <div className="site">
            <SiteHeader current="home" />
            <main className="site-main home">
                <section className="home__intro">
                    <h1>Private poker tables for your group.</h1>
                    <p className="home__lede">
                        {brandName} runs no-limit Texas Hold&apos;em with live voice and video, rebuys, blind schedules,
                        and saved hand history, all on your own server.
                    </p>
                    <div className="button-row">
                        <Link className="button button--secondary" href="/rooms">Browse tables</Link>
                        <Link className="button button--ghost" href="/rooms/sample-table">See a sample table</Link>
                    </div>
                </section>

                <dl className="feature-list">
                    {features.map((feature) => (
                        <div key={feature.title} className="feature-list__item">
                            <dt>{feature.title}</dt>
                            <dd>{feature.copy}</dd>
                        </div>
                    ))}
                </dl>

                <ControlDesk roomCreationPolicy={roomCreationPolicy} />
            </main>
        </div>
    );
}
