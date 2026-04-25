const apiOrigin = process.env.API_INTERNAL_BASE_URL ?? "http://api:4100";
const gameOrigin = process.env.GAME_INTERNAL_BASE_URL ?? "http://game:4200";
const livekitOrigin = process.env.LIVEKIT_INTERNAL_BASE_URL ?? "http://livekit:7880";

const nextConfig = {
  transpilePackages: ["@poker/ui"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/:path*`,
      },
      {
        source: "/game/:path*",
        destination: `${gameOrigin}/:path*`,
      },
      {
        source: "/livekit/:path*",
        destination: `${livekitOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
