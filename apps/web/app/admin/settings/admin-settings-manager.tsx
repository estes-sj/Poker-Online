"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
    isConfiguredRoomCreationAdmin,
    readStoredBrowserSession,
    type BrowserSessionState,
} from "../../lib/browser-session";
import { isGuestMode, type GuestMode } from "../../lib/guest-policy";
import { buildBrowserHttpUrl, getBrowserGameHttpBaseUrl } from "../../lib/public-service-urls";

const GUEST_MODE_OPTIONS: Array<{ value: GuestMode; label: string; hint: string }> = [
    {
        value: "off",
        label: "Off",
        hint: "Everyone needs a full account to join a table.",
    },
    {
        value: "all",
        label: "Every table",
        hint: "Anyone can play as a guest at any table. The home page offers \"Play as guest\".",
    },
    {
        value: "per-room",
        label: "Host decides per table",
        hint: "Each table has an \"Allow guests\" switch. Guests can only join tables where it is on.",
    },
];

interface AdminSettingsManagerProps {
    roomCreationPolicy: {
        adminOnly: boolean;
        adminUsername: string | null;
    };
}

export function AdminSettingsManager({ roomCreationPolicy }: AdminSettingsManagerProps) {
    const [session, setSession] = useState<BrowserSessionState | null>(null);
    const [savedMode, setSavedMode] = useState<GuestMode | null>(null);
    const [selectedMode, setSelectedMode] = useState<GuestMode | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const canManage = Boolean(session && isConfiguredRoomCreationAdmin(session.account.username, roomCreationPolicy.adminUsername));

    useEffect(() => {
        const storedSession = readStoredBrowserSession();
        setSession(storedSession);

        if (!storedSession || !isConfiguredRoomCreationAdmin(storedSession.account.username, roomCreationPolicy.adminUsername)) {
            setIsLoading(false);
            return;
        }

        void (async () => {
            try {
                const payload = await requestSettings(storedSession.token, "GET");
                setSavedMode(payload);
                setSelectedMode(payload);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Unable to load settings.");
            } finally {
                setIsLoading(false);
            }
        })();
    }, [roomCreationPolicy.adminUsername]);

    async function save() {
        if (!session || !selectedMode) {
            return;
        }

        setIsSaving(true);
        setError(null);
        setNotice(null);

        try {
            const payload = await requestSettings(session.token, "POST", selectedMode);
            setSavedMode(payload);
            setSelectedMode(payload);
            setNotice("Saved. The change applies to new joins right away.");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Unable to save settings.");
        } finally {
            setIsSaving(false);
        }
    }

    if (!canManage) {
        return (
            <section className="card">
                <header className="card__header">
                    <div>
                        <h2>{session ? "This account cannot change site settings" : "Sign in to change site settings"}</h2>
                        <p>Site settings are only available to the configured admin account.</p>
                    </div>
                </header>
                <div className="button-row">
                    <Link className="button button--primary" href="/#account">Go to sign in</Link>
                </div>
            </section>
        );
    }

    return (
        <section className="card">
            <header className="card__header">
                <div>
                    <h2>Guest accounts</h2>
                    <p>Guests play without email or password. They can move between devices with a one-time code or their recovery code, and can upgrade to a full account later.</p>
                </div>
            </header>

            {isLoading ? <p className="notice">Loading settings...</p> : (
                <fieldset className="choice-list" disabled={isSaving}>
                    <legend className="visually-hidden">Guest accounts</legend>
                    {GUEST_MODE_OPTIONS.map((option) => (
                        <label key={option.value} className="choice">
                            <input
                                type="radio"
                                name="guestMode"
                                value={option.value}
                                checked={selectedMode === option.value}
                                onChange={() => setSelectedMode(option.value)}
                            />
                            <span className="choice__text">
                                <span className="choice__label">{option.label}</span>
                                <span className="choice__hint">{option.hint}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>
            )}

            <div className="form-footer">
                {error ? <p className="form-error">{error}</p> : null}
                {notice ? <p className="form-success form-success--plain">{notice}</p> : null}
                <button
                    className="button button--primary"
                    type="button"
                    onClick={() => void save()}
                    disabled={isLoading || isSaving || !selectedMode || selectedMode === savedMode}
                >
                    {isSaving ? "Saving..." : "Save"}
                </button>
            </div>
        </section>
    );
}

async function requestSettings(token: string, method: "GET" | "POST", guestMode?: GuestMode): Promise<GuestMode> {
    const response = await fetch(buildBrowserHttpUrl(getBrowserGameHttpBaseUrl(), "/v1/admin/settings"), {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: method === "POST" ? JSON.stringify({ guestMode }) : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as { guestMode?: string; error?: string };

    if (!response.ok || !isGuestMode(payload.guestMode)) {
        throw new Error(payload.error ?? "Unable to load settings.");
    }

    return payload.guestMode;
}
