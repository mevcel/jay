// SPDX-License-Identifier: MIT
// Pons Family: named error types for Jay, the pons.family support agent.

/**
 * Base class for every error Jay raises on purpose.
 *
 * Why a shared base: the run loop distinguishes "Jay decided something is
 * wrong" (log, skip the message, keep polling) from genuine crashes (let the
 * process supervisor restart us). `instanceof PonsJayError` is that line.
 */
export class PonsJayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Environment is missing or malformed. Raised once, at boot. */
export class PonsConfigError extends PonsJayError {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join("\n  - ")}`);
  }
}

/** A drafted reply failed an outbound guardrail and must not be posted. */
export class PonsGuardrailViolation extends PonsJayError {
  constructor(
    readonly rule: string,
    readonly draft: string,
  ) {
    super(`Reply blocked by guardrail "${rule}"`);
  }
}

/** The agent loop ended without calling `submit_decision`. */
export class PonsNoDecisionError extends PonsJayError {
  constructor(
    readonly messageId: string,
    readonly stopReason: string | null,
    readonly iterations: number,
  ) {
    super(
      `Agent produced no decision for ${messageId} (stop_reason=${stopReason}, iterations=${iterations})`,
    );
  }
}

/** The model declined the request even after server-side fallback. */
export class PonsRefusalError extends PonsJayError {
  constructor(
    readonly messageId: string,
    readonly category: string | null,
  ) {
    super(`Model refused message ${messageId} (category=${category ?? "unknown"})`);
  }
}

/** A tool received input that does not match its schema. */
export class PonsToolInputError extends PonsJayError {
  constructor(
    readonly tool: string,
    readonly detail: string,
  ) {
    super(`Invalid input for tool "${tool}": ${detail}`);
  }
}

/** Posting to X failed after retries. */
export class PonsXPostError extends PonsJayError {
  constructor(
    readonly inReplyTo: string,
    readonly underlying: unknown,
  ) {
    super(`Failed to post reply to ${inReplyTo}: ${String(underlying)}`);
  }
}

/** The rolling hourly reply budget is spent; Jay pauses public replies. */
export class PonsRateBudgetExceeded extends PonsJayError {
  constructor(
    readonly sent: number,
    readonly limit: number,
  ) {
    super(`Hourly reply budget exhausted (${sent}/${limit})`);
  }
}
