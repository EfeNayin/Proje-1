import type {
  ReceivedOffer,
  ReceivedOfferDetail,
  ReceivedOfferPage,
  SentOffer,
  SentOfferDetail,
  SentOfferPage,
} from "../api/coaching";

/**
 * Program offers on this device: what an athlete has been sent, and what a coach
 * has sent to one athlete. Kept out of the screens so the rules that matter can
 * be tested without rendering anything.
 *
 * - Everything belongs to one signed-in user. `reset()` (sign-out, session
 *   expiry) and `bind()` with a different id drop every list, the open offer and
 *   the pending send attempts, and invalidate requests still in flight: their
 *   answers change nothing.
 * - A refusal ("not found" for an offer: the connection ended, or it is not
 *   yours) clears that offer's details instead of leaving them on screen.
 *   Any other failed refresh keeps what is shown and offers a retry.
 * - Accept, decline and send each hold an in-flight lock here, not in React
 *   state. When one fails in a way that does not say whether it happened, the
 *   result is read back (accept, decline) or the same request id is kept so the
 *   retry returns the offer that already exists (send); it is never reported as
 *   a plain failure.
 */

export type ProgramOffersApi = {
  listReceived: (limit: number, offset: number) => Promise<ReceivedOfferPage>;
  getReceived: (offerId: string) => Promise<ReceivedOfferDetail>;
  accept: (offerId: string) => Promise<ReceivedOfferDetail>;
  decline: (offerId: string) => Promise<ReceivedOfferDetail>;
  listSent: (linkId: string, limit: number, offset: number) => Promise<SentOfferPage>;
  send: (
    linkId: string,
    requestId: string,
    programId: string,
    fingerprint: string,
  ) => Promise<SentOfferDetail>;
};

export type ReceivedListState = {
  items: ReceivedOffer[];
  total: number;
  /** True once a page has loaded for this user. */
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** The last refresh failed; `items`, if any, are older than this. */
  error: string | null;
  moreError: string | null;
};

export type OfferDetailState = {
  offerId: string | null;
  data: ReceivedOfferDetail | null;
  loading: boolean;
  error: string | null;
  /** The backend no longer shows this offer to the caller (ended connection, not theirs). */
  unavailable: boolean;
};

export type SentListState = {
  /** The connection these belong to. */
  linkId: string | null;
  items: SentOffer[];
  total: number;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** The connection is gone: nothing is shown and nothing more is requested. */
  unavailable: boolean;
};

export type ProgramOffersState = {
  userId: string | null;
  received: ReceivedListState;
  detail: OfferDetailState;
  sent: SentListState;
  /** The offer being accepted or declined. */
  responding: string | null;
  sending: boolean;
};

export type RespondOutcome =
  | { kind: "done"; offer: ReceivedOfferDetail }
  | { kind: "ignored" } // the same action is already running
  | { kind: "stale" } // the user changed while it ran; touch nothing
  | { kind: "unavailable"; message: string } // the offer is no longer reachable
  | { kind: "failed"; message: string }
  /** A write whose result could not be confirmed either way. */
  | { kind: "unknown"; message: string };

export type SendOutcome =
  | { kind: "done"; offer: SentOfferDetail }
  | { kind: "ignored" }
  | { kind: "stale" }
  | { kind: "unavailable"; message: string }
  /** The program changed after it was previewed: nothing was sent; review the new version. */
  | { kind: "changed"; message: string }
  | { kind: "failed"; message: string }
  /** Unconfirmed. Confirming the same content again repeats the same request. */
  | { kind: "unknown"; message: string };

const emptyReceived = (): ReceivedListState => ({
  items: [],
  total: 0,
  loaded: false,
  loading: false,
  loadingMore: false,
  error: null,
  moreError: null,
});

const emptyDetail = (): OfferDetailState => ({
  offerId: null,
  data: null,
  loading: false,
  error: null,
  unavailable: false,
});

const emptySent = (linkId: string | null = null): SentListState => ({
  linkId,
  items: [],
  total: 0,
  loaded: false,
  loading: false,
  error: null,
  unavailable: false,
});

