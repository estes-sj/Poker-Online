export interface ClubSummary {
    clubId: string;
    slug: string;
    name: string;
    ownerUsername: string;
    memberCount: number;
    linkedRoomCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface ClubLeaderboardEntry {
    accountId: string;
    username: string;
    displayName?: string;
    totalProfit: number;
    gamesPlayed: number;
    updatedAt: string;
    isSynthetic: boolean;
}

export interface ClubGameLedgerEntry {
    accountId: string;
    username: string;
    displayName: string;
    hoursPlayed: string | null;
    totalBuyIn: number;
    cashOut: number;
    netResult: number;
    isSynthetic: boolean;
}

export interface ClubGameLedger {
    gameId: string;
    label: string;
    playedAt: string;
    importedAt: string;
    entryCount: number;
    ledger: ClubGameLedgerEntry[];
}

export interface ClubDetails extends ClubSummary {
    leaderboard: ClubLeaderboardEntry[];
    gameHistory: ClubGameLedger[];
}

export async function fetchClubs(): Promise<ClubSummary[]> {
    const baseUrl = process.env.GAME_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_GAME_HTTP_URL ?? "http://localhost:4200";

    try {
        const response = await fetch(new URL("/v1/clubs", baseUrl), {
            cache: "no-store",
        });

        if (!response.ok) {
            return [];
        }

        const payload = (await response.json()) as ClubSummary[];
        return Array.isArray(payload) ? payload : [];
    } catch {
        return [];
    }
}

export async function fetchClub(slug: string): Promise<ClubDetails | null> {
    const baseUrl = process.env.GAME_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_GAME_HTTP_URL ?? "http://localhost:4200";

    try {
        const response = await fetch(new URL(`/v1/clubs/${slug}`, baseUrl), {
            cache: "no-store",
        });

        if (!response.ok) {
            return null;
        }

        return (await response.json()) as ClubDetails;
    } catch {
        return null;
    }
}