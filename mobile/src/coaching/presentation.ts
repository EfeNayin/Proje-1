import type { Person } from "../api/coaching";

/** "First Last" when the person set a name, otherwise their username. */
export function personName(person: Person): string {
  const parts = [person.first_name, person.last_name].filter(
    (part): part is string => part != null && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : person.username;
}

/** "@username" shown under a name, or null when the name already is the username. */
export function personHandle(person: Person): string | null {
  return personName(person) === person.username ? null : `@${person.username}`;
}

export function formatConnectedDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatExpiry(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}
