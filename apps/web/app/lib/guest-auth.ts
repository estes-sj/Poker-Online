import { writeStoredBrowserSession, type BrowserSessionState } from "./browser-session";
import { buildBrowserHttpUrl, getBrowserApiBaseUrl } from "./public-service-urls";

const DEVICE_CODE_LENGTH = 6;

export async function createGuestSession(displayName: string, roomSlug?: string): Promise<{ session: BrowserSessionState; recoveryCode: string }> {
    const payload = await postAuth<BrowserSessionState & { recoveryCode: string }>("/v1/auth/guest", { displayName, roomSlug }, null, "Unable to start as a guest.");
    const session = { account: payload.account, token: payload.token };
    writeStoredBrowserSession(session);
    return { session, recoveryCode: payload.recoveryCode };
}

/** Accepts either a 6-character device code or a 12-character recovery code. */
export async function signInWithCode(rawCode: string): Promise<BrowserSessionState> {
    const code = rawCode.replace(/[\s-]/g, "");
    const isDeviceCode = code.length === DEVICE_CODE_LENGTH;
    const payload = isDeviceCode
        ? await postAuth<BrowserSessionState>("/v1/auth/device-link/claim", { code }, null, "That code is not valid or has expired.")
        : await postAuth<BrowserSessionState>("/v1/auth/guest/recover", { recoveryCode: code }, null, "That recovery code is not valid.");
    const session = { account: payload.account, token: payload.token };
    writeStoredBrowserSession(session);
    return session;
}

export async function createDeviceLinkCode(token: string): Promise<{ code: string; expiresAt: string }> {
    return postAuth("/v1/auth/device-link", {}, token, "Unable to create a device code.");
}

export async function rotateRecoveryCode(token: string): Promise<{ recoveryCode: string }> {
    return postAuth("/v1/auth/guest/recovery-code", {}, token, "Unable to create a new recovery code.");
}

export async function upgradeGuestAccount(
    token: string,
    input: { email: string; username?: string; password: string },
): Promise<BrowserSessionState> {
    const payload = await postAuth<BrowserSessionState>("/v1/auth/upgrade", input, token, "Unable to create the full account.");
    const session = { account: payload.account, token: payload.token };
    writeStoredBrowserSession(session);
    return session;
}

export function formatDeviceCode(code: string): string {
    return code.length === DEVICE_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

async function postAuth<T>(path: string, body: Record<string, unknown>, token: string | null, fallbackError: string): Promise<T> {
    const response = await fetch(buildBrowserHttpUrl(getBrowserApiBaseUrl(), path), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

    if (!response.ok) {
        throw new Error(payload.error ?? fallbackError);
    }

    return payload;
}
