// Standardized error system for the application

export enum ErrorCode {
  // Authentication errors (1xxx)
  UNAUTHORIZED = 'AUTH_001',
  FORBIDDEN = 'AUTH_002',
  SESSION_EXPIRED = 'AUTH_003',
  
  // Validation errors (2xxx)
  INVALID_INPUT = 'VAL_001',
  MISSING_REQUIRED_FIELD = 'VAL_002',
  INVALID_MODEL = 'VAL_003',
  INVALID_TEMPERATURE = 'VAL_004',
  
  // Database errors (3xxx)
  DB_CONNECTION_ERROR = 'DB_001',
  DB_QUERY_ERROR = 'DB_002',
  DB_NOT_FOUND = 'DB_003',
  DB_CONSTRAINT_ERROR = 'DB_004',
  
  // Provider errors (4xxx)
  PROVIDER_API_ERROR = 'PROV_001',
  PROVIDER_RATE_LIMIT = 'PROV_002',
  PROVIDER_INVALID_KEY = 'PROV_003',
  PROVIDER_TIMEOUT = 'PROV_004',
  PROVIDER_UNSUPPORTED_FEATURE = 'PROV_005',
  
  // MCP errors (5xxx)
  MCP_SERVER_ERROR = 'MCP_001',
  MCP_TOOL_NOT_FOUND = 'MCP_002',
  MCP_TOOL_EXECUTION_ERROR = 'MCP_003',
  MCP_APPROVAL_REQUIRED = 'MCP_004',
  
  // Stream errors (6xxx)
  STREAM_INITIALIZATION_ERROR = 'STREAM_001',
  STREAM_PARSE_ERROR = 'STREAM_002',
  STREAM_INTERRUPTED = 'STREAM_003',
  
  // General errors (9xxx)
  INTERNAL_ERROR = 'ERR_001',
  NOT_IMPLEMENTED = 'ERR_002',
  UNKNOWN_ERROR = 'ERR_999'
}

export interface ErrorDetails {
  statusCode?: number;
  originalError?: unknown;
  context?: Record<string, unknown>;
  stack?: string;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: Date;
  
  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetails
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = details?.statusCode || this.getDefaultStatusCode(code);
    this.details = details?.originalError;
    this.context = details?.context;
    this.timestamp = new Date();
    
    // Capture stack trace
    if (details?.stack) {
      this.stack = details.stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  private getDefaultStatusCode(code: ErrorCode): number {
    // Map error codes to HTTP status codes
    const codePrefix = code.split('_')[0];
    
    switch (codePrefix) {
      case 'AUTH':
        return code === ErrorCode.UNAUTHORIZED ? 401 : 403;
      case 'VAL':
        return 400;
      case 'DB':
        return code === ErrorCode.DB_NOT_FOUND ? 404 : 500;
      case 'PROV':
        return code === ErrorCode.PROVIDER_RATE_LIMIT ? 429 : 502;
      case 'MCP':
        return 500;
      case 'STREAM':
        return 500;
      default:
        return 500;
    }
  }
  
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      context: this.context
    };
  }
  
  // Factory methods for common errors
  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(ErrorCode.UNAUTHORIZED, message, { statusCode: 401 });
  }
  
  static forbidden(message = 'Forbidden'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, message, { statusCode: 403 });
  }
  
  static notFound(resource: string): AppError {
    return new AppError(
      ErrorCode.DB_NOT_FOUND, 
      `${resource} not found`, 
      { statusCode: 404 }
    );
  }
  
  static validation(message: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorCode.INVALID_INPUT, 
      message, 
      { statusCode: 400, context }
    );
  }
  
  static internal(message: string, originalError?: unknown): AppError {
    return new AppError(
      ErrorCode.INTERNAL_ERROR,
      message,
      { statusCode: 500, originalError }
    );
  }
  
  static provider(message: string, code = ErrorCode.PROVIDER_API_ERROR): AppError {
    return new AppError(code, message, { statusCode: 502 });
  }
}