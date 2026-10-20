export type GuestMode = "off" | "all" | "per-room";

/** Server-side read of the admin-controlled guest mode. Falls back to "off" if the game service is unreachable. */
export async function fetchGuestMode(): Promise<GuestMode> {
    const baseUrl = process.env.GAME_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_GAME_HTTP_URL ?? "http://localhost:4200";

    try {
        const response = await fetch(new URL("/v1/settings", baseUrl), { cache: "no-store" });

        if (!response.ok) {
            return "off";
        }

        const payload = (await response.json()) as { guestMode?: string };
        return isGuestMode(payload.guestMode) ? payload.guestMode : "off";
    } catch {
        return "off";
    }
}

export function isGuestMode(value: unknown): value is GuestMode {
    return value === "off" || value === "all" || value === "per-room";
}

export function roomAllowsGuests(mode: GuestMode, roomAllowsGuestsOption: boolean | undefined): boolean {
    return mode === "all" || (mode === "per-room" && Boolean(roomAllowsGuestsOption));
}
