import Link from "next/link";

import { PageHeader, SiteHeader } from "../../components/site-header";
import { getRoomCreationPolicy } from "../../lib/room-creation-policy";
import { AdminSettingsManager } from "./admin-settings-manager";

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
    const roomCreationPolicy = getRoomCreationPolicy();

    return (
        <div className="site">
            <SiteHeader current="admin" />
            <main className="site-main">
                <PageHeader
                    meta={<span className="breadcrumb">Admin</span>}
                    title="Site settings"
                    description="Settings that apply to every table on this site."
                    actions={(
                        <>
                            <Link className="button button--secondary button--small" href="/admin/rooms">Manage rooms</Link>
                            <Link className="button button--secondary button--small" href="/admin/clubs">Manage clubs</Link>
                        </>
                    )}
                />
                <AdminSettingsManager roomCreationPolicy={roomCreationPolicy} />
            </main>
        </div>
    );
}
