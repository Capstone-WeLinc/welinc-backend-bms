import type { Driver, Helper } from '@prisma/client';
import type { DirectoryClient, DirectoryPerson } from '../auth/directory.client';
import type { PrismaService } from '../prisma.service';

export type CrewRole = 'DRIVER' | 'HELPER';

/** Holds the role for good: active, not deleted or erased, and not only through a temporary grant. */
export function permanentCrew(person: DirectoryPerson | undefined, role: string) {
  return (
    !!person &&
    person.isActive &&
    !person.deleted &&
    !person.erased &&
    person.roles.includes(role) &&
    !(person.temporaryRoles ?? []).includes(role)
  );
}

/** A BMS crew row with the account it belongs to. */
export type Linked<Row> = { row: Row; person: DirectoryPerson };

/** Name, email and contact number come from the account in Auth, never from BMS (spec bms/0012). */
export const accountFields = (person: DirectoryPerson) => ({
  userId: person.id,
  fullName: person.name,
  email: person.email ?? '',
  contact: person.phone ?? '',
});

/**
 * Every driver (or helper) with an account: each person who holds the role permanently in BMS,
 * with their BMS row. A person without a row yet gets one here, so a new account shows up on Team
 * Management by itself; nobody is added by hand in BMS. Sorted by name.
 */
export async function linkedCrew(prisma: PrismaService, directory: DirectoryClient, role: 'DRIVER'): Promise<Linked<Driver>[]>;
export async function linkedCrew(prisma: PrismaService, directory: DirectoryClient, role: 'HELPER'): Promise<Linked<Helper>[]>;
export async function linkedCrew(prisma: PrismaService, directory: DirectoryClient, role: CrewRole): Promise<Linked<Driver | Helper>[]> {
  const people = (await directory.roster()).filter((person) => permanentCrew(person, role));
  if (!people.length) return [];
  // One delegate type for both tables keeps the two branches identical.
  const table = (role === 'DRIVER' ? prisma.driver : prisma.helper) as unknown as {
    findMany(args: unknown): Promise<Array<Driver | Helper>>;
    createMany(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
  };
  const ids = people.map((person) => person.id);
  let rows = await table.findMany({ where: { userId: { in: ids } } });
  const missing = ids.filter((id) => !rows.some((row) => row.userId === id));
  const inactive = rows.filter((row) => !row.isActive).map((row) => row.id);
  if (missing.length || inactive.length) {
    // skipDuplicates: two requests at once may both see the person as new.
    if (missing.length) await table.createMany({ data: missing.map((userId) => ({ userId })), skipDuplicates: true });
    // Holding the role again (after it was removed and given back) brings the same row back.
    if (inactive.length) await table.updateMany({ where: { id: { in: inactive } }, data: role === 'DRIVER' ? { isActive: true, deletedAt: null } : { isActive: true } });
    rows = await table.findMany({ where: { userId: { in: ids } } });
  }
  const byUser = new Map(rows.map((row) => [row.userId, row]));
  return people
    .flatMap((person) => {
      const row = byUser.get(person.id);
      return row ? [{ row, person }] : [];
    })
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
}
