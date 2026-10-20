import type { PrismaClient } from "@prisma/client";

const GUEST_INACTIVITY_LIMIT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface GuestRetirementSummary {
  retiredGuests: number;
  deletedGuests: number;
}

/**
 * Retires guests inactive for 90 days. Their sign-in paths are removed so the identity is unreachable.
 * The user row is only deleted when nothing references it, because cascades would otherwise remove
 * archived ledgers and hand history that other players still read.
 */
export async function retireInactiveGuests(database: PrismaClient, now = new Date()): Promise<GuestRetirementSummary> {
  const cutoff = new Date(now.getTime() - GUEST_INACTIVITY_LIMIT_DAYS * DAY_MS);
  const staleGuests = await database.user.findMany({
    where: {
      isGuest: true,
      OR: [
        { lastSeenAt: { lt: cutoff } },
        { lastSeenAt: null, createdAt: { lt: cutoff } },
      ],
      // Skip guests already retired on an earlier run.
      AND: [
        {
          OR: [
            { recoveryCodeHash: { not: null } },
            { sessions: { some: {} } },
            { deviceLinkCodes: { some: {} } },
          ],
        },
      ],
    },
    select: {
      id: true,
      _count: {
        select: {
          roomParticipants: true,
          actions: true,
          ledgerEntries: true,
          memberships: true,
          rankings: true,
          adminRooms: true,
          ownedClubs: true,
        },
      },
    },
  });

  let deletedGuests = 0;

  for (const guest of staleGuests) {
    const hasHistory = Object.values(guest._count).some((count) => count > 0);

    if (hasHistory) {
      await database.$transaction([
        database.session.deleteMany({ where: { userId: guest.id } }),
        database.deviceLinkCode.deleteMany({ where: { userId: guest.id } }),
        database.user.update({ where: { id: guest.id }, data: { recoveryCodeHash: null } }),
      ]);
    } else {
      await database.user.delete({ where: { id: guest.id } });
      deletedGuests += 1;
    }
  }

  return { retiredGuests: staleGuests.length, deletedGuests };
}
