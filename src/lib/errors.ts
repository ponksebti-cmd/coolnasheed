/**
 * The one error vocabulary the client speaks.
 *
 * Everything that can go wrong between the browser and Supabase — a refused insert,
 * an expired session, a missing project URL, a function that answered 413 — arrives
 * in the stores as one of these, so a form can show `message` inline against `field`
 * and the rest of the app can decide between "try again" and "you need an account".
 */

export class ApiError extends Error {
  readonly status: number;
  readonly field?: string;

  constructor(message: string, status = 400, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }
}

/** Nothing answered at all: offline, blocked, or the project is not reachable. */
export class ApiUnreachable extends ApiError {
  constructor(message = "Cannot reach Supabase. Check the connection and try again.") {
    super(message, 0);
    this.name = "ApiUnreachable";
  }
}

/**
 * The app is running with no Supabase credentials, so there is no catalogue at all
 * there is. Listening and searching work; anything that writes cannot. The UI turns
 * this into "connect a project" rather than a red failure.
 */
export class DemoModeError extends ApiError {
  readonly demo = true;

  constructor(action = "that") {
    super(
      `Demo mode: ${action} needs a Supabase project. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env and reload.`,
      503,
    );
    this.name = "DemoModeError";
  }
}

/** The session expired or never existed; the stores answer by opening the sign-in sheet. */
export class AuthError extends ApiError {
  constructor(message = "You need an account for that.") {
    super(message, 401);
    this.name = "AuthError";
  }
}

export function errorMessage(err: unknown, fallback = "That did not work. Try again."): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

export function errorField(err: unknown): string | undefined {
  return err instanceof ApiError ? err.field : undefined;
}

export function isDemoError(err: unknown): boolean {
  return err instanceof DemoModeError;
}

export function isAuthError(err: unknown): boolean {
  return err instanceof AuthError || (err instanceof ApiError && err.status === 401);
}
