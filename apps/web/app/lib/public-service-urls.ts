const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export function getBrowserApiBaseUrl(): string {
  return resolveBrowserServiceUrl(process.env.NEXT_PUBLIC_API_BASE_URL, 4100, "http", "/api");
}

export function getBrowserGameHttpBaseUrl(): string {
  return resolveBrowserServiceUrl(process.env.NEXT_PUBLIC_GAME_HTTP_URL, 4200, "http", "/game");
}

export function getBrowserGameWsBaseUrl(): string {
  return resolveBrowserServiceUrl(process.env.NEXT_PUBLIC_GAME_WS_URL, 4200, "ws", "/game");
}

export function buildBrowserHttpUrl(baseUrl: string, path: string): string {
  return joinBrowserServiceUrl(baseUrl, path);
}

export function buildBrowserWsUrl(baseUrl: string, path: string): string {
  const normalizedPath = normalizeRelativeServiceUrl(path);

  if (isRelativeServiceUrl(baseUrl)) {
    const joinedPath = joinRelativeServiceUrl(baseUrl, normalizedPath);
    const protocol = getRuntimeProtocol("ws");

    if (typeof window === "undefined") {
      return `${protocol}://localhost${joinedPath}`;
    }

    return `${protocol}://${window.location.host}${joinedPath}`;
  }

  return joinBrowserServiceUrl(baseUrl, path);
}

function resolveBrowserServiceUrl(
  configuredUrl: string | undefined,
  port: number,
  transport: "http" | "ws",
  proxyPath: string
): string {
  if (configuredUrl && isRelativeServiceUrl(configuredUrl)) {
    return normalizeRelativeServiceUrl(configuredUrl);
  }

  if (typeof window === "undefined") {
    return configuredUrl ?? fallbackLoopbackUrl(port, transport);
  }

  if (!configuredUrl) {
    return proxyPath;
  }

  try {
    const parsed = new URL(configuredUrl);

    if (isLoopbackHost(parsed.hostname)) {
      return proxyPath;
    }

    const pageHostname = window.location.hostname;
    const runtimeProtocol = getRuntimeProtocol(transport);

    if (!isLoopbackHost(parsed.hostname) || isLoopbackHost(pageHostname)) {
      return configuredUrl;
    }

    parsed.protocol = `${runtimeProtocol}:`;
    parsed.hostname = pageHostname;
    parsed.port = parsed.port || String(port);
    return parsed.toString();
  } catch {
    return proxyPath;
  }
}

function joinBrowserServiceUrl(baseUrl: string, path: string): string {
  const normalizedPath = normalizeRelativeServiceUrl(path);

  if (isRelativeServiceUrl(baseUrl)) {
    return joinRelativeServiceUrl(baseUrl, normalizedPath);
  }

  try {
    return new URL(trimLeadingSlash(normalizedPath), ensureTrailingSlash(baseUrl)).toString();
  } catch {
    return `${trimTrailingSlash(baseUrl)}${normalizedPath}`;
  }
}

function getRuntimeProtocol(transport: "http" | "ws"): "http" | "https" | "ws" | "wss" {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return transport === "ws" ? "wss" : "https";
  }

  return transport;
}

function fallbackLoopbackUrl(port: number, transport: "http" | "ws"): string {
  return `${transport}://localhost:${port}`;
}

function normalizeRelativeServiceUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed || trimmed === "/") {
    return "/";
  }

  return trimTrailingSlash(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
}

function isRelativeServiceUrl(value: string): boolean {
  return !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value.trim());
}

function joinRelativeServiceUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = normalizeRelativeServiceUrl(baseUrl);

  if (normalizedBaseUrl === "/") {
    return path;
  }

  return `${normalizedBaseUrl}${path}`;
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}