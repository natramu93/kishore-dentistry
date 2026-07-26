/**
 * Errors whose messages are deliberately safe to return from a Server Action.
 * Infrastructure/database errors must remain ordinary Errors so they are logged
 * server-side and mapped to a generic client response.
 */
export class PublicError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublicError";
    this.code = code;
  }
}

export class AuthorizationError extends PublicError {
  constructor(message = "Not authorized") {
    super("FORBIDDEN", message);
    this.name = "AuthorizationError";
  }
}

export class ValidationError extends PublicError {
  constructor(message = "Invalid input") {
    super("INVALID_INPUT", message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends PublicError {
  constructor(resource = "Record") {
    super("NOT_FOUND", `${resource} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends PublicError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends PublicError {
  constructor(message = "Too many requests. Please wait a moment and try again.") {
    super("RATE_LIMITED", message);
    this.name = "RateLimitError";
  }
}
