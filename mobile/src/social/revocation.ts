/**
 * Listening for "the person revoked Aures in their Apple ID settings".
 *
 * The native call is trusted only as far as it can be checked. In the signed Aures build
 * it returns a subscription with remove(); in My Expo Go the same call returned nothing
 * usable, and the cleanup React runs later (when the account signs out or the screen
 * unmounts) then threw "Cannot read property 'remove' of undefined" in the middle of a
 * render. A try/catch around the registration cannot see that: the failure happens when
 * the returned function runs, so the guard lives in that function.
 *
 * The cleanup is safe to run any number of times and never throws.
 */

type SubscriptionLike = { remove?: () => void } | null | undefined;

const noop = (): void => undefined;

export function subscribeToRevocation(
  addRevokeListener: (listener: () => void) => SubscriptionLike,
  onRevoked: () => void,
): () => void {
  let subscription: SubscriptionLike;
  try {
    subscription = addRevokeListener(onRevoked);
  } catch {
    return noop;
  }

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    try {
      // Called as a method so a native subscription keeps its `this`.
      if (typeof subscription?.remove === "function") subscription.remove();
    } catch {
      // Nothing useful to do: the listener is going away with its owner either way.
    }
  };
}