export function initialProgramOffersState(userId: string | null = null): ProgramOffersState {
  return {
    userId,
    received: emptyReceived(),
    detail: emptyDetail(),
    sent: emptySent(),
    responding: null,
    sending: false,
  };
}

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** A 4xx means the server clearly said no: nothing was changed. No status, a timeout or a 5xx leaves it open. */
function isDefinitive(error: unknown): boolean {
  const status = statusOf(error);
  return status !== null && status >= 400 && status < 500 && status !== 408;
}

export function createProgramOffersStore(
  api: ProgramOffersApi,
  newRequestId: () => string,
  pageSize = 20,
) {
  let state = initialProgramOffersState();
  // Bumped when the user changes or on reset: everything in flight is void.
  let generation = 0;
  // Bumped when the sent list is pointed at another connection.
  let sentScope = 0;
  // Bumped by each received refresh: a next-page request started before it is void.
  let epoch = 0;
  let refreshing: Promise<void> | null = null;
  let sentRefreshing: Promise<void> | null = null;
  let loadingMore = false;
  let openingDetail: string | null = null;
  let responding: string | null = null;
  let sending = false;
  // One request id per (connection, program, confirmed content) until the send is
  // settled. Content that was reviewed again is a new confirmation and gets a new id.
  const attempts = new Map<string, string>();
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<ProgramOffersState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };
  const patchReceived = (changes: Partial<ReceivedListState>) =>
    publish({ received: { ...state.received, ...changes } });
  const patchDetail = (changes: Partial<OfferDetailState>) =>
    publish({ detail: { ...state.detail, ...changes } });
  const patchSent = (changes: Partial<SentListState>) =>
    publish({ sent: { ...state.sent, ...changes } });

  function resetFor(userId: string | null) {
    generation += 1;
    sentScope += 1;
    epoch += 1;
    refreshing = sentRefreshing = null;
    loadingMore = false;
    openingDetail = responding = null;
    sending = false;
    attempts.clear();
    state = initialProgramOffersState(userId);
    listeners.forEach((listener) => listener());
  }

  /** Point the store at a user. Switching to a different one drops everything. */
  function bind(userId: string | null) {
    if (state.userId !== userId) resetFor(userId);
  }

  // ── Athlete: received offers ───────────────────────────────────────────

  /** An offer the backend will no longer show: take it out of the list and the open detail. */
  function dropOffer(offerId: string) {
    const items = state.received.items.filter((item) => item.id !== offerId);
    const removed = items.length !== state.received.items.length;
    publish({
      received: {
        ...state.received,
        items,
        total: removed ? Math.max(0, state.received.total - 1) : state.received.total,
      },
      detail:
        state.detail.offerId === offerId
          ? { ...emptyDetail(), offerId, unavailable: true }
          : state.detail,
    });
  }

  function applyOffer(offer: ReceivedOfferDetail) {
    const { program: _program, ...summary } = offer;
    publish({
      received: {
        ...state.received,
        items: state.received.items.map((item) => (item.id === offer.id ? summary : item)),
      },
      detail: state.detail.offerId === offer.id ? { ...state.detail, data: offer } : state.detail,
    });
  }

  /** First page again. Concurrent calls share one request; a failure keeps the list on screen. */
  function refreshReceived(): Promise<void> {
    if (!state.userId) return Promise.resolve();
    if (refreshing) return refreshing;
    const request = generation;
    epoch += 1;
    loadingMore = false;
    patchReceived({ loading: true, loadingMore: false, error: null, moreError: null });
    const current = (async () => {
      try {
        const page = await api.listReceived(pageSize, 0);
        if (request !== generation) return;
        patchReceived({
          items: page.items,
          total: page.total,
          loaded: true,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (request !== generation) return;
        patchReceived({ loading: false, error: messageOf(error, "Could not load programs") });
      } finally {
        if (request === generation) refreshing = null;
      }
    })();
    refreshing = current;
    return current;
  }

  /** The next page, once. Ignored while a refresh or another page is running. */
  async function loadMoreReceived(): Promise<void> {
    const { userId, received } = state;
    if (!userId || refreshing || loadingMore || !received.loaded || received.loading) return;
    if (received.error || received.items.length === 0) return;
    if (received.items.length >= received.total) return;
    const request = generation;
    const startedIn = epoch;
    loadingMore = true;
    patchReceived({ loadingMore: true, moreError: null });
    try {
      // The offset advances by rows received, not rows displayed.
      const page = await api.listReceived(pageSize, received.items.length);
      if (request !== generation || startedIn !== epoch) return;
      const seen = new Set(state.received.items.map((item) => item.id));
      const additions = page.items.filter((item) => !seen.has(item.id));
      patchReceived({
        items: [...state.received.items, ...additions],
        // An empty page ends paging even if `total` still claims more.
        total: page.items.length === 0 ? state.received.items.length : page.total,
        loadingMore: false,
      });
    } catch (error) {
      if (request !== generation || startedIn !== epoch) return;
      patchReceived({ loadingMore: false, moreError: messageOf(error, "Could not load more") });
    } finally {
      if (request === generation && startedIn === epoch) loadingMore = false;
    }
  }

  /** Open one received offer. A failed reload of the same offer keeps what is shown. */
  async function loadDetail(offerId: string): Promise<void> {
    if (!state.userId || openingDetail === offerId) return;
    const request = generation;
    openingDetail = offerId;
    const sameOffer = state.detail.offerId === offerId;
    patchDetail({
      offerId,
      data: sameOffer ? state.detail.data : null,
      loading: true,
      error: null,
      unavailable: false,
    });
    // The screen may have moved on to another offer (or left) while this ran.
    const current = () => request === generation && state.detail.offerId === offerId;
    try {
      const data = await api.getReceived(offerId);
      if (!current()) return;
      applyOffer(data);
      patchDetail({ data, loading: false });
    } catch (error) {
      if (!current()) return;
      if (statusOf(error) === 404) {
        dropOffer(offerId);
        return;
      }
      patchDetail({ loading: false, error: messageOf(error, "Could not load this program") });
    } finally {
      if (request === generation && openingDetail === offerId) openingDetail = null;
    }
  }

  /** Leaving an offer: forget it, ignore its pending answer. */
  function closeDetail() {
    openingDetail = null;
    publish({ detail: emptyDetail() });
  }

  async function respond(
    offerId: string,
    run: (id: string) => Promise<ReceivedOfferDetail>,
    wanted: "accepted" | "declined",
    fallback: string,
  ): Promise<RespondOutcome> {
    if (!state.userId) return { kind: "stale" };
    if (responding !== null) return { kind: "ignored" };
    const request = generation;
    responding = offerId;
    publish({ responding: offerId });

    const unavailable: RespondOutcome = {
      kind: "unavailable",
      message: "This program is no longer available. The connection may have ended.",
    };

    try {
      const offer = await run(offerId);
      if (request !== generation) return { kind: "stale" };
      applyOffer(offer);
      return { kind: "done", offer };
    } catch (error) {
      if (request !== generation) return { kind: "stale" };
      if (statusOf(error) === 404) {
        dropOffer(offerId);
        return unavailable;
      }
      const message = messageOf(error, fallback);
      if (isDefinitive(error)) return { kind: "failed", message };

      // Unclear whether it happened: read the offer back.
      try {
        const offer = await api.getReceived(offerId);
        if (request !== generation) return { kind: "stale" };
        applyOffer(offer);
        if (offer.status === wanted) return { kind: "done", offer };
        if (offer.status === "pending") {
          return { kind: "failed", message: `${message} Nothing was changed; you can try again.` };
        }
        return { kind: "failed", message: `This program was already ${offer.status}.` };
      } catch (readError) {
        if (request !== generation) return { kind: "stale" };
        if (statusOf(readError) === 404) {
          dropOffer(offerId);
          return unavailable;
        }
        return {
          kind: "unknown",
          message:
            "We could not confirm what happened. Open the program again to check before trying again.",
        };
      }
    } finally {
      if (request === generation) {
        responding = null;
        publish({ responding: null });
      }
    }
  }

  const accept = (offerId: string) =>
    respond(offerId, api.accept, "accepted", "Could not add this program");
  const decline = (offerId: string) =>
    respond(offerId, api.decline, "declined", "Could not decline this program");

  // ── Coach: offers sent to one athlete ──────────────────────────────────

  /** Point the sent list at one connection. A different one drops what was loaded. */
  function bindSent(linkId: string | null) {
    if (state.sent.linkId === linkId) return;
    sentScope += 1;
    sentRefreshing = null;
    publish({ sent: emptySent(linkId) });
  }

  function refreshSent(): Promise<void> {
    const { linkId } = state.sent;
    if (!state.userId || !linkId || state.sent.unavailable) return Promise.resolve();
    if (sentRefreshing) return sentRefreshing;
    const request = generation;
    const scope = sentScope;
    patchSent({ loading: true, error: null });
    const stale = () => request !== generation || scope !== sentScope;
    const current = (async () => {
      try {
        const page = await api.listSent(linkId, pageSize, 0);
        if (stale()) return;
        patchSent({ items: page.items, total: page.total, loaded: true, loading: false });
      } catch (error) {
        if (stale()) return;
        if (statusOf(error) === 404) {
          publish({ sent: { ...emptySent(linkId), unavailable: true } });
          return;
        }
        patchSent({ loading: false, error: messageOf(error, "Could not load sent programs") });
      } finally {
        if (!stale()) sentRefreshing = null;
      }
    })();
    sentRefreshing = current;
    return current;
  }

  /**
   * Send one of the coach's programs to a connected athlete, as previewed:
   * `fingerprint` comes from the preview the coach confirmed. The request id is
   * kept until the send is settled, so repeating after an unclear failure asks
   * the backend for the same offer instead of making a second one.
   */
  async function send(
    linkId: string,
    programId: string,
    fingerprint: string,
  ): Promise<SendOutcome> {
    if (!state.userId) return { kind: "stale" };
    if (sending) return { kind: "ignored" };
    const request = generation;
    const key = `${linkId}:${programId}:${fingerprint}`;
    const requestId = attempts.get(key) ?? newRequestId();
    attempts.set(key, requestId);
    sending = true;
    publish({ sending: true });

    try {
      const offer = await api.send(linkId, requestId, programId, fingerprint);
      if (request !== generation) return { kind: "stale" };
      attempts.delete(key);
      if (state.sent.linkId === linkId) {
        const { program: _program, ...summary } = offer;
        const rest = state.sent.items.filter((item) => item.id !== offer.id);
        patchSent({ items: [summary, ...rest], total: rest.length + 1, loaded: true });
      }
      return { kind: "done", offer };
    } catch (error) {
      if (request !== generation) return { kind: "stale" };
      const message = messageOf(error, "Could not send this program");
      if (statusOf(error) === 404) {
        attempts.delete(key);
        return {
          kind: "unavailable",
          message: "This connection has ended, or the program no longer exists.",
        };
      }
      if (statusOf(error) === 412) {
        attempts.delete(key);
        return { kind: "changed", message };
      }
      if (isDefinitive(error)) {
        // Refused: nothing was created, so a later try starts fresh.
        attempts.delete(key);
        return { kind: "failed", message };
      }
      return {
        kind: "unknown",
        message:
          "We could not confirm the program was sent. Send it again: it will not be sent twice.",
      };
    } finally {
      if (request === generation) {
        sending = false;
        publish({ sending: false });
      }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bind,
    /** Sign-out and session expiry: forget everything and ignore what is still in flight. */
    reset: () => resetFor(null),
    refreshReceived,
    loadMoreReceived,
    loadDetail,
    closeDetail,
    accept,
    decline,
    bindSent,
    refreshSent,
    send,
  };
}
