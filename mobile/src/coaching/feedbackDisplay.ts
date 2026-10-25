/** How feedback times and edits are worded, on both the coach's and the athlete's side. */

export function formatFeedbackTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** True when the text was changed after it was first written. */
export function feedbackWasEdited(createdAt: string, updatedAt: string): boolean {
  const created = new Date(createdAt).getTime();
  const updated = new Date(updatedAt).getTime();
  return !Number.isNaN(created) && !Number.isNaN(updated) && updated > created;
}

/** "Written 3 Oct 2026, 10:05" and, if edited, "Edited 4 Oct 2026, 09:00". */
export function feedbackTimeLines(createdAt: string, updatedAt: string): string[] {
  const lines = [`Written ${formatFeedbackTime(createdAt)}`];
  if (feedbackWasEdited(createdAt, updatedAt)) {
    lines.push(`Edited ${formatFeedbackTime(updatedAt)}`);
  }
  return lines;
}
