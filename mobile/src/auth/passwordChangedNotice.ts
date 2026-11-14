import { useSyncExternalStore } from "react";

/**
 * "Your password was changed", for the sign-in screen the person returns to after a
 * password recovery. Set only after the server confirmed it (204); cleared when someone
 * signs in or dismisses it. It holds no account data, only the fact.
 */
let shown = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function showPasswordChangedNotice(): void {
  shown = true;
  emit();
}

export function clearPasswordChangedNotice(): void {
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

export function usePasswordChangedNotice(): boolean {
  return useSyncExternalStore(subscribe, () => shown);
}
