// Factory for creating provider instances
import { LLMProvider } from './types';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIChatProvider } from './OpenAIChatProvider';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider';
import { getModelProvider, isReasoningModel } from '@/lib/modelMapping';

export class ProviderFactory {
  private static anthropicInstance: AnthropicProvider | null = null;
  private static openaiChatInstance: OpenAIChatProvider | null = null;
  private static openaiResponsesInstance: OpenAIResponsesProvider | null = null;
  
  /**
   * Create a provider instance based on the model name
   * Uses singleton pattern to avoid creating multiple SDK instances
   */
  static create(model: string): LLMProvider {
    const provider = getModelProvider(model);
    
    switch (provider) {
      case 'anthropic':
        if (!this.anthropicInstance) {
          this.anthropicInstance = new AnthropicProvider();
        }
        return this.anthropicInstance;
        
      case 'openai':
        // Route to appropriate OpenAI provider based on model type
        if (isReasoningModel(model)) {
          if (!this.openaiResponsesInstance) {
            this.openaiResponsesInstance = new OpenAIResponsesProvider();
          }
          return this.openaiResponsesInstance;
        } else {
          if (!this.openaiChatInstance) {
            this.openaiChatInstance = new OpenAIChatProvider();
          }
          return this.openaiChatInstance;
        }
        
      default:
        throw new Error(`Unknown provider for model: ${model}`);
    }
  }
  
  /**
   * Create a new provider instance (non-singleton)
   * Useful for testing or when you need separate instances
   */
  static createNew(model: string, apiKey?: string): LLMProvider {
    const provider = getModelProvider(model);
    
    switch (provider) {
      case 'anthropic':
        return new AnthropicProvider(apiKey);
        
      case 'openai':
        // Route to appropriate OpenAI provider based on model type
        if (isReasoningModel(model)) {
          return new OpenAIResponsesProvider();
        } else {
          return new OpenAIChatProvider();
        }
        
      default:
        throw new Error(`Unknown provider for model: ${model}`);
    }
  }
  
  /**
   * Clear cached instances
   * Useful for testing or when API keys change
   */
  static clearCache(): void {
    this.anthropicInstance = null;
    this.openaiChatInstance = null;
    this.openaiResponsesInstance = null;
  }
}