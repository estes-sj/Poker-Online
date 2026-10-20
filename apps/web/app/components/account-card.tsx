"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import {
    clearStoredBrowserSession,
    getSessionDisplayName,
    writeStoredBrowserSession,
    type BrowserSessionState,
} from "../lib/browser-session";
import { createGuestSession, rotateRecoveryCode, signInWithCode, upgradeGuestAccount } from "../lib/guest-auth";
import type { GuestMode } from "../lib/guest-policy";
import { buildBrowserHttpUrl, getBrowserApiBaseUrl } from "../lib/public-service-urls";
import { DeviceLinkDialog } from "./device-link-dialog";

type AuthMode = "sign-in" | "register" | "guest" | "code";

interface AccountCardProps {
    session: BrowserSessionState | null;
    onSessionChange: (session: BrowserSessionState | null) => void;
    canManageRooms: boolean;
    guestMode: GuestMode;
}

export function AccountCard({ session, onSessionChange, canManageRooms, guestMode }: AccountCardProps) {
    const [authMode, setAuthMode] = useState<AuthMode>(guestMode === "all" ? "guest" : "sign-in");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [recoveryCodeToShow, setRecoveryCodeToShow] = useState<string | null>(null);
    const [isDeviceLinkOpen, setIsDeviceLinkOpen] = useState(false);
    const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);

    const guestTabAvailable = guestMode === "all";

    async function run(action: () => Promise<void>) {
        setIsSubmitting(true);
        setError(null);

        try {
            await action();
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : "Something went wrong. Try again.");
        } finally {
            setIsSubmitting(false);
        }
    }

    function switchMode(mode: AuthMode) {
        setAuthMode(mode);
        setError(null);
    }

    async function postCredentials(path: string, body: Record<string, unknown>, fallbackError: string) {
        const response = await fetch(buildBrowserHttpUrl(getBrowserApiBaseUrl(), path), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const payload = (await response.json()) as Partial<BrowserSessionState> & { error?: string };

        if (!response.ok || !payload.account || !payload.token) {
            throw new Error(payload.error ?? fallbackError);
        }

        const nextSession = { account: payload.account, token: payload.token };
        writeStoredBrowserSession(nextSession);
        onSessionChange(nextSession);
    }

    function switchUpgrade(open: boolean) {
        setIsUpgradeOpen(open);
        setError(null);
    }

    function signOut() {
        clearStoredBrowserSession();
        setRecoveryCodeToShow(null);
        setIsUpgradeOpen(false);
        onSessionChange(null);
    }

    if (session) {
        const isGuest = Boolean(session.account.isGuest);

        return (
            <section className="card home__account" id="account">
                <div className="account-summary">
                    <span className="account-summary__avatar" aria-hidden="true">
                        {getSessionDisplayName(session).slice(0, 1).toUpperCase()}
                    </span>
                    <div className="account-summary__text">
                        <strong>
                            {getSessionDisplayName(session)}
                            {isGuest ? <span className="tag">Guest</span> : null}
                        </strong>
                        <span>{isGuest ? "Playing without an account" : session.account.email}</span>
                    </div>
                    <button className="button button--ghost button--small" type="button" onClick={signOut}>
                        Sign out
                    </button>
                </div>

                {recoveryCodeToShow ? (
                    <RecoveryCodeNotice code={recoveryCodeToShow} onDone={() => setRecoveryCodeToShow(null)} />
                ) : null}

                {isGuest && isUpgradeOpen ? (
                    <form
                        className="form"
                        action={(formData) => run(async () => {
                            const nextSession = await upgradeGuestAccount(session.token, {
                                email: String(formData.get("email") ?? ""),
                                username: String(formData.get("username") ?? "") || undefined,
                                password: String(formData.get("password") ?? ""),
                            });
                            setIsUpgradeOpen(false);
                            onSessionChange(nextSession);
                        })}
                    >
                        <p className="form__intro">Keep your history and sign in with email and password on any device.</p>
                        <Field htmlFor="upgrade-email" label="Email">
                            <input className="control-input" id="upgrade-email" type="email" name="email" autoComplete="email" required />
                        </Field>
                        <Field htmlFor="upgrade-username" label="Username" hint={`Leave blank to keep ${session.account.username}.`}>
                            <input className="control-input" id="upgrade-username" type="text" name="username" autoComplete="username" minLength={3} />
                        </Field>
                        <Field htmlFor="upgrade-password" label="Password" hint="At least 8 characters.">
                            <input className="control-input" id="upgrade-password" type="password" name="password" autoComplete="new-password" required minLength={8} />
                        </Field>
                        {error ? <p className="form-error">{error}</p> : null}
                        <div className="button-row">
                            <button className="button button--primary" type="submit" disabled={isSubmitting}>
                                {isSubmitting ? "Saving..." : "Create full account"}
                            </button>
                            <button className="button button--ghost" type="button" onClick={() => setIsUpgradeOpen(false)}>
                                Cancel
                            </button>
                        </div>
                    </form>
                ) : (
                    <nav className="account-links" aria-label="Account shortcuts">
                        <button className="account-links__item" type="button" onClick={() => setIsDeviceLinkOpen(true)}>
                            <span>Use on another device</span>
                            <span className="account-links__hint">Show a QR code or one-time code</span>
                        </button>
                        {isGuest ? (
                            <>
                                <button
                                    className="account-links__item"
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() => void run(async () => {
                                        const result = await rotateRecoveryCode(session.token);
                                        setRecoveryCodeToShow(result.recoveryCode);
                                    })}
                                >
                                    <span>New recovery code</span>
                                    <span className="account-links__hint">Replaces your old code</span>
                                </button>
                                <button className="account-links__item" type="button" onClick={() => switchUpgrade(true)}>
                                    <span>Create full account</span>
                                    <span className="account-links__hint">Keep your history with email sign-in</span>
                                </button>
                            </>
                        ) : null}
                        <Link className="account-links__item" href="/rooms">
                            <span>Browse tables</span>
                            <span className="account-links__hint">Live and archived sessions</span>
                        </Link>
                        <Link className="account-links__item" href="/clubs">
                            <span>Club leaderboards</span>
                            <span className="account-links__hint">Standings and game ledgers</span>
                        </Link>
                        {canManageRooms ? (
                            <>
                                <Link className="account-links__item" href="/admin/rooms">
                                    <span>Manage rooms</span>
                                    <span className="account-links__hint">Bulk delete and idle cleanup</span>
                                </Link>
                                <Link className="account-links__item" href="/admin/clubs">
                                    <span>Manage clubs</span>
                                    <span className="account-links__hint">Members and recorded games</span>
                                </Link>
                                <Link className="account-links__item" href="/admin/settings">
                                    <span>Site settings</span>
                                    <span className="account-links__hint">Guest accounts</span>
                                </Link>
                            </>
                        ) : null}
                    </nav>
                )}

                {!isUpgradeOpen && error ? <p className="form-error">{error}</p> : null}

                {isDeviceLinkOpen ? <DeviceLinkDialog token={session.token} onClose={() => setIsDeviceLinkOpen(false)} /> : null}
            </section>
        );
    }

    return (
        <section className="card home__account" id="account">
            {authMode === "code" ? (
                <div className="card__header">
                    <div>
                        <h2>Have a code?</h2>
                        <p>Enter the code from your other device, or your guest recovery code.</p>
                    </div>
                </div>
            ) : (
                <div className={guestTabAvailable ? "segmented segmented--3" : "segmented"} role="tablist" aria-label="Account">
                    {guestTabAvailable ? (
                        <SegmentedOption active={authMode === "guest"} onSelect={() => switchMode("guest")}>Play as guest</SegmentedOption>
                    ) : null}
                    <SegmentedOption active={authMode === "sign-in"} onSelect={() => switchMode("sign-in")}>Sign in</SegmentedOption>
                    <SegmentedOption active={authMode === "register"} onSelect={() => switchMode("register")}>Create account</SegmentedOption>
                </div>
            )}

            {authMode === "guest" ? (
                <form
                    className="form"
                    action={(formData) => run(async () => {
                        const result = await createGuestSession(String(formData.get("displayName") ?? ""));
                        setRecoveryCodeToShow(result.recoveryCode);
                        onSessionChange(result.session);
                    })}
                >
                    <Field htmlFor="guest-display-name" label="Display name" hint="Shown at the table. No email or password needed.">
                        <input className="control-input" id="guest-display-name" type="text" name="displayName" autoComplete="nickname" required minLength={2} maxLength={24} />
                    </Field>
                    <button className="button button--primary button--block" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Starting..." : "Continue as guest"}
                    </button>
                </form>
            ) : null}

            {authMode === "sign-in" ? (
                <form className="form" action={(formData) => run(() => postCredentials("/v1/auth/login", {
                    identifier: formData.get("identifier"),
                    password: formData.get("password"),
                }, "Unable to sign in."))}>
                    <Field htmlFor="login-identifier" label="Email or username">
                        <input className="control-input" id="login-identifier" type="text" name="identifier" autoComplete="username" required />
                    </Field>
                    <Field htmlFor="login-password" label="Password">
                        <input className="control-input" id="login-password" type="password" name="password" autoComplete="current-password" required />
                    </Field>
                    <button className="button button--primary button--block" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Signing in..." : "Sign in"}
                    </button>
                </form>
            ) : null}

            {authMode === "register" ? (
                <form className="form" action={(formData) => run(() => postCredentials("/v1/auth/register", {
                    email: formData.get("email"),
                    username: formData.get("username"),
                    password: formData.get("password"),
                }, "Unable to register account."))}>
                    <Field htmlFor="register-email" label="Email">
                        <input className="control-input" id="register-email" type="email" name="email" autoComplete="email" required />
                    </Field>
                    <Field htmlFor="register-username" label="Username">
                        <input className="control-input" id="register-username" type="text" name="username" autoComplete="username" required />
                    </Field>
                    <Field htmlFor="register-password" label="Password" hint="At least 8 characters.">
                        <input className="control-input" id="register-password" type="password" name="password" autoComplete="new-password" required minLength={8} />
                    </Field>
                    <button className="button button--primary button--block" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Creating account..." : "Create account"}
                    </button>
                </form>
            ) : null}

            {authMode === "code" ? (
                <form className="form" action={(formData) => run(async () => {
                    onSessionChange(await signInWithCode(String(formData.get("code") ?? "")));
                })}>
                    <Field htmlFor="sign-in-code" label="Code" hint="6 characters from another device, or a 12-character recovery code.">
                        <input
                            className="control-input control-input--code"
                            id="sign-in-code"
                            type="text"
                            name="code"
                            autoComplete="one-time-code"
                            autoCapitalize="characters"
                            spellCheck={false}
                            required
                        />
                    </Field>
                    <button className="button button--primary button--block" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Checking..." : "Continue"}
                    </button>
                </form>
            ) : null}

            {error ? <p className="form-error">{error}</p> : null}

            <button className="text-button" type="button" onClick={() => switchMode(authMode === "code" ? "sign-in" : "code")}>
                {authMode === "code" ? "Back to sign in" : "Have a code from another device?"}
            </button>
        </section>
    );
}

