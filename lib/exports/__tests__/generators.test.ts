import { buildProviderTranscript } from '../providerTranscripts/buildProviderTranscript';
import { generateOpenAIChatSdk } from '../generators/openaiChatSdk';
import { generateOpenAIChatHttp } from '../generators/openaiChatHttp';
import { generateOpenAIResponsesSdk } from '../generators/openaiResponsesSdk';
import { generateOpenAIResponsesHttp } from '../generators/openaiResponsesHttp';
import { generateAnthropicSdk } from '../generators/anthropicSdk';
import { generateAnthropicHttp } from '../generators/anthropicHttp';
import { openAIChatConversation, openAIResponsesConversation, anthropicConversation } from '../test-utils/conversations';
import type { TranscriptContext } from '../types';

describe('generator templates', () => {
  const baseContext: Omit<TranscriptContext, 'events' | 'model'> = {
    temperature: 0.2,
    maxTokens: 256,
  };

  const chatTranscript = buildProviderTranscript({
    targetProvider: 'openai-chat',
    context: { model: 'gpt-4o', events: openAIChatConversation, ...baseContext },
  });

  const responsesTranscript = buildProviderTranscript({
    targetProvider: 'openai-responses',
    context: { model: 'gpt-5', events: openAIResponsesConversation, ...baseContext },
  });

  const anthropicTranscript = buildProviderTranscript({
    targetProvider: 'anthropic-messages',
    context: { model: 'claude-3-5-sonnet-20241022', events: anthropicConversation, ...baseContext },
  });

  test('OpenAI Chat SDK generator emits usable snippet', () => {
    const result = generateOpenAIChatSdk(chatTranscript);
    expect(result.code).toContain('client.chat.completions.create');
  });

  test('OpenAI Chat HTTP generator emits fetch snippet', () => {
    const result = generateOpenAIChatHttp(chatTranscript);
    expect(result.code).toContain('fetch(endpoint');
  });

  test('OpenAI Responses SDK generator emits responses.create call', () => {
    const result = generateOpenAIResponsesSdk(responsesTranscript);
    expect(result.code).toContain('client.responses.create');
  });

  test('OpenAI Responses HTTP generator posts to responses endpoint', () => {
    const result = generateOpenAIResponsesHttp(responsesTranscript);
    expect(result.code).toContain('https://api.openai.com/v1/responses');
  });

  test('Anthropic SDK generator emits python messages call', () => {
    const result = generateAnthropicSdk(anthropicTranscript);
    expect(result.code).toContain('client.messages.create');
  });

  test('Anthropic HTTP generator posts to anthropic endpoint', () => {
    const result = generateAnthropicHttp(anthropicTranscript);
    expect(result.code).toContain('requests.post');
  });
});
