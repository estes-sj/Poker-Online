"use client";

import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { Participant, Room as LiveKitRoom, TrackPublication } from "livekit-client";

import { clearStoredBrowserSession, readStoredBrowserSession } from "../../lib/browser-session";
import { buildBrowserHttpUrl, getBrowserApiBaseUrl } from "../../lib/public-service-urls";
import type { MediaParticipantState } from "./media-types";
import type { SessionState } from "./room-types";

type LiveKitModule = typeof import("livekit-client");

interface TableMediaOptions {
    slug: string;
    session: SessionState | null;
    canConnect: boolean;
    displayName: string;
}

interface TurnTlsOverride {
    domain: string;
    port: number;
    url: string;
}

interface MediaTokenResponse {
    token: string;
    wsUrl: string;
    roomName: string;
    turnTls?: TurnTlsOverride;
    participant: {
        id: string;
        name: string;
    };
}

interface InternalLiveKitIceServer {
    urls: string[];
    username?: string;
    credential?: string;
}

interface InternalLiveKitEngine {
    rtcConfig: RTCConfiguration;
    latestJoinResponse?: {
        iceServers?: InternalLiveKitIceServer[];
    };
    pcManager?: {
        updateConfiguration(config: RTCConfiguration, iceRestart?: boolean): void;
    };
}

type InternalLiveKitRoom = LiveKitRoom & {
    engine?: InternalLiveKitEngine;
};

export interface TableMediaState {
    participants: MediaParticipantState[];
    localParticipant: MediaParticipantState | null;
    remoteParticipants: MediaParticipantState[];
    mediaStatus: "idle" | "connecting" | "connected";
    mediaError: string | null;
    environmentError: string | null;
    microphoneEnabled: boolean;
    cameraEnabled: boolean;
    isConnected: boolean;
    /** Connects to the table's media room, then turns on `enableDevice` if one is given. */
    handleConnectMedia: (enableDevice?: "microphone" | "camera") => Promise<void>;
    handleToggleMicrophone: () => Promise<void>;
    handleToggleCamera: () => Promise<void>;
    handleDisconnectMedia: () => void;
}