export function RecoveryCodeNotice({ code, onDone }: { code: string; onDone: () => void }) {
    const [copied, setCopied] = useState(false);

    return (
        <div className="recovery-notice" role="status">
            <strong>Save your recovery code</strong>
            <p>It brings back this guest on any device, even if this browser forgets you. It is only shown now.</p>
            <code className="recovery-notice__code">{code}</code>
            <div className="button-row">
                <button
                    className="button button--secondary button--small"
                    type="button"
                    onClick={() => {
                        void navigator.clipboard?.writeText(code).then(() => setCopied(true));
                    }}
                >
                    {copied ? "Copied" : "Copy"}
                </button>
                <button className="button button--ghost button--small" type="button" onClick={onDone}>
                    I saved it
                </button>
            </div>
        </div>
    );
}

function SegmentedOption({ active, onSelect, children }: { active: boolean; onSelect: () => void; children: ReactNode }) {
    return (
        <button
            className={active ? "segmented__option segmented__option--active" : "segmented__option"}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={onSelect}
        >
            {children}
        </button>
    );
}

function Field({ children, hint, htmlFor, label }: { children: ReactNode; hint?: string; htmlFor: string; label: string }) {
    return (
        <div className="field">
            <label className="field__label" htmlFor={htmlFor}>{label}</label>
            {children}
            {hint ? <span className="field__hint">{hint}</span> : null}
        </div>
    );
}
