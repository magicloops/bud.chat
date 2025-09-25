import { buildProviderTranscript } from '../providerTranscripts/buildProviderTranscript';
import { generateOpenAIChatSdk } from '../generators/openaiChatSdk';
import { generateOpenAIChatHttp } from '../generators/openaiChatHttp';
import { generateOpenAIResponsesSdk } from '../generators/openaiResponsesSdk';
import { generateOpenAIResponsesHttp } from '../generators/openaiResponsesHttp';
import { generateAnthropicSdk } from '../generators/anthropicSdk';
import { generateAnthropicSdkTs } from '../generators/anthropicSdkTs';
import { generateAnthropicHttp } from '../generators/anthropicHttp';
import { generateOpenAIPythonSdk } from '../generators/openaiSdkPy';
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

  const singleTurnChatTranscript = buildProviderTranscript({
    targetProvider: 'openai-chat',
    context: { model: 'gpt-4o', events: openAIChatConversation.slice(0, 3), ...baseContext },
  });

  const responsesTranscript = buildProviderTranscript({
    targetProvider: 'openai-responses',
    context: { model: 'gpt-5', events: openAIResponsesConversation, ...baseContext },
  });

  const singleTurnResponsesTranscript = buildProviderTranscript({
    targetProvider: 'openai-responses',
    context: { model: 'gpt-5', events: openAIResponsesConversation.slice(0, 3), ...baseContext },
  });

  const anthropicTranscript = buildProviderTranscript({
    targetProvider: 'anthropic-messages',
    context: { model: 'claude-3-5-sonnet-20241022', events: anthropicConversation, ...baseContext },
  });

  test('OpenAI Chat SDK generator emits usable snippet', () => {
    const result = generateOpenAIChatSdk(chatTranscript);
    expect(result.code).toContain('client.chat.completions.create');
    expect(result.code).toContain('JSON.stringify');
  });

  test('OpenAI Chat SDK single-turn output omits numbering', () => {
    const result = generateOpenAIChatSdk(singleTurnChatTranscript);
    expect(result.code).toContain('const response = await client.chat.completions.create');
    expect(result.code).toContain('console.log(JSON.stringify(response, null, 2));');
    expect(result.code).not.toContain('assistant 1');
    expect(result.code).not.toContain('response1');
  });

  test('OpenAI Chat HTTP generator emits fetch snippet', () => {
    const result = generateOpenAIChatHttp(chatTranscript);
    expect(result.code).toContain('fetch(endpoint');
    expect(result.code).toContain('JSON.stringify(json, null, 2)');
  });

  test('OpenAI Chat HTTP single-turn output omits numbering', () => {
    const result = generateOpenAIChatHttp(singleTurnChatTranscript);
    expect(result.code).toContain('const body =');
    expect(result.code).toContain('console.log(JSON.stringify(json, null, 2));');
    expect(result.code).not.toContain('assistant 1');
  });

  test('OpenAI Chat Python SDK generator emits create call', () => {
    const result = generateOpenAIPythonSdk(chatTranscript);
    expect(result.code).toContain('from openai import OpenAI');
    expect(result.code).toContain('client.chat.completions.create');
    expect(result.code).toContain('json.dumps(response_1.model_dump(), indent=2)');
  });

  test('OpenAI Chat Python SDK single-turn omits numbering', () => {
    const result = generateOpenAIPythonSdk(singleTurnChatTranscript);
    expect(result.code).toContain('response = client.chat.completions.create');
    expect(result.code).not.toContain('assistant 1');
    expect(result.code).not.toContain('response_1');
  });

  test('OpenAI Responses SDK generator emits responses.create call', () => {
    const result = generateOpenAIResponsesSdk(responsesTranscript);
    expect(result.code).toContain('client.responses.create');
    expect(result.code).toContain('JSON.stringify');
  });

  test('OpenAI Responses SDK single-turn output omits numbering', () => {
    const result = generateOpenAIResponsesSdk(singleTurnResponsesTranscript);
    expect(result.code).toContain('const response = await client.responses.create');
    expect(result.code).toContain('console.log(JSON.stringify(response, null, 2));');
    expect(result.code).not.toContain('assistant 1');
    expect(result.code).not.toContain('response1');
  });

  test('OpenAI Responses HTTP generator posts to responses endpoint', () => {
    const result = generateOpenAIResponsesHttp(responsesTranscript);
    expect(result.code).toContain('https://api.openai.com/v1/responses');
    expect(result.code).toContain('JSON.stringify(json, null, 2)');
  });

  test('OpenAI Responses HTTP single-turn output omits numbering', () => {
    const result = generateOpenAIResponsesHttp(singleTurnResponsesTranscript);
    expect(result.code).toContain('const body =');
    expect(result.code).toContain('console.log(JSON.stringify(json, null, 2));');
    expect(result.code).not.toContain('assistant 1');
  });

  test('OpenAI Responses Python SDK generator emits responses.create call', () => {
    const result = generateOpenAIPythonSdk(responsesTranscript);
    expect(result.code).toContain('client.responses.create');
    expect(result.code).toContain('json.dumps(response.model_dump(), indent=2)');
  });

  test('OpenAI Responses Python SDK single-turn omits numbering', () => {
    const result = generateOpenAIPythonSdk(singleTurnResponsesTranscript);
    expect(result.code).toContain('response = client.responses.create');
    expect(result.code).not.toContain('assistant 1');
    expect(result.code).not.toContain('response_1');
  });

  test('Anthropic SDK generator emits python messages call', () => {
    const result = generateAnthropicSdk(anthropicTranscript);
    expect(result.code).toContain('client.messages.create');
    expect(result.code).toContain('model=');
    expect(result.code).toContain('messages=');
    expect(result.code).toContain('max_tokens=');
  });

  test('Anthropic SDK generator simplifies single-turn export', () => {
    const singleTurnTranscript = buildProviderTranscript({
      targetProvider: 'anthropic-messages',
      context: {
        model: 'claude-3-5-sonnet-20241022',
        events: anthropicConversation.slice(0, 3),
        ...baseContext,
      },
    });

    const result = generateAnthropicSdk(singleTurnTranscript);
    expect(result.code).toContain('response = client.messages.create');
    expect(result.code).toContain('print(json.dumps(response_data, indent=2))');
    expect(result.code).not.toContain('Step 1');
    expect(result.code).not.toContain('assistant 1:');
  });

  test('Anthropic HTTP generator posts to anthropic endpoint', () => {
    const result = generateAnthropicHttp(anthropicTranscript);
    expect(result.code).toContain('requests.post');
    expect(result.code).toContain('body = {');
  });

  test('Anthropic TypeScript SDK generator emits messages.create call', () => {
    const result = generateAnthropicSdkTs(anthropicTranscript);
    expect(result.code).toContain("import Anthropic from '@anthropic-ai/sdk'");
    expect(result.code).toContain('client.messages.create');
    expect(result.code).toContain('JSON.stringify(response');
  });

  test('Anthropic TypeScript SDK single-turn output omits numbering', () => {
    const singleTurnTranscript = buildProviderTranscript({
      targetProvider: 'anthropic-messages',
      context: {
        model: 'claude-3-5-sonnet-20241022',
        events: anthropicConversation.slice(0, 3),
        ...baseContext,
      },
    });

    const result = generateAnthropicSdkTs(singleTurnTranscript);
    expect(result.code).toContain('const response = await client.messages.create');
    expect(result.code).toContain('console.log(JSON.stringify(response, null, 2));');
    expect(result.code).not.toContain('assistant 1');
    expect(result.code).not.toContain('response1');
  });
});