export function useTableMedia({ slug, session, canConnect, displayName }: TableMediaOptions): TableMediaState {
    const roomRef = useRef<LiveKitRoom | null>(null);
    const liveKitModuleRef = useRef<LiveKitModule | null>(null);
    const [participants, setParticipants] = useState<MediaParticipantState[]>([]);
    const [mediaStatus, setMediaStatus] = useState<"idle" | "connecting" | "connected">("idle");
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [environmentError, setEnvironmentError] = useState<string | null>(null);

    useEffect(() => {
        return () => {
            disconnectRoom(roomRef, setParticipants, setMediaStatus);
        };
    }, []);

    useEffect(() => {
        setEnvironmentError(getMediaEnvironmentError());
    }, []);

    useEffect(() => {
        if (session || !roomRef.current) {
            return;
        }

        disconnectRoom(roomRef, setParticipants, setMediaStatus);
    }, [session]);

    useEffect(() => {
        if (canConnect || !roomRef.current) {
            return;
        }

        disconnectRoom(roomRef, setParticipants, setMediaStatus);
    }, [canConnect]);

    const localParticipant = participants.find((participant) => participant.isLocal) ?? null;
    const remoteParticipants = participants.filter((participant) => !participant.isLocal);
    const microphoneEnabled = isPublicationEnabled(localParticipant?.audioPublication ?? null);
    const cameraEnabled = isPublicationEnabled(localParticipant?.videoPublication ?? null);

    async function handleConnectMedia(enableDevice?: "microphone" | "camera") {
        const activeSession = readStoredBrowserSession() ?? session;

        if (!activeSession) {
            setMediaError("Sign in before connecting voice and video.");
            return;
        }

        if (!canConnect) {
            setMediaError("Join the room first so media access stays scoped to this table.");
            return;
        }

        const prerequisiteError = getMediaEnvironmentError();

        if (prerequisiteError) {
            setEnvironmentError(prerequisiteError);
            setMediaError(prerequisiteError);
            return;
        }

        setMediaStatus("connecting");
        setMediaError(null);

        try {
            const liveKitModule = await loadLiveKitModule(liveKitModuleRef);
            const apiBaseUrl = getBrowserApiBaseUrl();
            const tokenResponse = await fetch(buildBrowserHttpUrl(apiBaseUrl, "/v1/media/token"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${activeSession.token}`,
                },
                body: JSON.stringify({
                    slug,
                    participantName: displayName.trim() || activeSession.account.username,
                }),
            });
            const tokenPayload = (await tokenResponse.json()) as Partial<MediaTokenResponse> & { error?: string };

            if (tokenResponse.status === 401) {
                clearStoredBrowserSession();
                throw new Error("Your session expired. Sign in again before connecting media.");
            }

            if (!tokenResponse.ok || !tokenPayload.token || !tokenPayload.wsUrl) {
                throw new Error(tokenPayload.error ?? "Unable to connect media for this room.");
            }

            const nextRoom = new liveKitModule.Room();
            nextRoom.on(liveKitModule.RoomEvent.SignalConnected, () => {
                applyTurnTlsOverride(nextRoom as InternalLiveKitRoom, tokenPayload.turnTls);
            });
            const syncParticipants = () => {
                setParticipants(buildParticipantState(nextRoom));
            };

            nextRoom.on(liveKitModule.RoomEvent.ParticipantConnected, syncParticipants);
            nextRoom.on(liveKitModule.RoomEvent.ParticipantDisconnected, syncParticipants);
            nextRoom.on(liveKitModule.RoomEvent.TrackSubscribed, syncParticipants);
            nextRoom.on(liveKitModule.RoomEvent.TrackUnsubscribed, syncParticipants);
            nextRoom.on(liveKitModule.RoomEvent.LocalTrackPublished, syncParticipants);
            nextRoom.on(liveKitModule.RoomEvent.LocalTrackUnpublished, syncParticipants);
            nextRoom.on(liveKitModule.RoomEvent.ActiveSpeakersChanged, syncParticipants);
            nextRoom.on(liveKitModule.RoomEvent.Disconnected, () => {
                if (roomRef.current === nextRoom) {
                    roomRef.current = null;
                    setParticipants([]);
                    setMediaStatus("idle");
                }
            });

            await nextRoom.connect(tokenPayload.wsUrl, tokenPayload.token);
            roomRef.current = nextRoom;
            syncParticipants();
            setMediaStatus("connected");
        } catch (error) {
            disconnectRoom(roomRef, setParticipants, setMediaStatus);
            setMediaError(formatMediaError(error));
            return;
        }

        if (!enableDevice || !roomRef.current) {
            return;
        }

        // A failed device (e.g. permission denied) leaves the table connected so the other device still works.
        const activeRoom = roomRef.current;

        try {
            if (enableDevice === "microphone") {
                await activeRoom.localParticipant.setMicrophoneEnabled(true);
            } else {
                await activeRoom.localParticipant.setCameraEnabled(true);
            }

            setParticipants(buildParticipantState(activeRoom));
        } catch (error) {
            setMediaError(error instanceof Error ? error.message : `Unable to turn on the ${enableDevice === "microphone" ? "microphone" : "camera"}.`);
        }
    }

    async function handleToggleMicrophone() {
        const activeRoom = roomRef.current;

        if (!activeRoom) {
            return;
        }

        const prerequisiteError = getMediaEnvironmentError();

        if (prerequisiteError) {
            setEnvironmentError(prerequisiteError);
            setMediaError(prerequisiteError);
            return;
        }

        setMediaError(null);

        try {
            await activeRoom.localParticipant.setMicrophoneEnabled(!microphoneEnabled);
            setParticipants(buildParticipantState(activeRoom));
        } catch (error) {
            setMediaError(error instanceof Error ? error.message : "Unable to update microphone state.");
        }
    }

    async function handleToggleCamera() {
        const activeRoom = roomRef.current;

        if (!activeRoom) {
            return;
        }

        const prerequisiteError = getMediaEnvironmentError();

        if (prerequisiteError) {
            setEnvironmentError(prerequisiteError);
            setMediaError(prerequisiteError);
            return;
        }

        setMediaError(null);

        try {
            await activeRoom.localParticipant.setCameraEnabled(!cameraEnabled);
            setParticipants(buildParticipantState(activeRoom));
        } catch (error) {
            setMediaError(error instanceof Error ? error.message : "Unable to update camera state.");
        }
    }

    function handleDisconnectMedia() {
        disconnectRoom(roomRef, setParticipants, setMediaStatus);
    }

    return {
        participants,
        localParticipant,
        remoteParticipants,
        mediaStatus,
        mediaError,
        environmentError,
        microphoneEnabled,
        cameraEnabled,
        isConnected: mediaStatus === "connected",
        handleConnectMedia,
        handleToggleMicrophone,
        handleToggleCamera,
        handleDisconnectMedia,
    };
}

export function ParticipantCameraSurface({
    participant,
    className,
    emptyLabel,
}: {
    participant: MediaParticipantState | null;
    className?: string;
    emptyLabel: string;
}) {
    if (!participant) {
        return null;
    }

    if (participant.demoSurface) {
        return <DemoParticipantSurface participant={participant} className={className} />;
    }

    return (
        <div className={className}>
            <VideoTrackView publication={participant.videoPublication} muted={participant.isLocal} label={emptyLabel} />
        </div>
    );
}

export function MediaAudioRack({ participants }: { participants: MediaParticipantState[] }) {
    if (participants.length === 0) {
        return null;
    }

    return (
        <div className="media-audio-rack" aria-hidden="true">
            {participants.map((participant) => (
                <AudioTrackView key={`${participant.identity}-audio`} publication={participant.audioPublication} />
            ))}
        </div>
    );
}

function VideoTrackView({
    publication,
    muted,
    label,
}: {
    publication: TrackPublication | null;
    muted: boolean;
    label: string;
}) {
    const elementRef = useRef<HTMLVideoElement | null>(null);
    const track = publication?.track;

    useEffect(() => {
        const element = elementRef.current;

        if (!element || !track || track.kind !== "video") {
            return;
        }

        track.attach(element);

        return () => {
            track.detach(element);
        };
    }, [track]);

    if (!track || publication?.isMuted || track.kind !== "video") {
        return <div className="media-tile__placeholder">{label}</div>;
    }

    return <video ref={elementRef} autoPlay playsInline muted={muted} />;
}

function DemoParticipantSurface({
    participant,
    className,
}: {
    participant: MediaParticipantState;
    className?: string;
}) {
    const initials = participant.name
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase())
        .join("")
        .slice(0, 2);
    const surface = participant.demoSurface;

    return (
        <div className={className}>
            <div
                className="media-tile__demo"
                style={{
                    "--demo-tone-start": surface?.palette[0] ?? "#225668",
                    "--demo-tone-end": surface?.palette[1] ?? "#081018",
                    "--demo-accent": surface?.accent ?? "#7fd8ff",
                } as CSSProperties}
            >
                <div className="media-tile__demo-header">
                    <span className="media-tile__demo-tag">{surface?.label ?? "Camera on"}</span>
                    <span className="media-tile__demo-dot" aria-hidden="true" />
                </div>

                <div className="media-tile__demo-footer">
                    <span className="media-tile__demo-avatar">{initials || participant.name.charAt(0).toUpperCase()}</span>
                    <span className="media-tile__demo-meta">
                        <strong>{participant.name}</strong>
                        <span>{surface?.mood ?? "Camera feed preview"}</span>
                    </span>
                </div>
            </div>
        </div>
    );
}

function AudioTrackView({ publication }: { publication: TrackPublication | null }) {
    const elementRef = useRef<HTMLAudioElement | null>(null);
    const track = publication?.track;

    useEffect(() => {
        const element = elementRef.current;

        if (!element || !track || track.kind !== "audio" || publication?.isMuted) {
            return;
        }

        track.attach(element);

        return () => {
            track.detach(element);
        };
    }, [publication?.isMuted, track]);

    if (!track || track.kind !== "audio" || publication?.isMuted) {
        return null;
    }

    return <audio ref={elementRef} autoPlay playsInline />;
}

function buildParticipantState(room: LiveKitRoom): MediaParticipantState[] {
    const allParticipants = [
        room.localParticipant,
        ...Array.from(room.remoteParticipants.values()),
    ];

    return allParticipants
        .map((participant) => {
            const accountId = readParticipantAccountId(participant.metadata);
            const videoPublication = findPublication(participant, "camera");
            const audioPublication = findPublication(participant, "microphone");

            return {
                identity: participant.identity,
                accountId,
                name: participant.name || participant.identity,
                isLocal: participant.identity === room.localParticipant.identity,
                isSpeaking: participant.isSpeaking,
                videoPublication,
                audioPublication,
                cameraEnabled: isPublicationEnabled(videoPublication),
                microphoneEnabled: isPublicationEnabled(audioPublication),
                demoSurface: null,
            };
        })
        .sort((left, right) => {
            if (left.isLocal !== right.isLocal) {
                return left.isLocal ? -1 : 1;
            }

            if (left.isSpeaking !== right.isSpeaking) {
                return left.isSpeaking ? -1 : 1;
            }

            return left.name.localeCompare(right.name);
        });
}

function readParticipantAccountId(metadata: string | undefined): string | null {
    if (!metadata) {
        return null;
    }

    try {
        const parsed = JSON.parse(metadata) as { accountId?: unknown };
        return typeof parsed.accountId === "string" && parsed.accountId.trim().length > 0 ? parsed.accountId : null;
    } catch {
        return null;
    }
}

function findPublication(participant: Participant, source: "camera" | "microphone"): TrackPublication | null {
    return Array.from(participant.trackPublications.values()).find((publication) => publication.source === source) ?? null;
}

async function loadLiveKitModule(moduleRef: MutableRefObject<LiveKitModule | null>): Promise<LiveKitModule> {
    if (moduleRef.current) {
        return moduleRef.current;
    }

    const module = await import("livekit-client");
    moduleRef.current = module;
    return module;
}

function isPublicationEnabled(publication: TrackPublication | null): boolean {
    return Boolean(publication?.track && !publication.isMuted);
}

function disconnectRoom(
    roomRef: MutableRefObject<LiveKitRoom | null>,
    setParticipants: Dispatch<SetStateAction<MediaParticipantState[]>>,
    setMediaStatus: Dispatch<SetStateAction<"idle" | "connecting" | "connected">>
): void {
    const activeRoom = roomRef.current;

    if (activeRoom) {
        roomRef.current = null;
        activeRoom.disconnect();
    }

    setParticipants([]);
    setMediaStatus("idle");
}

function formatMediaError(error: unknown): string {
    const message = error instanceof Error ? error.message : "Unable to connect media for this room.";
    const normalized = message.toLowerCase();

    if (normalized.includes("getusermedia") || normalized.includes("mediadevices")) {
        return getMediaEnvironmentError() ?? "This browser page cannot access microphone or camera APIs. Use HTTPS or open the app on localhost from the same machine.";
    }

    if (normalized.includes("could not establish pc connection")) {
        return "Media transport could not connect. If the app is running in Docker or on another machine, make sure LiveKit TCP 7881 and UDP 50000-50100 are reachable from your browser, or configure TURN/TLS for remote access.";
    }

    if (normalized.includes("v1 rtc path not found")) {
        return "The LiveKit browser SDK is newer than the running server. Rebuild the Docker stack so the upgraded LiveKit image is running, then try media again.";
    }

    return message;
}

function applyTurnTlsOverride(room: InternalLiveKitRoom, turnTls: TurnTlsOverride | undefined): void {
    if (!turnTls) {
        return;
    }

    const engine = room.engine;
    const advertisedIceServers = engine?.latestJoinResponse?.iceServers;

    if (!engine || !engine.pcManager || !advertisedIceServers || advertisedIceServers.length === 0) {
        return;
    }

    let changed = false;
    const iceServers: RTCIceServer[] = advertisedIceServers.map((iceServer) => {
        const urls = iceServer.urls.map((url) => {
            const rewrittenUrl = rewriteTurnTlsUrl(url, turnTls);

            if (rewrittenUrl !== url) {
                changed = true;
            }

            return rewrittenUrl;
        });

        return {
            urls,
            username: iceServer.username,
            credential: iceServer.credential,
        };
    });

    if (!changed) {
        return;
    }

    // LiveKit 1.10.x advertises embedded TURN/TLS on :443 even when the listener is bound elsewhere.
    const rtcConfig: RTCConfiguration = {
        ...engine.rtcConfig,
        iceServers,
    };

    engine.rtcConfig = rtcConfig;
    engine.pcManager.updateConfiguration(rtcConfig, true);
}

function rewriteTurnTlsUrl(url: string, turnTls: TurnTlsOverride): string {
    const match = url.match(/^turns:([^:]+):(\d+)(\?.*)?$/i);

    if (!match) {
        return url;
    }

    const [, domain, port, query] = match;

    if (domain !== turnTls.domain || port !== "443") {
        return url;
    }

    return `turns:${turnTls.domain}:${turnTls.port}${query ?? "?transport=tcp"}`;
}

function getMediaEnvironmentError(): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    if (!window.isSecureContext) {
        return "This page is not running in a secure browser context. Microphone and camera access only work on HTTPS origins or on localhost. Open the app over HTTPS, or use localhost from the same machine.";
    }

    if (typeof window.RTCPeerConnection !== "function") {
        return "This browser does not support WebRTC peer connections, so voice and video are unavailable here.";
    }

    if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
        return "This browser page cannot access microphone or camera APIs. Use a current browser over HTTPS, or open the app on localhost from the same machine.";
    }

    return null;
}