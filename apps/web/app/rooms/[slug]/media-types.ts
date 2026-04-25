import type { TrackPublication } from "livekit-client";

export interface DemoParticipantSurface {
    palette: [string, string];
    accent: string;
    label: string;
    mood: string;
}

export interface MediaParticipantState {
    identity: string;
    name: string;
    isLocal: boolean;
    isSpeaking: boolean;
    videoPublication: TrackPublication | null;
    audioPublication: TrackPublication | null;
    cameraEnabled: boolean;
    microphoneEnabled: boolean;
    demoSurface: DemoParticipantSurface | null;
}