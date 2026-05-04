export interface BrowserSessionState {
  account: {
    id: string;
    email: string;
    username: string;
    createdAt: string;
  };
  token: string;
}

export const SESSION_STORAGE_KEY = "river-club-session";
export const SESSION_STORAGE_EVENT = "river-club-session-change";

function emitSessionStorageEvent(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(SESSION_STORAGE_EVENT));
}

export function readStoredBrowserSession(): BrowserSessionState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as BrowserSessionState;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function writeStoredBrowserSession(session: BrowserSessionState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  emitSessionStorageEvent();
}

export function clearStoredBrowserSession(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  emitSessionStorageEvent();
}

export function isConfiguredRoomCreationAdmin(username: string | null | undefined, configuredAdminUsername: string | null): boolean {
  return Boolean(
    username
    && configuredAdminUsername
    && username.trim().toLowerCase() === configuredAdminUsername.trim().toLowerCase(),
  );
}