import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";

import { getBrandName } from "./lib/brand";
import "./globals.css";
import "./room-foundation.css";
import "./room-play-shell.css";
import "./room-table-visuals.css";
import "./room-seat-overrides.css";
import "./room-phone-layout.css";
import "./site.css";

const sans = DM_Sans({
    subsets: ["latin"],
    variable: "--font-sans",
});

const display = Fraunces({
    subsets: ["latin"],
    variable: "--font-display",
});

export function generateMetadata(): Metadata {
    const brandName = getBrandName();

    return {
        title: brandName,
        description: "Private Texas Hold'em tables with built-in voice, video, chat, and table-owner controls.",
        icons: {
            icon: "/poker.svg",
            shortcut: "/poker.svg",
            apple: "/poker.svg",
        },
    };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en" className={`${sans.variable} ${display.variable}`}>
            <body>{children}</body>
        </html>
    );
}
