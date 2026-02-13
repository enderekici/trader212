import { describe, expect, it } from 'vitest';
import {
  ApiError,
  AuthError,
  RateLimitError,
  Trading212Error,
  ValidationError,
  serializeError,
} from '../../src/api/trading212/errors.js';

describe('Trading212 Errors', () => {
  describe('Trading212Error', () => {
    it('sets name, message, code, and statusCode', () => {
      const err = new Trading212Error('test error', 'TEST_CODE', 500);
      expect(err.name).toBe('Trading212Error');
      expect(err.message).toBe('test error');
      expect(err.code).toBe('TEST_CODE');
      expect(err.statusCode).toBe(500);
    });

    it('is an instance of Error', () => {
      const err = new Trading212Error('test', 'CODE');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(Trading212Error);
    });

    it('allows statusCode to be undefined', () => {
      const err = new Trading212Error('test', 'CODE');
      expect(err.statusCode).toBeUndefined();
    });

    it('captures a stack trace', () => {
      const err = new Trading212Error('test', 'CODE');
      expect(err.stack).toBeDefined();
      expect(err.stack).toContain('Trading212Error');
    });
  });

  describe('ApiError', () => {
    it('sets name to ApiError and code to API_ERROR', () => {
      const err = new ApiError('api error', 404, 'not found');
      expect(err.name).toBe('ApiError');
      expect(err.code).toBe('API_ERROR');
      expect(err.statusCode).toBe(404);
      expect(err.response).toBe('not found');
    });

    it('is an instance of Trading212Error', () => {
      const err = new ApiError('test', 400);
      expect(err).toBeInstanceOf(Trading212Error);
      expect(err).toBeInstanceOf(ApiError);
    });

    it('allows response to be undefined', () => {
      const err = new ApiError('test', 500);
      expect(err.response).toBeUndefined();
    });

    describe('fromResponse', () => {
      it('extracts message from body.message', () => {
        const err = ApiError.fromResponse(400, { message: 'bad request' });
        expect(err.message).toBe('bad request');
        expect(err.statusCode).toBe(400);
        expect(err.response).toEqual({ message: 'bad request' });
      });

      it('falls back to "API request failed" if body has no message', () => {
        const err = ApiError.fromResponse(500, { foo: 'bar' });
        expect(err.message).toBe('API request failed');
      });

      it('handles null body', () => {
        const err = ApiError.fromResponse(500, null);
        expect(err.message).toBe('API request failed');
      });

      it('handles string body', () => {
        const err = ApiError.fromResponse(500, 'raw error');
        expect(err.message).toBe('API request failed');
      });

      it('handles non-object body', () => {
        const err = ApiError.fromResponse(500, 42);
        expect(err.message).toBe('API request failed');
      });
    });
  });

  describe('AuthError', () => {
    it('sets name to AuthError, code to AUTH_ERROR, statusCode to 401', () => {
      const err = new AuthError('unauthorized');
      expect(err.name).toBe('AuthError');
      expect(err.code).toBe('AUTH_ERROR');
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('unauthorized');
    });

    it('is an instance of Trading212Error', () => {
      const err = new AuthError('test');
      expect(err).toBeInstanceOf(Trading212Error);
    });

    describe('missingApiKey', () => {
      it('returns an AuthError with missing key message', () => {
        const err = AuthError.missingApiKey();
        expect(err).toBeInstanceOf(AuthError);
        expect(err.message).toBe('TRADING212_API_KEY environment variable is required');
      });
    });

    describe('invalidApiKey', () => {
      it('returns an AuthError with invalid key message', () => {
        const err = AuthError.invalidApiKey();
        expect(err).toBeInstanceOf(AuthError);
        expect(err.message).toBe('Invalid API key');
      });
    });
  });

  describe('RateLimitError', () => {
    it('sets name to RateLimitError, code to RATE_LIMIT_ERROR, statusCode to 429', () => {
      const err = new RateLimitError('rate limited', 1700000000, 100);
      expect(err.name).toBe('RateLimitError');
      expect(err.code).toBe('RATE_LIMIT_ERROR');
      expect(err.statusCode).toBe(429);
      expect(err.resetAt).toBe(1700000000);
      expect(err.limit).toBe(100);
    });

    it('is an instance of Trading212Error', () => {
      const err = new RateLimitError('test', 0, 0);
      expect(err).toBeInstanceOf(Trading212Error);
    });

    describe('fromHeaders', () => {
      it('parses rate limit headers correctly', () => {
        const headers = {
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-limit': '100',
          'x-ratelimit-remaining': '5',
        };
        const err = RateLimitError.fromHeaders(headers);
        expect(err).toBeInstanceOf(RateLimitError);
        expect(err.resetAt).toBe(1700000000);
        expect(err.limit).toBe(100);
        expect(err.message).toContain('Rate limit exceeded');
        expect(err.message).toContain('Limit: 100');
        expect(err.message).toContain('Remaining: 5');
      });

      it('defaults to 0 when headers are missing', () => {
        const err = RateLimitError.fromHeaders({});
        expect(err.resetAt).toBe(0);
        expect(err.limit).toBe(0);
      });
    });
  });

  describe('ValidationError', () => {
    it('sets name, code, statusCode, and issues', () => {
      const issues = [{ path: ['field'], message: 'required' }];
      const err = new ValidationError('validation failed', issues);
      expect(err.name).toBe('ValidationError');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.statusCode).toBe(400);
      expect(err.issues).toEqual(issues);
    });

    it('allows issues to be undefined', () => {
      const err = new ValidationError('test');
      expect(err.issues).toBeUndefined();
    });

    it('is an instance of Trading212Error', () => {
      const err = new ValidationError('test');
      expect(err).toBeInstanceOf(Trading212Error);
    });

    describe('fromZodError', () => {
      it('creates ValidationError from a zod-like error', () => {
        const zodError = { issues: [{ path: ['field'], message: 'invalid' }] };
        const err = ValidationError.fromZodError(zodError);
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.message).toBe('Invalid request parameters');
        expect(err.issues).toEqual(zodError.issues);
      });
    });
  });

  describe('serializeError', () => {
    it('serializes a Trading212Error', () => {
      const err = new Trading212Error('test', 'CODE', 500);
      const serialized = serializeError(err);
      expect(serialized).toEqual({
        name: 'Trading212Error',
        message: 'test',
        code: 'CODE',
        statusCode: 500,
      });
    });

    it('serializes an ApiError', () => {
      const err = new ApiError('api error', 404, 'body');
      const serialized = serializeError(err);
      expect(serialized).toEqual({
        name: 'ApiError',
        message: 'api error',
        code: 'API_ERROR',
        statusCode: 404,
      });
    });

    it('serializes a ValidationError with issues', () => {
      const issues = [{ path: ['field'], message: 'required' }];
      const err = new ValidationError('validation', issues);
      const serialized = serializeError(err);
      expect(serialized).toEqual({
        name: 'ValidationError',
        message: 'validation',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        issues,
      });
    });

    it('serializes a ValidationError without issues', () => {
      const err = new ValidationError('validation');
      const serialized = serializeError(err);
      expect(serialized).toEqual({
        name: 'ValidationError',
        message: 'validation',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    it('serializes a RateLimitError (no issues key)', () => {
      const err = new RateLimitError('rate limited', 1000, 60);
      const serialized = serializeError(err);
      expect(serialized).toEqual({
        name: 'RateLimitError',
        message: 'rate limited',
        code: 'RATE_LIMIT_ERROR',
        statusCode: 429,
      });
    });

    it('serializes a plain Error', () => {
      const err = new Error('plain error');
      const serialized = serializeError(err);
      expect(serialized).toEqual({
        name: 'Error',
        message: 'plain error',
      });
    });

    it('serializes a string', () => {
      const serialized = serializeError('string error');
      expect(serialized).toEqual({
        name: 'UnknownError',
        message: 'string error',
      });
    });

    it('serializes a number', () => {
      const serialized = serializeError(42);
      expect(serialized).toEqual({
        name: 'UnknownError',
        message: '42',
      });
    });

    it('serializes null', () => {
      const serialized = serializeError(null);
      expect(serialized).toEqual({
        name: 'UnknownError',
        message: 'null',
      });
    });

    it('serializes undefined', () => {
      const serialized = serializeError(undefined);
      expect(serialized).toEqual({
        name: 'UnknownError',
        message: 'undefined',
      });
    });
  });
});
