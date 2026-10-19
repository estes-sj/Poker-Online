import { PageHeader, SiteHeader } from "../../components/site-header";
import { getRoomCreationPolicy } from "../../lib/room-creation-policy";
import { AdminRoomManager } from "./admin-room-manager";

export const dynamic = "force-dynamic";

export default function AdminRoomsPage() {
    const roomCreationPolicy = getRoomCreationPolicy();

    return (
        <div className="site">
            <SiteHeader current="admin" />
            <main className="site-main">
                <PageHeader
                    meta={<span className="breadcrumb">Admin</span>}
                    title="Manage rooms"
                    description="Delete live or archived tables in bulk, and set idle auto-expiration for live tables."
                />
                <AdminRoomManager roomCreationPolicy={roomCreationPolicy} />
            </main>
        </div>
    );
}
