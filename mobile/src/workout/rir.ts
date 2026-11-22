/** Empty is unknown, whereas zero is a deliberate effort measurement. */
export function parseRirInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed) || Number(trimmed) > 10) {
    throw new Error("Enter a whole RIR value from 0 to 10, or leave it blank.");
  }
  return Number(trimmed);
}

export function formatRecordedRir(rir: number | null): string {
  return rir == null ? "" : ` · RIR ${rir}`;
}
