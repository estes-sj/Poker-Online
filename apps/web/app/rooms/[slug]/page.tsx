import { RoomClient } from "./room-client";
import { buildDemoRoomPreset } from "./demo-room";
import { getBrandName } from "../../lib/brand";
import { loadHouseRulesConfig } from "../../lib/house-rules-config-server";
import type { RoomSnapshot } from "./room-types";

export const dynamic = "force-dynamic";

export default async function RoomPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ accountId?: string | string[] }>;
}) {
    const { slug } = await params;
    const resolvedSearchParams = await searchParams;
    const requestedAccountId = Array.isArray(resolvedSearchParams.accountId)
        ? resolvedSearchParams.accountId[0]
        : resolvedSearchParams.accountId;
    const demoPreset = buildDemoRoomPreset(slug);
    const accountId = requestedAccountId ?? demoPreset?.initialAccountId;
    const snapshot = demoPreset?.snapshot ?? await fetchRoomSnapshot(slug, requestedAccountId);
    const houseRulesConfig = await loadHouseRulesConfig();
    const brandName = getBrandName();

    return (
        <RoomClient
            slug={slug}
            initialSnapshot={snapshot}
            initialAccountId={accountId}
            demoMode={Boolean(demoPreset)}
            demoMediaParticipants={demoPreset?.demoMediaParticipants ?? []}
            houseRulesConfig={houseRulesConfig}
            brandName={brandName}
        />
    );
}

async function fetchRoomSnapshot(slug: string, accountId?: string): Promise<RoomSnapshot | null> {
    const baseUrl = process.env.GAME_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_GAME_HTTP_URL ?? "http://localhost:4200";

    try {
        const url = new URL(`/v1/rooms/${slug}`, baseUrl);

        if (accountId) {
            url.searchParams.set("accountId", accountId);
        }

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
