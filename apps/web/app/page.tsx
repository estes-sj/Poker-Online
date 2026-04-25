import Link from "next/link";

import { Panel, SectionHeading } from "@poker/ui";

import { ControlDesk } from "./components/control-desk";
import { getRoomCreationPolicy } from "./lib/room-creation-policy";

export const dynamic = "force-dynamic";

const platformPillars = [
    {
        title: "Private tables that stay private",
        copy: "Open a room for your group, protect it with a password if you want, and keep invites, seating, and ownership in one place.",
    },
    {
        title: "Voice and video in the room",
        copy: "Players can talk, show up on camera, and stay at the table without bouncing between poker and a separate call.",
    },
    {
        title: "Owner controls that keep the game moving",
        copy: "Handle seat requests, rebuys, timers, blind levels, pauses, and hand starts from the same table interface your players use.",
    },
];

const landingHighlights = [
    "Create a table, share one link, and bring everyone into the same room.",
    "Run no-limit Hold'em with built-in chat, reactions, gestures, rebuys, and session tracking.",
    "Keep home games organized with clean seat flow, table-owner controls, and real-time updates.",
];

export default function HomePage() {
    const roomCreationPolicy = getRoomCreationPolicy();

    return (
        <main className="landing-shell">
            <section className="hero">
                <div className="hero__copy">
                    <Link className="hero-brand" href="/">
                        <img className="hero-brand__mark" src="/poker.svg" alt="Poker Poker logo" />
                        <span className="hero-brand__text">
                            <span className="hero-brand__name">Poker Poker</span>
                            <span className="hero-brand__tagline">Private tables. Built-in voice. Better home games.</span>
                        </span>
                    </Link>
                    <h1>Run your poker night in one room.</h1>
                    <p>
                        Poker Poker gives you private Texas Hold'em tables with built-in voice and video, owner controls,
                        and a table flow that keeps the game clear for everyone at the felt.
                    </p>
                    <div className="hero__actions">
                        <Link className="button button--primary" href="#host-a-game">
                            Create a table
                        </Link>
                        <Link className="button button--secondary" href="#why-poker">See what players get</Link>
                        <Link className="button button--secondary" href="/rooms/sample-table">View sample table</Link>
                    </div>
                </div>

                <ControlDesk roomCreationPolicy={roomCreationPolicy} />
            </section>

            <section className="content-grid" id="why-poker">
                <SectionHeading eyebrow="Why Poker" title="Everything your table needs, without juggling tabs.">
                    Host a private cash game, manage the table, and keep players connected in a single room built for real home-game sessions.
                </SectionHeading>

                <div className="panel-grid">
                    <Panel title="What you can do tonight">
                        <ul className="stack-list">
                            {landingHighlights.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </Panel>
                    {platformPillars.map((pillar) => (
                        <Panel key={pillar.title} title={pillar.title}>
                            <p>{pillar.copy}</p>
                        </Panel>
                    ))}
                </div>
            </section>
        </main>
    );
}
