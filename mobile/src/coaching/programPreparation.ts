import type {
  LineageCreateInput,
  LineageDetail,
  LineageList,
  LineagePreview,
  LineageSummary,
  SentOfferDetail,
} from "../api/coaching";

/**
 * Programs a coach is preparing for ONE connected athlete, on this device: the list of
 * preparations, the one being looked at, and the preview that publishing needs. Kept out
 * of the screens so the rules that matter can be tested without rendering anything.
 *
 * - Everything belongs to one signed-in user and one connection. `reset()` (sign-out,
 *   session expiry), `bind()` with another user and `bindLink()` with another connection
 *   drop what was loaded and void every request still in flight: late answers change
 *   nothing.
 * - Nothing here edits the draft: the coach edits it as an ordinary program. This store
 *   only reads preparations, creates them and publishes versions.
 * - Create and publish each hold an in-flight lock here, not in React state. When one
 *   fails in a way that does not say whether it happened, the SAME request id is kept so
 *   the retry returns what the first attempt made; it is never reported as a plain
 *   failure and never made twice. A refusal or a changed preview starts fresh.
 * - A 404 means the connection ended (or the preparation is gone): details are cleared
 *   and nothing more is requested. Any other failed refresh keeps what is shown.
 */

export type PreparationApi = {
  list: (linkId: string) => Promise<LineageList>;
  create: (
    linkId: string,
    requestId: string,
    input: LineageCreateInput,
  ) => Promise<LineageDetail>;
  get: (linkId: string, lineageId: string) => Promise<LineageDetail>;
  discard: (linkId: string, lineageId: string) => Promise<void>;
  preview: (linkId: string, lineageId: string) => Promise<LineagePreview>;
  publish: (
    linkId: string,
    lineageId: string,
    requestId: string,
    fingerprint: string,
  ) => Promise<SentOfferDetail>;
};

