"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import { createDeviceLinkCode, formatDeviceCode } from "../lib/guest-auth";

interface DeviceLinkDialogProps {
    token: string;
    /** Path to open after the other device signs in, such as the current table. */
    nextPath?: string;
    onClose: () => void;
}

export function DeviceLinkDialog({ token, nextPath, onClose }: DeviceLinkDialogProps) {
    const [code, setCode] = useState<string | null>(null);
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const [qrSvg, setQrSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const linkUrl = code && typeof window !== "undefined"
        ? `${window.location.origin}/link/${code}${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`
        : null;
    const secondsLeft = expiresAt ? Math.max(0, Math.round((expiresAt - now) / 1000)) : 0;
    const isExpired = Boolean(expiresAt) && secondsLeft === 0;

    const generate = useCallback(async () => {
        setError(null);
        setCode(null);
        setQrSvg(null);

        try {
            const result = await createDeviceLinkCode(token);
            setCode(result.code);
            setExpiresAt(Date.parse(result.expiresAt));
        } catch (generateError) {
            setError(generateError instanceof Error ? generateError.message : "Unable to create a device code.");
        }
    }, [token]);

    useEffect(() => {
        void generate();
    }, [generate]);

    useEffect(() => {
        if (!linkUrl) {
            return;
        }

        let cancelled = false;

        void QRCode.toString(linkUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111317", light: "#ffffff" } })
            .then((svg) => {
                if (!cancelled) {
                    setQrSvg(svg);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setQrSvg(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [linkUrl]);

    useEffect(() => {
        const interval = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return (
        <div className="site site--overlay">
            <div className="dialog-backdrop" onClick={onClose}>
                <section
                    className="dialog card"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="device-link-title"
                    onClick={(event) => event.stopPropagation()}
                >
                    <header className="card__header">
                        <div>
                            <h2 id="device-link-title">Use on another device</h2>
                            <p>Scan the code, or open the home page on the other device and enter the code under &ldquo;Have a code?&rdquo;.</p>
                        </div>
                        <button className="icon-button" type="button" onClick={onClose} aria-label="Close">×</button>
                    </header>

                    {error ? <p className="form-error">{error}</p> : null}

                    <div className="device-link">
                        <div className={isExpired ? "device-link__qr device-link__qr--expired" : "device-link__qr"}>
                            {qrSvg ? <span dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <span className="device-link__qr-placeholder" />}
                        </div>
                        <div className="device-link__details">
                            <span className="field__label">Code</span>
                            <strong className="device-link__code">{code ? formatDeviceCode(code) : "······"}</strong>
                            <span className="field__hint">
                                {isExpired
                                    ? "This code has expired."
                                    : code
                                        ? `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}. Works once.`
                                        : "Creating a code..."}
                            </span>
                            {linkUrl && !isExpired ? (
                                <button
                                    className="button button--secondary button--small"
                                    type="button"
                                    onClick={() => void navigator.clipboard?.writeText(linkUrl)}
                                >
                                    Copy link
                                </button>
                            ) : null}
                            {isExpired ? (
                                <button className="button button--secondary button--small" type="button" onClick={() => void generate()}>
                                    New code
                                </button>
                            ) : null}
                        </div>
                    </div>

                    <p className="dialog__note">You stay signed in here too. Anyone with this code can use your account until it expires, so only share it with yourself.</p>
                </section>
            </div>
        </div>
    );
}
