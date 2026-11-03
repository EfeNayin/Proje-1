import { useSyncExternalStore } from "react";

/**
 * "Your account was deleted", for the sign-in screen the app lands on afterwards.
 * Set only after the server confirmed the deletion; cleared when someone signs in
 * or the person dismisses it. It holds no account data, only the fact.
 */
let shown = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function showAccountDeletedNotice(): void {
  shown = true;
  emit();
}

export function clearAccountDeletedNotice(): void {
  if (!shown) return;
  shown = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAccountDeletedNotice(): boolean {
  return useSyncExternalStore(subscribe, () => shown);
}