export type PreparationListState = {
  items: LineageSummary[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** The connection is gone: nothing is shown and nothing more is requested. */
  unavailable: boolean;
};

export type PreparationDetailState = {
  lineageId: string | null;
  data: LineageDetail | null;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
};

export type PreparationPreviewState = {
  lineageId: string | null;
  data: LineagePreview | null;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  /** This preview replaced one the coach had been reviewing: it needs a fresh confirmation. */
  changed: boolean;
};

export type ProgramPreparationState = {
  userId: string | null;
  /** The connection every field below belongs to. */
  linkId: string | null;
  list: PreparationListState;
  detail: PreparationDetailState;
  preview: PreparationPreviewState;
  creating: boolean;
  publishing: boolean;
  discarding: boolean;
};

type Refusal = { kind: "unavailable"; message: string } | { kind: "failed"; message: string };

export type CreateOutcome =
  | { kind: "done"; lineage: LineageDetail }
  | { kind: "ignored" }
  | { kind: "stale" }
  | Refusal
  /** Unconfirmed. Creating the same thing again repeats the same request. */
  | { kind: "unknown"; message: string };

export type PublishOutcome =
  | { kind: "done"; version: SentOfferDetail }
  | { kind: "ignored" }
  | { kind: "stale" }
  | Refusal
  /** The draft changed after it was previewed: nothing was published; review the new version. */
  | { kind: "changed"; message: string }
  | { kind: "unknown"; message: string };

export type DiscardOutcome =
  | { kind: "done" }
  | { kind: "ignored" }
  | { kind: "stale" }
  | Refusal;

const emptyList = (): PreparationListState => ({
  items: [],
  loaded: false,
  loading: false,
  error: null,
  unavailable: false,
});

const emptyDetail = (lineageId: string | null = null): PreparationDetailState => ({
  lineageId,
  data: null,
  loading: false,
  error: null,
  unavailable: false,
});

const emptyPreview = (lineageId: string | null = null): PreparationPreviewState => ({
  lineageId,
  data: null,
  loading: false,
  error: null,
  unavailable: false,
  changed: false,
});

export function initialProgramPreparationState(
  userId: string | null = null,
  linkId: string | null = null,
): ProgramPreparationState {
  return {
    userId,
    linkId,
    list: emptyList(),
    detail: emptyDetail(),
    preview: emptyPreview(),
    creating: false,
    publishing: false,
    discarding: false,
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

const GONE =
  "This connection has ended, or this preparation no longer exists, so nothing more can be done here.";

export function createProgramPreparationStore(api: PreparationApi, newRequestId: () => string) {
  let state = initialProgramPreparationState();
  // Bumped when the user changes or on reset: everything in flight is void.
  let generation = 0;
  // Bumped when the store is pointed at another connection (or reset).
  let scope = 0;
  let listing: Promise<void> | null = null;
  let loadingDetail: string | null = null;
  let loadingPreview: string | null = null;
  let creating = false;
  let publishing = false;
  let discarding = false;
  // One request id per confirmed thing until it settles: creating the same preparation, or
  // publishing the same previewed content, again after an unclear failure repeats the request.
  const attempts = new Map<string, string>();
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<ProgramPreparationState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };
  const patchList = (changes: Partial<PreparationListState>) =>
    publish({ list: { ...state.list, ...changes } });
  const patchDetail = (changes: Partial<PreparationDetailState>) =>
    publish({ detail: { ...state.detail, ...changes } });
  const patchPreview = (changes: Partial<PreparationPreviewState>) =>
    publish({ preview: { ...state.preview, ...changes } });

  function resetTo(userId: string | null, linkId: string | null) {
    generation += 1;
    scope += 1;
    listing = null;
    loadingDetail = loadingPreview = null;
    creating = publishing = discarding = false;
    attempts.clear();
    state = initialProgramPreparationState(userId, linkId);
    listeners.forEach((listener) => listener());
  }

  /** Point the store at a user. Switching to a different one drops everything. */
  function bind(userId: string | null) {
    if (state.userId !== userId) resetTo(userId, null);
  }

  /** Point the store at one connection. A different one drops what was loaded. */
  function bindLink(linkId: string | null) {
    if (state.linkId === linkId) return;
    resetTo(state.userId, linkId);
  }

  const stale = (request: number, scoped: number) => request !== generation || scoped !== scope;

  /** The connection or a preparation is gone: forget what was shown for it. */
  function markUnavailable() {
    publish({
      list: { ...emptyList(), unavailable: true },
      detail: { ...emptyDetail(state.detail.lineageId), unavailable: true },
      preview: { ...emptyPreview(state.preview.lineageId), unavailable: true },
    });
  }

  /** A summary of a full detail, for keeping the list in step without another request. */
  function summaryOf(detail: LineageDetail): LineageSummary {
    const { has_unpublished_changes: _changes, versions: _versions, ...summary } = detail;
    return summary;
  }

  function applyDetail(detail: LineageDetail) {
    const exists = state.list.items.some((item) => item.id === detail.id);
    publish({
      list: {
        ...state.list,
        items: exists
          ? state.list.items.map((item) => (item.id === detail.id ? summaryOf(detail) : item))
          : state.list.items,
      },
      detail:
        state.detail.lineageId === detail.id ? { ...state.detail, data: detail } : state.detail,
    });
  }

  // ── The list ───────────────────────────────────────────────────────────

  /** Concurrent calls share one request; a failure keeps the list on screen. */
  function refreshList(): Promise<void> {
    const { userId, linkId } = state;
    if (!userId || !linkId || state.list.unavailable) return Promise.resolve();
    if (listing) return listing;
    const request = generation;
    const scoped = scope;
    patchList({ loading: true, error: null });
    const current = (async () => {
      try {
        const result = await api.list(linkId);
        if (stale(request, scoped)) return;
        patchList({ items: result.items, loaded: true, loading: false });
      } catch (error) {
        if (stale(request, scoped)) return;
        if (statusOf(error) === 404) {
          markUnavailable();
          return;
        }
        patchList({ loading: false, error: messageOf(error, "Could not load preparations") });
      } finally {
        if (!stale(request, scoped)) listing = null;
      }
    })();
    listing = current;
    return current;
  }

  // ── One preparation ────────────────────────────────────────────────────

  /** Open one preparation. A failed reload of the same one keeps what is shown. */
  async function loadDetail(lineageId: string): Promise<void> {
    const { userId, linkId } = state;
    if (!userId || !linkId || state.detail.unavailable && state.detail.lineageId === lineageId) {
      return;
    }
    if (loadingDetail === lineageId) return;
    const request = generation;
    const scoped = scope;
    loadingDetail = lineageId;
    const same = state.detail.lineageId === lineageId;
    patchDetail({
      lineageId,
      data: same ? state.detail.data : null,
      loading: true,
      error: null,
      unavailable: false,
    });
    const current = () => !stale(request, scoped) && state.detail.lineageId === lineageId;
    try {
      const data = await api.get(linkId, lineageId);
      if (!current()) return;
      applyDetail(data);
      patchDetail({ data, loading: false });
    } catch (error) {
      if (!current()) return;
      if (statusOf(error) === 404) {
        patchDetail({ ...emptyDetail(lineageId), unavailable: true });
        return;
      }
      patchDetail({ loading: false, error: messageOf(error, "Could not load this preparation") });
    } finally {
      if (!stale(request, scoped) && loadingDetail === lineageId) loadingDetail = null;
    }
  }

  /** Leaving a preparation: forget it and its preview, ignore their pending answers. */
  function closeDetail() {
    loadingDetail = loadingPreview = null;
    publish({ detail: emptyDetail(), preview: emptyPreview() });
  }

  // ── The preview that publishing confirms ───────────────────────────────

  /**
   * Load what publishing would send. `changed` marks a reload that replaced a version the
   * coach had been reviewing: the new content needs its own explicit confirmation.
   */
  async function loadPreview(lineageId: string, changed = false): Promise<void> {
    const { userId, linkId } = state;
    if (!userId || !linkId) return;
    const request = generation;
    const scoped = scope;
    loadingPreview = lineageId;
    patchPreview({
      lineageId,
      data: null,
      loading: true,
      error: null,
      unavailable: false,
      changed,
    });
    const current = () =>
      !stale(request, scoped) && loadingPreview === lineageId && state.preview.lineageId === lineageId;
    try {
      const data = await api.preview(linkId, lineageId);
      if (!current()) return;
      patchPreview({ data, loading: false });
    } catch (error) {
      if (!current()) return;
      if (statusOf(error) === 404) {
        patchPreview({ ...emptyPreview(lineageId), unavailable: true });
        return;
      }
      patchPreview({ loading: false, error: messageOf(error, "Could not load this preparation") });
    } finally {
      if (current()) loadingPreview = null;
    }
  }

  // ── Create ─────────────────────────────────────────────────────────────

  /**
   * Start a preparation for the bound connection, new or copied from one of the coach's
   * programs. The request id is kept until this exact request settles, so repeating it
   * after an unclear failure returns the same preparation instead of making a second one.
   */
  async function create(input: LineageCreateInput): Promise<CreateOutcome> {
    const { userId, linkId } = state;
    if (!userId || !linkId) return { kind: "stale" };
    if (creating) return { kind: "ignored" };
    const request = generation;
    const scoped = scope;
    const key = `${linkId}:${input.name ?? ""}:${input.from_program_id ?? ""}`;
    const requestId = attempts.get(key) ?? newRequestId();
    attempts.set(key, requestId);
    creating = true;
    publish({ creating: true });
    try {
      const lineage = await api.create(linkId, requestId, input);
      if (stale(request, scoped)) return { kind: "stale" };
      attempts.delete(key);
      const rest = state.list.items.filter((item) => item.id !== lineage.id);
      publish({ list: { ...state.list, items: [summaryOf(lineage), ...rest], loaded: true } });
      return { kind: "done", lineage };
    } catch (error) {
      if (stale(request, scoped)) return { kind: "stale" };
      const message = messageOf(error, "Could not start this preparation");
      if (statusOf(error) === 404) {
        attempts.delete(key);
        return { kind: "unavailable", message: GONE };
      }
      if (isDefinitive(error)) {
        // Refused: nothing was created, so a later try starts fresh.
        attempts.delete(key);
        return { kind: "failed", message };
      }
      return {
        kind: "unknown",
        message:
          "We could not confirm the preparation was created. Try again: it will not be created twice.",
      };
    } finally {
      if (!stale(request, scoped)) {
        creating = false;
        publish({ creating: false });
      }
    }
  }

  // ── Publish ────────────────────────────────────────────────────────────

  /**
   * Publish the next version, as previewed: `fingerprint` comes from the preview the coach
   * confirmed and names the content and the version number. The request id is kept until
   * the publication settles, so repeating after an unclear failure asks the backend for the
   * same version instead of making another.
   */
  async function publishVersion(lineageId: string, fingerprint: string): Promise<PublishOutcome> {
    const { userId, linkId } = state;
    if (!userId || !linkId) return { kind: "stale" };
    if (publishing) return { kind: "ignored" };
    const request = generation;
    const scoped = scope;
    const key = `${linkId}:${lineageId}:${fingerprint}`;
    const requestId = attempts.get(key) ?? newRequestId();
    attempts.set(key, requestId);
    publishing = true;
    publish({ publishing: true });
    try {
      const version = await api.publish(linkId, lineageId, requestId, fingerprint);
      if (stale(request, scoped)) return { kind: "stale" };
      attempts.delete(key);
      // What was reviewed is now history: the next publication needs a new preview.
      if (state.preview.lineageId === lineageId) publish({ preview: emptyPreview(lineageId) });
      return { kind: "done", version };
    } catch (error) {
      if (stale(request, scoped)) return { kind: "stale" };
      const message = messageOf(error, "Could not publish this version");
      if (statusOf(error) === 404) {
        attempts.delete(key);
        return { kind: "unavailable", message: GONE };
      }
      if (statusOf(error) === 412) {
        attempts.delete(key);
        return { kind: "changed", message };
      }
      if (isDefinitive(error)) {
        attempts.delete(key);
        return { kind: "failed", message };
      }
      return {
        kind: "unknown",
        message:
          "We could not confirm the version was published. Publish it again: it will not be published twice.",
      };
    } finally {
      if (!stale(request, scoped)) {
        publishing = false;
        publish({ publishing: false });
      }
    }
  }

  // ── Discard ────────────────────────────────────────────────────────────

  /** Delete a preparation that was never published. */
  async function discard(lineageId: string): Promise<DiscardOutcome> {
    const { userId, linkId } = state;
    if (!userId || !linkId) return { kind: "stale" };
    if (discarding) return { kind: "ignored" };
    const request = generation;
    const scoped = scope;
    discarding = true;
    publish({ discarding: true });
    try {
      await api.discard(linkId, lineageId);
      if (stale(request, scoped)) return { kind: "stale" };
      publish({
        list: { ...state.list, items: state.list.items.filter((item) => item.id !== lineageId) },
        detail: state.detail.lineageId === lineageId ? emptyDetail() : state.detail,
        preview: state.preview.lineageId === lineageId ? emptyPreview() : state.preview,
      });
      return { kind: "done" };
    } catch (error) {
      if (stale(request, scoped)) return { kind: "stale" };
      if (statusOf(error) === 404) {
        // Already gone (or the connection ended): the outcome the coach wanted, or nothing to do.
        void refreshList();
        return { kind: "unavailable", message: GONE };
      }
      return { kind: "failed", message: messageOf(error, "Could not discard this preparation") };
    } finally {
      if (!stale(request, scoped)) {
        discarding = false;
        publish({ discarding: false });
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
    bindLink,
    /** Sign-out and session expiry: forget everything and ignore what is still in flight. */
    reset: () => resetTo(null, null),
    refreshList,
    loadDetail,
    closeDetail,
    loadPreview,
    create,
    publishVersion,
    discard,
  };
}
