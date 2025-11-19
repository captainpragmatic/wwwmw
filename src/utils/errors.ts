/**
 * Error response helpers
 */

import { corsHeaders } from './cors';

export function errorResponse(message: string, status = 500): Response {
  return new Response(
    JSON.stringify({
      error: message,
      status
    }),
    {
      status,
      headers: corsHeaders
    }
  );
}

export function validationErrorResponse(message: string): Response {
  return errorResponse(message, 400);
}

export function notFoundResponse(): Response {
  return errorResponse('Not Found', 404);
}

export function methodNotAllowedResponse(): Response {
  return errorResponse('Method Not Allowed', 405);
}

export function internalErrorResponse(message = 'Internal Server Error'): Response {
  return errorResponse(message, 500);
}
