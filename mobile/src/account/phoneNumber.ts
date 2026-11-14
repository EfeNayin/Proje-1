/**
 * The optional phone number: what a person may type and what is stored.
 *
 * Mirrors backend/app/domains/auth/schemas.py (normalize_phone_number), message for message,
 * so the form can say what the server would say before a request is made. The server stays the
 * authority; keep the two in step, and the shared cases in tests/phone-number.test.cjs and
 * backend/tests/test_phone_number.py.
 *
 * The rule is structural E.164: "+", a country calling code and the subscriber number, ASCII
 * digits only, 8 to 15 of them. It does not know which numbers exist or what length a country
 * uses, and nothing verifies that the number is reachable: it is contact information the
 * owner typed, never proof of anything. An explicit country code is required because no
 * country is assumed: "0532 123 45 67" is refused, not guessed to be Turkish.
 */

export const PHONE_INPUT_MAX_LENGTH = 40;

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;
const SEPARATORS = " \t-.()";

export const PHONE_COUNTRY_CODE_HINT =
  "Start with the country code, for example +90 532 123 45 67. " +
  "Spaces, hyphens, dots and parentheses are allowed.";

export type PhoneParse =
  /** Nothing typed: the number is simply not set (valid, optional). */
  | { kind: "empty" }
  /** `value` is what is stored and sent: "+905321234567". */
  | { kind: "valid"; value: string }
  | { kind: "invalid"; message: string };

export function parsePhoneNumber(input: string): PhoneParse {
  let text = input.trim();
  if (text === "") return { kind: "empty" };
  // "00" is the international call prefix many countries dial instead of "+".
  if (text.startsWith("00")) text = `+${text.slice(2)}`;
  if (!text.startsWith("+")) {
    return {
      kind: "invalid",
      message: `Phone number needs an explicit country code. ${PHONE_COUNTRY_CODE_HINT}`,
    };
  }
  let digits = "";
  for (const character of text.slice(1)) {
    if (!SEPARATORS.includes(character)) digits += character;
  }
  // ASCII digits only: \d-like checks elsewhere also accept other scripts' digits.
  if (digits === "" || !/^[0-9]+$/.test(digits)) {
    return {
      kind: "invalid",
      message: `Phone number may contain only digits after the +. ${PHONE_COUNTRY_CODE_HINT}`,
    };
  }
  if (digits.startsWith("0")) {
    return {
      kind: "invalid",
      message: `A country code never starts with 0. ${PHONE_COUNTRY_CODE_HINT}`,
    };
  }
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
    return {
      kind: "invalid",
      message: `Phone number must have ${MIN_DIGITS} to ${MAX_DIGITS} digits including the country code.`,
    };
  }
  return { kind: "valid", value: `+${digits}` };
}

/** Message for the form (null when the input is blank or acceptable). */
export function phoneNumberError(input: string): string | null {
  if (input.length > PHONE_INPUT_MAX_LENGTH) {
    return `Phone number must be at most ${PHONE_INPUT_MAX_LENGTH} characters.`;
  }
  const parsed = parsePhoneNumber(input);
  return parsed.kind === "invalid" ? parsed.message : null;
}

/** What to send for a typed number: undefined when blank (the field is left out). */
export function phoneNumberForRequest(input: string): string | undefined {
  const parsed = parsePhoneNumber(input);
  return parsed.kind === "valid" ? parsed.value : undefined;
}
