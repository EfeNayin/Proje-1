/** The person closed the Google or Apple sheet. Not a failure: nothing is shown for it. */
export class SocialCancelledError extends Error {
  constructor() {
    super("Sign-in was cancelled.");
    this.name = "SocialCancelledError";
  }
}

/** The provider cannot be used on this device or build (not iOS, module absent, not configured). */
export class SocialUnavailableError extends Error {
  constructor(message = "This sign-in is not available on this device.") {
    super(message);
    this.name = "SocialUnavailableError";
  }
}
