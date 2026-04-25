export interface RoomCreationPolicy {
    adminOnly: boolean;
    adminUsername: string | null;
}

export function getRoomCreationPolicy(): RoomCreationPolicy {
    const adminUsername = process.env.ROOM_CREATION_ADMIN_USERNAME?.trim() || null;
    const adminOnly = ["1", "true", "yes", "on"].includes((process.env.ROOM_CREATION_ADMIN_ONLY ?? "").trim().toLowerCase());

    return {
        adminOnly,
        adminUsername,
    };
}