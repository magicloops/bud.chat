// Base class for all LLM providers
import { LLMProvider, UnifiedChatRequest, UnifiedChatResponse, StreamEvent, ValidationResult, ProviderFeature } from './types';
import { Event, EventLog } from '@budchat/events';

export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly provider: 'openai' | 'anthropic';
  abstract chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  abstract stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent>;

  validateConfig(config: Partial<UnifiedChatRequest>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (config.temperature !== undefined) {
      if (!this.supportsFeature(ProviderFeature.TEMPERATURE)) errors.push(`${this.name} does not support temperature setting`);
      else if (config.temperature < 0 || config.temperature > 2) errors.push('Temperature must be between 0 and 2');
    }
    if (config.reasoningEffort !== undefined && !this.supportsFeature(ProviderFeature.REASONING_EFFORT)) {
      errors.push(`${this.name} does not support reasoning effort setting`);
    }
    const providerValidation = this.validateProviderSpecific(config);
    errors.push(...(providerValidation.errors || []));
    warnings.push(...(providerValidation.warnings || []));
    return { valid: errors.length === 0, errors: errors.length ? errors : undefined, warnings: warnings.length ? warnings : undefined };
  }

  protected abstract validateProviderSpecific(config: Partial<UnifiedChatRequest>): ValidationResult;
  protected abstract getFeatureSupport(): Partial<Record<ProviderFeature, boolean>>;

  supportsFeature(feature: ProviderFeature): boolean {
    const defaults: Record<ProviderFeature, boolean> = { [ProviderFeature.TEMPERATURE]: true, [ProviderFeature.REASONING]: false, [ProviderFeature.TOOL_CALLING]: true, [ProviderFeature.REASONING_EFFORT]: false, [ProviderFeature.SYSTEM_MESSAGE]: true, [ProviderFeature.STREAMING]: true, [ProviderFeature.VISION]: false };
    return this.getFeatureSupport()[feature] ?? defaults[feature] ?? false;
  }

  protected convertEventsToProviderFormat(events: Event[]): unknown[] {
    const eventLog = new EventLog(events);
    return eventLog.toProviderMessages(this.provider);
  }

  protected getSystemMessage(events: Event[]): string {
    const eventLog = new EventLog(events);
    return eventLog.getSystemMessage();
  }

  protected handleProviderError(error: unknown): Error {
    if (error instanceof Error) {
      error.message = `[${this.name}] ${error.message}`;
      return error;
    }
    return new Error(`[${this.name}] Unknown error: ${String(error)}`);
  }

  protected generateToolCallId(): string { return `call_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`; }
}

