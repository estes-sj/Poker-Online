import { RoomClient } from "./room-client";
import { buildDemoRoomPreset } from "./demo-room";
import { getBrandName } from "../../lib/brand";
import { loadHouseRulesConfig } from "../../lib/house-rules-config-server";
import { fetchGuestMode } from "../../lib/guest-policy";
import type { RoomSnapshot } from "./room-types";

export const dynamic = "force-dynamic";

export default async function RoomPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const demoPreset = buildDemoRoomPreset(slug);
    const accountId = demoPreset?.initialAccountId;
    // Server render is a spectator view; the client subscribes with its session token for the personal view.
    const snapshot = demoPreset?.snapshot ?? await fetchRoomSnapshot(slug);
    const houseRulesConfig = await loadHouseRulesConfig();
    const brandName = getBrandName();
    const guestMode = demoPreset ? "off" : await fetchGuestMode();

    return (
        <RoomClient
            slug={slug}
            initialSnapshot={snapshot}
            initialAccountId={accountId}
            demoMode={Boolean(demoPreset)}
            demoMediaParticipants={demoPreset?.demoMediaParticipants ?? []}
            houseRulesConfig={houseRulesConfig}
            brandName={brandName}
            guestMode={guestMode}
        />
    );
}

async function fetchRoomSnapshot(slug: string): Promise<RoomSnapshot | null> {
    const baseUrl = process.env.GAME_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_GAME_HTTP_URL ?? "http://localhost:4200";

    try {
        const url = new URL(`/v1/rooms/${slug}`, baseUrl);

        const response = await fetch(url, {
            cache: "no-store",
        });

        if (!response.ok) {
            return null;
        }

        return (await response.json()) as RoomSnapshot;
    } catch {
        return null;
    }
}
