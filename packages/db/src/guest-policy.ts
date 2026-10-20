import type { PrismaClient } from "@prisma/client";

export type GuestMode = "off" | "all" | "per-room";

export const GUEST_MODES: readonly GuestMode[] = ["off", "all", "per-room"];

const GUEST_MODE_SETTING_KEY = "guestMode";
const GUEST_MODE_CACHE_MS = 10_000;

let cachedGuestMode: { mode: GuestMode; expiresAt: number } | null = null;

export function isGuestMode(value: unknown): value is GuestMode {
  return typeof value === "string" && (GUEST_MODES as readonly string[]).includes(value);
}

export function getDefaultGuestMode(env: Record<string, string | undefined> = process.env): GuestMode {
  const configured = env.GUEST_ACCOUNTS_DEFAULT_MODE?.trim().toLowerCase();
  return isGuestMode(configured) ? configured : "off";
}

/** Reads the admin-saved guest mode, falling back to GUEST_ACCOUNTS_DEFAULT_MODE until one is saved. */
export async function getGuestMode(database: PrismaClient): Promise<GuestMode> {
  if (cachedGuestMode && cachedGuestMode.expiresAt > Date.now()) {
    return cachedGuestMode.mode;
  }

  const setting = await database.siteSetting.findUnique({ where: { key: GUEST_MODE_SETTING_KEY } });
  const mode = isGuestMode(setting?.value) ? setting.value : getDefaultGuestMode();

  cachedGuestMode = { mode, expiresAt: Date.now() + GUEST_MODE_CACHE_MS };
  return mode;
}

export async function setGuestMode(database: PrismaClient, mode: GuestMode): Promise<GuestMode> {
  await database.siteSetting.upsert({
    where: { key: GUEST_MODE_SETTING_KEY },
    create: { key: GUEST_MODE_SETTING_KEY, value: mode },
    update: { value: mode },
  });

  cachedGuestMode = { mode, expiresAt: Date.now() + GUEST_MODE_CACHE_MS };
  return mode;
}

export function roomAllowsGuests(mode: GuestMode, roomAllowsGuestsOption: boolean | undefined): boolean {
  return mode === "all" || (mode === "per-room" && Boolean(roomAllowsGuestsOption));
}

/** Room-level guest flag lives in the persisted runtime state's admin options. */
export function readRoomAllowGuestsOption(runtimeState: unknown): boolean {
  if (!runtimeState || typeof runtimeState !== "object") {
    return false;
  }

  const adminOptions = (runtimeState as { adminOptions?: { allowGuests?: unknown } }).adminOptions;
  return adminOptions?.allowGuests === true;
}
