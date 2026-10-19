import Link from "next/link";

import { PageHeader, SiteHeader } from "../../components/site-header";
import { getRoomCreationPolicy } from "../../lib/room-creation-policy";
import { AdminClubManager } from "./admin-club-manager";

export const dynamic = "force-dynamic";

export default function AdminClubsPage() {
    const roomCreationPolicy = getRoomCreationPolicy();

    return (
        <div className="site">
            <SiteHeader current="admin" />
            <main className="site-main">
                <PageHeader
                    meta={<span className="breadcrumb">Admin</span>}
                    title="Manage clubs"
                    description="Create clubs, add members, add imported players for old ledgers, and edit recorded games."
                    actions={(
                        <Link className="button button--secondary button--small" href="/admin/rooms">
                            Manage rooms
                        </Link>
                    )}
                />
                <AdminClubManager roomCreationPolicy={roomCreationPolicy} />
            </main>
        </div>
    );
}
