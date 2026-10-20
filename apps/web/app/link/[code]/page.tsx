import { SiteHeader } from "../../components/site-header";
import { DeviceLinkClaim } from "./device-link-claim";

export const dynamic = "force-dynamic";

export default async function DeviceLinkPage({
    params,
    searchParams,
}: {
    params: Promise<{ code: string }>;
    searchParams: Promise<{ next?: string | string[] }>;
}) {
    const { code } = await params;
    const { next } = await searchParams;
    const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";

    return (
        <div className="site">
            <SiteHeader current="home" />
            <main className="site-main site-main--narrow">
                <DeviceLinkClaim code={code} nextPath={nextPath} />
            </main>
        </div>
    );
}
