/**
 * Base error class for Trading 212 API errors
 */
export class Trading212Error extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'Trading212Error';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * API error - thrown when the Trading 212 API returns an error response
 */
export class ApiError extends Trading212Error {
  constructor(
    message: string,
    statusCode: number,
    public response?: unknown,
  ) {
    super(message, 'API_ERROR', statusCode);
    this.name = 'ApiError';
  }

  static fromResponse(statusCode: number, body: unknown): ApiError {
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : 'API request failed';
    return new ApiError(message, statusCode, body);
  }
}

/**
 * Authentication error - thrown when API key is invalid or missing
 */
export class AuthError extends Trading212Error {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthError';
  }

  static missingApiKey(): AuthError {
    return new AuthError('TRADING212_API_KEY environment variable is required');
  }

  static invalidApiKey(): AuthError {
    return new AuthError('Invalid API key');
  }
}

/**
 * Rate limit error - thrown when API rate limit is exceeded
 */
export class RateLimitError extends Trading212Error {
  constructor(
    message: string,
    public resetAt: number,
    public limit: number,
  ) {
    super(message, 'RATE_LIMIT_ERROR', 429);
    this.name = 'RateLimitError';
  }

  static fromHeaders(headers: Record<string, string>): RateLimitError {
    const reset = Number.parseInt(headers['x-ratelimit-reset'] || '0', 10);
    const limit = Number.parseInt(headers['x-ratelimit-limit'] || '0', 10);
    const remaining = Number.parseInt(headers['x-ratelimit-remaining'] || '0', 10);

    const resetDate = new Date(reset * 1000);
    const message = `Rate limit exceeded. Limit: ${limit}, Remaining: ${remaining}, Resets at: ${resetDate.toISOString()}`;

    return new RateLimitError(message, reset, limit);
  }
}

/**
 * Validation error - thrown when request parameters are invalid
 */
export class ValidationError extends Trading212Error {
  constructor(
    message: string,
    public issues?: unknown[],
  ) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }

  static fromZodError(error: { issues: unknown[] }): ValidationError {
    const message = 'Invalid request parameters';
    return new ValidationError(message, error.issues);
  }
}

/**
 * Serialize error for JSON responses
 */
export function serializeError(error: unknown): {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  issues?: unknown[];
} {
  if (error instanceof Trading212Error) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      ...(error instanceof ValidationError && error.issues ? { issues: error.issues } : {}),
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: 'UnknownError',
    message: String(error),
  };
}
