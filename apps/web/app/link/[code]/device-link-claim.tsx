"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { signInWithCode } from "../../lib/guest-auth";

export function DeviceLinkClaim({ code, nextPath }: { code: string; nextPath: string }) {
    const [error, setError] = useState<string | null>(null);
    const hasClaimedRef = useRef(false);

    useEffect(() => {
        // Codes work once, so guard against the effect running twice in development.
        if (hasClaimedRef.current) {
            return;
        }

        hasClaimedRef.current = true;

        signInWithCode(code)
            .then(() => window.location.replace(nextPath))
            .catch((claimError: unknown) => {
                setError(claimError instanceof Error ? claimError.message : "That code is not valid or has expired.");
            });
    }, [code, nextPath]);

    return (
        <section className="card">
            <header className="card__header">
                <div>
                    <h2>{error ? "This link did not work" : "Signing you in..."}</h2>
                    <p>
                        {error
                            ? `${error} Ask for a new code on your other device.`
                            : "Connecting this device to your account."}
                    </p>
                </div>
            </header>
            {error ? (
                <div className="button-row">
                    <Link className="button button--secondary" href="/#account">Enter a code instead</Link>
                </div>
            ) : null}
        </section>
    );
}
