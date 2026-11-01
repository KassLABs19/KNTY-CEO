/** An error with an HTTP status and a plain-language message for the person using the app. */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/**
 * A response to send once the database transaction has committed. Handlers return it
 * (even from inside withCompany) instead of calling reply.send, so the caller never sees
 * an answer for a change that is not yet saved. A hook in app.ts sends it.
 */
export class Outcome {
  constructor(public status: number, public body?: unknown) {}
}

export const outcome = (status: number, error: string, message: string) => new Outcome(status, { error, message });
export const noContent = () => new Outcome(204);
