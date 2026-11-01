/** An error with an HTTP status and a plain-language message for the person using the app. */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
