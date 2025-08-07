// Base class for OpenAI providers with shared functionality
import OpenAI from 'openai';
import { BaseProvider } from './BaseProvider';
import { ProviderFeature } from './types';
import { AppError, ErrorCode } from '@/lib/errors';
import { getApiModelName } from '@/lib/modelMapping';

export abstract class OpenAIBaseProvider extends BaseProvider {
  protected client: OpenAI;
  
  constructor() {
    super();
    
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new AppError(
        ErrorCode.PROVIDER_INVALID_KEY,
        'OpenAI API key not configured'
      );
    }
    
    this.client = new OpenAI({ apiKey });
  }
  
  // Shared error handling
  protected handleProviderError(error: unknown): AppError {
    console.log('🔍 [OpenAI Base] Handling error:', {
      errorType: error?.constructor?.name,
      isOpenAIError: error instanceof OpenAI.APIError,
      error
    });
    
    if (error instanceof OpenAI.APIError) {
      const message = `[OpenAI] ${error.status || 'Unknown'} ${error.message}`;
      
      switch (error.status) {
        case 401:
          return new AppError(ErrorCode.PROVIDER_INVALID_KEY, message, { originalError: error });
        case 429:
          return new AppError(ErrorCode.PROVIDER_RATE_LIMIT, message, { originalError: error });
        case 400:
          return new AppError(ErrorCode.INVALID_INPUT, message, { originalError: error });
        case 500:
        case 502:
        case 503:
          return new AppError(ErrorCode.PROVIDER_API_ERROR, message, { originalError: error });
        default:
          return new AppError(ErrorCode.PROVIDER_API_ERROR, message, { originalError: error });
      }
    }
    
    // Handle other types of errors
    if (error instanceof Error) {
      return new AppError(
        ErrorCode.PROVIDER_API_ERROR,
        `OpenAI request failed: ${error.message}`,
        { originalError: error }
      );
    }
    
    return new AppError(
      ErrorCode.PROVIDER_API_ERROR,
      'OpenAI request failed with unknown error',
      { originalError: error }
    );
  }
  
  // Shared feature support
  supportsFeature(feature: ProviderFeature): boolean {
    const commonFeatures = [
      ProviderFeature.STREAMING,
      ProviderFeature.SYSTEM_MESSAGE,
    ];
    
    return commonFeatures.includes(feature);
  }
  
  // Model name mapping
  protected getModelName(model: string): string {
    return getApiModelName(model);
  }
}