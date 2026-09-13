/**
 * Reconciles the device-local "active workout" pointer (activeWorkout.ts)
 * with the server's own record of what is in progress for whoever is
 * CURRENTLY signed in.
 *
 * Pulled out of app/(app)/(tabs)/index.tsx, the same way restPreference.ts
 * and templateSaveRequest.ts were pulled out of their screens, so this
 * reconciliation logic can be unit tested without a React renderer.
 *
 * Added for Adım 20 (PROJE_1_CODEX_INCELEME.md, Bölüm 8 madde H3): the local
 * pointer is a device key, not an account key (see activeWorkout.ts), and
 * ownership of a workout is enforced server-side. So when a different
 * account is now signed in on this device than the one that set the
 * pointer, `getWorkout(stored)` fails exactly the way it would for a
 * deleted workout — there is no separate "not yours" signal to branch on.
 * Either way the pointer is dead, and simply showing "nothing in progress"
 * would be wrong if the CURRENT account actually has its own session going
 * (e.g. started on another device): the fallback below re-checks the
 * server before giving up.
 */

export type MinimalWorkout = {
  id: string;
  finished_at: string | null;
};

export type ResolveActiveWorkoutDeps = {
  getActiveWorkout: () => Promise<string | null>;
  setActiveWorkout: (id: string) => Promise<void>;
  clearActiveWorkout: () => Promise<void>;
  getWorkout: (id: string) => Promise<MinimalWorkout>;
  getServerActiveWorkout: () => Promise<MinimalWorkout | null>;
};

/**
 * Resolves to the id of the workout that should be shown as "in progress"
 * right now, or null if there is none. Also brings the local pointer back
 * in sync with that answer (set, cleared, or left alone).
 */
export async function resolveActiveWorkoutId(
  deps: ResolveActiveWorkoutDeps,
): Promise<string | null> {
  const {
    getActiveWorkout,
    setActiveWorkout,
    clearActiveWorkout,
    getWorkout,
    getServerActiveWorkout,
  } = deps;

  // No usable local pointer for THIS account's active workout — the
  // server's copy is the backup for exactly this case (new phone,
  // reinstall), and also the fallback below when a stored pointer turns out
  // not to be usable, so check it before assuming nothing is in progress.
  const resolveFromServer = async (): Promise<string | null> => {
    try {
      const active = await getServerActiveWorkout();
      if (active) {
        await setActiveWorkout(active.id);
        return active.id;
      }
      return null;
    } catch {
      return null;
    }
  };

  const stored = await getActiveWorkout();
  if (!stored) {
    return resolveFromServer();
  }

  // The stored id could point at a workout deleted from another device, or
  // one finished from another device since this device last saw it, so
  // confirm it still exists AND is still unfinished rather than routing
  // into a dead or already-closed screen.
  try {
    const workout = await getWorkout(stored);
    if (workout.finished_at) {
      await clearActiveWorkout();
      return null;
    }
    return stored;
  } catch {
    await clearActiveWorkout();
    return resolveFromServer();
  }
}
