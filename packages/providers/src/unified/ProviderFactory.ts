import { LLMProvider } from './types';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIChatProvider } from './OpenAIChatProvider';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider';
import { getModelProvider, isReasoningModel } from '@budchat/models';

export class ProviderFactory {
  private static anthropicInstance: AnthropicProvider | null = null;
  private static openaiChatInstance: OpenAIChatProvider | null = null;
  private static openaiResponsesInstance: OpenAIResponsesProvider | null = null;

  static create(model: string): LLMProvider {
    const provider = getModelProvider(model);
    switch (provider) {
      case 'anthropic':
        if (!this.anthropicInstance) this.anthropicInstance = new AnthropicProvider();
        return this.anthropicInstance;
      case 'openai':
        if (isReasoningModel(model)) {
          if (!this.openaiResponsesInstance) this.openaiResponsesInstance = new OpenAIResponsesProvider();
          return this.openaiResponsesInstance;
        }
        if (!this.openaiChatInstance) this.openaiChatInstance = new OpenAIChatProvider();
        return this.openaiChatInstance;
      default:
        throw new Error(`Unknown provider for model: ${model}`);
    }
  }

  static createNew(model: string, apiKey?: string): LLMProvider {
    const provider = getModelProvider(model);
    switch (provider) {
      case 'anthropic':
        return new AnthropicProvider(apiKey);
      case 'openai':
        return isReasoningModel(model) ? new OpenAIResponsesProvider() : new OpenAIChatProvider();
      default:
        throw new Error(`Unknown provider for model: ${model}`);
    }
  }

  static clearCache(): void {
    this.anthropicInstance = null;
    this.openaiChatInstance = null;
    this.openaiResponsesInstance = null;
  }
}

