// Base class for OpenAI providers with shared functionality
import OpenAI from 'openai';
import { BaseProvider } from './BaseProvider';
import { ProviderFeature } from './types';
import { AppError, ErrorCode } from '@/lib/errors';
import { getApiModelName } from '@budchat/models';

export abstract class OpenAIBaseProvider extends BaseProvider {
  protected client: OpenAI;
  
  constructor() {
    super();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new AppError(ErrorCode.PROVIDER_INVALID_KEY, 'OpenAI API key not configured');
    }
    this.client = new OpenAI({ apiKey });
  }
  
  protected handleProviderError(error: unknown): AppError {
    console.log('🔍 [OpenAI Base] Handling error:', { errorType: (error as any)?.constructor?.name, isOpenAIError: error instanceof OpenAI.APIError, error });
    if (error instanceof OpenAI.APIError) {
      return new AppError(ErrorCode.PROVIDER_API_ERROR, error.message, { statusCode: error.status, originalError: error });
    }
    if (error instanceof Error) {
      return new AppError(ErrorCode.PROVIDER_API_ERROR, error.message, { originalError: error });
    }
    return new AppError(ErrorCode.PROVIDER_API_ERROR, String(error));
  }
  
  protected getModelName(friendlyName: string): string {
    return getApiModelName(friendlyName);
  }
  
  protected getFeatureSupport(): Partial<Record<ProviderFeature, boolean>> {
    return {};
  }
}

