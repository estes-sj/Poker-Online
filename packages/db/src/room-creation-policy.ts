export interface RoomCreationAdminConfig {
  adminOnly: boolean;
  adminUsername: string | null;
  adminPassword: string | null;
  adminEmail: string | null;
}

export function getRoomCreationAdminConfig(
  env: Record<string, string | undefined> = process.env,
): RoomCreationAdminConfig {
  const adminUsername = normalizeEnvValue(env.ROOM_CREATION_ADMIN_USERNAME);
  const adminPassword = normalizeEnvValue(env.ROOM_CREATION_ADMIN_PASSWORD);

  return {
    adminOnly: parseBooleanFlag(env.ROOM_CREATION_ADMIN_ONLY),
    adminUsername,
    adminPassword,
    adminEmail: adminUsername ? deriveRoomCreationAdminEmail(adminUsername) : null,
  };
}

export function isConfiguredRoomCreationAdmin(
  username: string | null | undefined,
  configuredUsername: string | null,
): boolean {
  return Boolean(
    username
    && configuredUsername
    && username.trim().toLowerCase() === configuredUsername.trim().toLowerCase(),
  );
}

function normalizeEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseBooleanFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function deriveRoomCreationAdminEmail(username: string): string {
  const localPart = username.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "table.admin";
  return `${localPart}@local.poker`;
}