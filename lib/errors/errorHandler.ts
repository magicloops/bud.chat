// Global error handler utilities
import { NextResponse } from 'next/server';
import { AppError, ErrorCode } from './AppError';

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Handle errors in API routes consistently
 */
export function handleApiError(error: unknown): NextResponse<ErrorResponse> {
  console.error('API Error:', error);
  
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: process.env.NODE_ENV === 'development' ? error.context : undefined
      },
      { status: error.statusCode }
    );
  }
  
  // Handle known error types
  if (error instanceof Error) {
    // Check for specific error patterns
    if (error.message.includes('rate limit')) {
      const appError = new AppError(
        ErrorCode.PROVIDER_RATE_LIMIT,
        'Rate limit exceeded. Please try again later.',
        { statusCode: 429, originalError: error }
      );
      return handleApiError(appError);
    }
    
    if (error.message.includes('API key')) {
      const appError = new AppError(
        ErrorCode.PROVIDER_INVALID_KEY,
        'Invalid API key',
        { statusCode: 401, originalError: error }
      );
      return handleApiError(appError);
    }
    
    // Default error response
    return NextResponse.json(
      {
        error: process.env.NODE_ENV === 'production' 
          ? 'An error occurred' 
          : error.message,
        code: ErrorCode.INTERNAL_ERROR
      },
      { status: 500 }
    );
  }
  
  // Unknown error type
  return NextResponse.json(
    {
      error: 'An unexpected error occurred',
      code: ErrorCode.UNKNOWN_ERROR
    },
    { status: 500 }
  );
}

/**
 * Handle errors in streaming responses
 */
export function handleStreamError(error: unknown): string {
  console.error('Stream Error:', error);
  
  let errorData: ErrorResponse;
  
  if (error instanceof AppError) {
    errorData = {
      error: error.message,
      code: error.code
    };
  } else if (error instanceof Error) {
    errorData = {
      error: process.env.NODE_ENV === 'production' 
        ? 'Stream error occurred' 
        : error.message,
      code: ErrorCode.STREAM_INTERRUPTED
    };
  } else {
    errorData = {
      error: 'Unknown stream error',
      code: ErrorCode.UNKNOWN_ERROR
    };
  }
  
  // Return as SSE error event
  return `data: ${JSON.stringify({ type: 'error', data: errorData })}\n\n`;
}

/**
 * Wrap async functions with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  errorTransformer?: (error: unknown) => AppError
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (errorTransformer) {
        throw errorTransformer(error);
      }
      throw error;
    }
  }) as T;
}

/**
 * Type guard for AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Convert various error types to AppError
 */
export function toAppError(error: unknown, defaultCode = ErrorCode.INTERNAL_ERROR): AppError {
  if (error instanceof AppError) {
    return error;
  }
  
  if (error instanceof Error) {
    // Check for specific error patterns
    if (error.message.includes('violates foreign key constraint')) {
      return new AppError(
        ErrorCode.DB_CONSTRAINT_ERROR,
        'Database constraint violation',
        { originalError: error }
      );
    }
    
    if (error.message.includes('duplicate key')) {
      return new AppError(
        ErrorCode.DB_CONSTRAINT_ERROR,
        'Duplicate entry',
        { originalError: error }
      );
    }
    
    return new AppError(defaultCode, error.message, { originalError: error });
  }
  
  return new AppError(
    defaultCode,
    'An unexpected error occurred',
    { originalError: error }
  );
}