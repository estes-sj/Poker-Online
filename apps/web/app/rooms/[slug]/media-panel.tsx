"use client";

import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { Panel } from "@poker/ui";
import type { Participant, Room as LiveKitRoom, TrackPublication } from "livekit-client";

import { buildBrowserHttpUrl, getBrowserApiBaseUrl } from "../../lib/public-service-urls";
import type { SessionState } from "./room-types";

type LiveKitModule = typeof import("livekit-client");

interface MediaPanelProps {
    slug: string;
    session: SessionState | null;
    canConnect: boolean;
    displayName: string;
}

interface MediaTokenResponse {
    token: string;
    wsUrl: string;
    roomName: string;
    participant: {
        id: string;
        name: string;
    };
}

interface MediaParticipantState {
    identity: string;
    name: string;
    isLocal: boolean;
    isSpeaking: boolean;
    videoPublication: TrackPublication | null;
    audioPublication: TrackPublication | null;
}

export function MediaPanel({ slug, session, canConnect, displayName }: MediaPanelProps) {
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

    async function handleConnectMedia() {
        if (!session) {
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
                    Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({
                    slug,
                    participantName: displayName.trim() || session.account.username,
                }),
            });
            const tokenPayload = (await tokenResponse.json()) as Partial<MediaTokenResponse> & { error?: string };

            if (!tokenResponse.ok || !tokenPayload.token || !tokenPayload.wsUrl) {
                throw new Error(tokenPayload.error ?? "Unable to connect media for this room.");
            }

            const nextRoom = new liveKitModule.Room();
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

    return (
        <Panel eyebrow="Media" title="Voice and video">
            <div className="form-stack">
                {!session ? (
                    <p className="muted-copy">Sign in to connect voice and video for this room.</p>
                ) : mediaStatus !== "connected" ? (
                    <>
                        <p className="muted-copy">Connect a real LiveKit session for table talk and face cams.</p>
                        {environmentError ? <p className="form-error">{environmentError}</p> : null}
                        <button
                            className="button button--secondary"
                            type="button"
                            onClick={() => void handleConnectMedia()}
                            disabled={mediaStatus === "connecting" || Boolean(environmentError)}
                        >
                            {mediaStatus === "connecting" ? "Connecting media" : "Connect media"}
                        </button>
                    </>
                ) : (
                    <div className="media-controls">
                        <button className="button button--secondary" type="button" onClick={() => void handleToggleMicrophone()}>
                            {microphoneEnabled ? "Mute mic" : "Unmute mic"}
                        </button>
                        <button className="button button--secondary" type="button" onClick={() => void handleToggleCamera()}>
                            {cameraEnabled ? "Stop camera" : "Start camera"}
                        </button>
                        <button className="button button--primary" type="button" onClick={handleDisconnectMedia}>
                            Disconnect media
                        </button>
                    </div>
                )}

                {mediaError ? <p className="form-error">{mediaError}</p> : null}

                <div className="media-grid">
                    {participants.length > 0 ? participants.map((participant) => (
                        <MediaTile key={participant.identity} participant={participant} />
                    )) : (
                        <div className="media-empty-state">No media participants connected yet.</div>
                    )}
                </div>

                {remoteParticipants.length > 0 ? (
                    <div className="media-audio-rack" aria-hidden="true">
                        {remoteParticipants.map((participant) => (
                            <AudioTrackView key={`${participant.identity}-audio`} publication={participant.audioPublication} />
                        ))}
                    </div>
                ) : null}
            </div>
        </Panel>
    );
}

function MediaTile({ participant }: { participant: MediaParticipantState }) {
    return (
        <article className={["media-tile", participant.isSpeaking ? "media-tile--speaking" : ""].filter(Boolean).join(" ")}>
            <div className="media-tile__video">
                <VideoTrackView publication={participant.videoPublication} muted={participant.isLocal} label={participant.isLocal ? "Your camera is off" : "Camera is off"} />
            </div>
            <div className="media-tile__meta">
                <strong>{participant.isLocal ? `${participant.name} · You` : participant.name}</strong>
                <span>
                    {describeTrackState(participant.audioPublication, "Mic")}
                    {" · "}
                    {describeTrackState(participant.videoPublication, "Cam")}
                </span>
            </div>
        </article>
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
        .map((participant) => ({
            identity: participant.identity,
            name: participant.name || participant.identity,
            isLocal: participant.identity === room.localParticipant.identity,
            isSpeaking: participant.isSpeaking,
            videoPublication: findPublication(participant, "camera"),
            audioPublication: findPublication(participant, "microphone"),
        }))
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

function describeTrackState(publication: TrackPublication | null, label: string): string {
    return `${label} ${isPublicationEnabled(publication) ? "on" : "off"}`;
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