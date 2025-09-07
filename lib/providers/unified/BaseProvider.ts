// Base class for all LLM providers
import { 
  LLMProvider, 
  UnifiedChatRequest, 
  UnifiedChatResponse, 
  StreamEvent, 
  ValidationResult, 
  ProviderFeature 
} from './types';
import { Event, EventLog } from '@budchat/events';

export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly provider: 'openai' | 'anthropic';
  
  // Abstract methods that must be implemented by each provider
  abstract chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  abstract stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent>;
  
  // Common validation logic
  validateConfig(config: Partial<UnifiedChatRequest>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Common validations
    if (config.temperature !== undefined) {
      if (!this.supportsFeature(ProviderFeature.TEMPERATURE)) {
        errors.push(`${this.name} does not support temperature setting`);
      } else if (config.temperature < 0 || config.temperature > 2) {
        errors.push('Temperature must be between 0 and 2');
      }
    }
    
    if (config.reasoningEffort !== undefined && !this.supportsFeature(ProviderFeature.REASONING_EFFORT)) {
      errors.push(`${this.name} does not support reasoning effort setting`);
    }
    
    // Provider-specific validations
    const providerValidation = this.validateProviderSpecific(config);
    errors.push(...providerValidation.errors || []);
    warnings.push(...providerValidation.warnings || []);
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
  
  // Provider-specific validation to be implemented by subclasses
  protected abstract validateProviderSpecific(config: Partial<UnifiedChatRequest>): ValidationResult;
  
  // Feature support - can be overridden by subclasses
  supportsFeature(feature: ProviderFeature): boolean {
    // Default feature support - override in subclasses
    const defaultSupport: Record<ProviderFeature, boolean> = {
      [ProviderFeature.TEMPERATURE]: true,
      [ProviderFeature.REASONING]: false,
      [ProviderFeature.TOOL_CALLING]: true,
      [ProviderFeature.REASONING_EFFORT]: false,
      [ProviderFeature.SYSTEM_MESSAGE]: true,
      [ProviderFeature.STREAMING]: true,
      [ProviderFeature.VISION]: false
    };
    
    return this.getFeatureSupport()[feature] ?? defaultSupport[feature] ?? false;
  }
  
  // Override this in subclasses to specify feature support
  protected abstract getFeatureSupport(): Partial<Record<ProviderFeature, boolean>>;
  
  // Helper method to convert events to provider format
  protected convertEventsToProviderFormat(events: Event[]): unknown[] {
    const eventLog = new EventLog(events);
    return eventLog.toProviderMessages(this.provider);
  }
  
  // Helper to extract system message for providers that need it
  protected getSystemMessage(events: Event[]): string {
    const eventLog = new EventLog(events);
    return eventLog.getSystemMessage();
  }
  
  // Common error handling
  protected handleProviderError(error: unknown): Error {
    if (error instanceof Error) {
      // Add provider context to error
      error.message = `[${this.name}] ${error.message}`;
      return error;
    }
    
    return new Error(`[${this.name}] Unknown error: ${String(error)}`);
  }
  
  // Generate unique ID for tool calls
  protected generateToolCallId(): string {
    return `call_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`;
  }
}
