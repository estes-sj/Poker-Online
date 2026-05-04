import Link from "next/link";

import { Panel, SectionHeading } from "@poker/ui";

import { ControlDesk } from "./components/control-desk";
import { getRoomCreationPolicy } from "./lib/room-creation-policy";

export const dynamic = "force-dynamic";

const heroProof = [
    {
        value: "2-10",
        label: "Seats per room",
    },
    {
        value: "Live",
        label: "Voice and video at the table",
    },
    {
        value: "Saved",
        label: "Archived hands and ledger",
    },
];

const roomCoverage = [
    {
        title: "Before the first deal",
        copy: "Share one room link, add a password if you need privacy, and handle late seat requests without leaving the table.",
    },
    {
        title: "While the hand is live",
        copy: "Players can talk, react, rebuy, and follow the log while the host controls timers, blind levels, pauses, and starts.",
    },
    {
        title: "After the session",
        copy: "Keep the ledger, surface archived rooms in the lobby, and replay hands back on the felt instead of reading raw logs.",
    },
];

const hostFlow = [
    {
        eyebrow: "01",
        title: "Set the table once",
        copy: "Room settings handle the routine setup work so hosts can stop narrating logistics in chat.",
        points: [
            "Choose the seat count and starting stack.",
            "Turn auto-start on or off for the pace you want.",
            "Lock the room with a password when the group is private.",
        ],
    },
    {
        eyebrow: "02",
        title: "Keep the game moving",
        copy: "Admin controls stay inside the table, where they are visible and fast to reach.",
        points: [
            "Approve seats and rebuys from the same room.",
            "Pause, stop, or archive the table without changing views.",
            "Adjust blinds, timers, and schedule from one drawer.",
        ],
    },
    {
        eyebrow: "03",
        title: "Leave with a readable record",
        copy: "When the night is over, the session still reads cleanly for the next conversation.",
        points: [
            "Ledger tracks wins, rebuys, and net across the room.",
            "Archived sessions stay visible on the rooms page.",
            "Selected hands can replay on the table, not just in text.",
        ],
    },
];

const productNotes = [
    {
        title: "The table is the product",
        copy: "Players land on a readable felt with seats, cards, voice, video, action controls, and the hand log in one place.",
    },
    {
        title: "Host controls do not feel bolted on",
        copy: "Seat approvals, blind changes, timers, and room state live near the felt instead of in a separate back-office UI.",
    },
    {
        title: "Replay stays part of the night",
        copy: "Archived hands can reopen and play back on the table, which is more useful than shipping players off to a raw export.",
    },
];

export default function HomePage() {
    const roomCreationPolicy = getRoomCreationPolicy();

    return (
        <main className="landing-shell landing-shell--home">
            <section className="landing-hero">
                <div className="hero__copy landing-hero__copy">
                    <Link className="hero-brand" href="/">
                        <img className="hero-brand__mark" src="/poker.svg" alt="Poker Poker logo" />
                        <span className="hero-brand__text">
                            <span className="hero-brand__name">Poker Poker</span>
                            <span className="hero-brand__tagline">Online poker for real home games</span>
                        </span>
                    </Link>
                    <span className="eyebrow landing-hero__eyebrow">Host the room, not a pile of tabs</span>
                    <h1>Run the whole poker night from the table.</h1>
                    <p className="landing-hero__lede">
                        Poker Poker keeps the parts hosts actually manage in one place: the invite link, seating,
                        voice and camera, rebuys, blind controls, hand flow, session ledger, and archived replays.
                    </p>
                    <div className="hero__actions">
                        <Link className="button button--primary" href="#host-a-game">
                            Sign in or open a room
                        </Link>
                        <Link className="button button--secondary" href="/rooms">Browse rooms</Link>
                        <Link className="button button--secondary" href="/clubs">Browse clubs</Link>
                        <Link className="button button--secondary" href="/rooms/sample-table">View sample table</Link>
                    </div>
                    <div className="landing-hero__proof" aria-label="Product highlights">
                        {heroProof.map((item) => (
                            <div key={item.label} className="landing-proof-card">
                                <strong>{item.value}</strong>
                                <span>{item.label}</span>
                            </div>
                        ))}
                    </div>

                    <Panel className="landing-hero__brief landing-hero__brief--inline" eyebrow="What the room handles" title="One place to run the full night.">
                        <div className="landing-brief-list">
                            {roomCoverage.map((item) => (
                                <article key={item.title} className="landing-brief-list__item">
                                    <strong>{item.title}</strong>
                                    <p>{item.copy}</p>
                                </article>
                            ))}
                        </div>
                    </Panel>
                </div>

                <div className="landing-hero__side">
                    <ControlDesk roomCreationPolicy={roomCreationPolicy} />
                </div>
            </section>

            <section className="content-grid landing-section" id="why-poker">
                <SectionHeading eyebrow="How the room works" title="Useful before the deal, during the hand, and after the session ends.">
                    The product is built around the moments hosts usually patch together by hand: setup, pacing, approvals,
                    table communication, and the recap when everyone wants to review a spot later.
                </SectionHeading>

                <div className="landing-flow-grid">
                    {hostFlow.map((item) => (
                        <Panel key={item.title} eyebrow={item.eyebrow} title={item.title} className="landing-flow-card">
                            <p>{item.copy}</p>
                            <ul className="stack-list landing-flow-card__list">
                                {item.points.map((point) => (
                                    <li key={point}>{point}</li>
                                ))}
                            </ul>
                        </Panel>
                    ))}
                </div>
            </section>

            <section className="content-grid landing-section landing-section--notes">
                <SectionHeading eyebrow="Why it feels better" title="Clear enough for players, controlled enough for the host.">
                    The aim is not to add more dashboard chrome. It is to make the room feel organized when the table is full,
                    people are talking over each other, someone needs a rebuy, and another player wants to replay the last hand.
                </SectionHeading>

                <div className="panel-grid landing-notes-grid">
                    {productNotes.map((item) => (
                        <Panel key={item.title} title={item.title} className="landing-note-card">
                            <p>{item.copy}</p>
                        </Panel>
                    ))}
                </div>
            </section>

            <section className="landing-closing">
                <Panel
                    className="landing-closing__panel"
                    eyebrow="Start with the room"
                    title="Open a table, bring the players in, and let the night run from there."
                    footer={(
                        <div className="action-row landing-closing__actions">
                            <Link className="button button--primary" href="#host-a-game">
                                Sign in or open a room
                            </Link>
                            <Link className="button button--secondary" href="/rooms">
                                Browse live and archived rooms
                            </Link>
                        </div>
                    )}
                >
                    <p>
                        If you want to see the table layout before opening your own room, the sample table is live and the
                        public rooms page shows both active games and archived sessions.
                    </p>
                </Panel>
            </section>
        </main>
    );
}
