import type { FastifyInstance } from "fastify";
import { AccessToken } from "livekit-server-sdk";

import type { AuthService } from "../services/auth-service.js";

export async function mediaRoutes(app: FastifyInstance, authService: AuthService): Promise<void> {
  app.post("/v1/media/token", async (request, reply) => {
    const sessionToken = getBearerToken(request.headers.authorization);

    if (!sessionToken) {
      return reply.code(401).send({ error: "Missing bearer token." });
    }

    const account = await authService.getAccountByToken(sessionToken);

    if (!account) {
      return reply.code(401).send({ error: "Invalid session token." });
    }

    const body = request.body as Partial<{ slug: string; participantName: string }>;
    const livekitApiKey = process.env.LIVEKIT_API_KEY?.trim();
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET?.trim();
    const livekitWsUrl = resolveLiveKitWsUrl(request.headers.host, request.headers["x-forwarded-host"], request.headers["x-forwarded-proto"], process.env.LIVEKIT_WS_URL?.trim());

    if (!livekitApiKey || !livekitApiSecret) {
      return reply.code(500).send({ error: "LiveKit is not configured for token issuance." });
    }

    try {
      const roomName = requireString(body.slug, "slug");
      const participantName = optionalString(body.participantName) ?? account.username;
      const accessToken = new AccessToken(livekitApiKey, livekitApiSecret, {
        identity: account.id,
        name: participantName,
      });

      accessToken.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
      });

      return reply.send({
        token: await accessToken.toJwt(),
        wsUrl: livekitWsUrl,
        roomName,
        participant: {
          id: account.id,
          name: participantName,
        },
      });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Unable to issue a media token.",
      });
    }
  });
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Field '${fieldName}' is required.`);
  }

  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authorizationHeader.slice("Bearer ".length).trim() || null;
}

function resolveLiveKitWsUrl(
  hostHeader: string | undefined,
  forwardedHostHeader: string | string[] | undefined,
  forwardedProtoHeader: string | string[] | undefined,
  configuredUrl: string | undefined
): string {
  const requestAuthority = normalizeAuthorityHeader(forwardedHostHeader) ?? normalizeAuthorityHeader(hostHeader);
  const requestHost = requestAuthority ? stripPortFromHost(requestAuthority) : null;
  const forwardedProto = Array.isArray(forwardedProtoHeader) ? forwardedProtoHeader[0] : forwardedProtoHeader;
  const wsProtocol = forwardedProto === "https" ? "wss" : "ws";
  const proxyUrl = `${wsProtocol}://${requestAuthority ?? "localhost"}/livekit`;

  if (!configuredUrl) {
    return proxyUrl;
  }

  if (isRelativeServiceUrl(configuredUrl)) {
    return `${wsProtocol}://${requestAuthority ?? "localhost"}${normalizeRelativeServiceUrl(configuredUrl)}`;
  }

  try {
    const parsed = new URL(configuredUrl);

    if (isLoopbackHost(parsed.hostname)) {
      return proxyUrl;
    }

    if (!requestHost || !isLoopbackHost(parsed.hostname) || isLoopbackHost(requestHost)) {
      return configuredUrl;
    }

    parsed.protocol = `${wsProtocol}:`;
    parsed.hostname = requestHost;
    parsed.port = parsed.port || "7880";
    return parsed.toString();
  } catch {
    return `${wsProtocol}://${requestHost ?? "localhost"}:7880`;
  }
}

function normalizeAuthorityHeader(value: string | string[] | undefined): string | null {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (!rawValue) {
    return null;
  }

  const firstValue = rawValue.split(",")[0]?.trim();

  if (!firstValue) {
    return null;
  }

  return firstValue || null;
}

function stripPortFromHost(host: string): string {
  return host.replace(/:\d+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1" || normalized === "[::1]";
}

function isRelativeServiceUrl(value: string): boolean {
  return !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value.trim());
}

function normalizeRelativeServiceUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed || trimmed === "/") {
    return "/";
  }

  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") : `/${trimmed.replace(/\/+$/, "")}`;
}