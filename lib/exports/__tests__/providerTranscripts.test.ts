import { buildProviderTranscript } from '../providerTranscripts/buildProviderTranscript';
import { openAIChatConversation, openAIResponsesConversation, anthropicConversation } from '../test-utils/conversations';
import type { TranscriptContext } from '../types';

describe('buildProviderTranscript', () => {
  const baseContext: Omit<TranscriptContext, 'events' | 'model'> = {
    temperature: 0.2,
    maxTokens: 200,
  };

  it('builds OpenAI Chat transcript using shared transforms', () => {
    const transcript = buildProviderTranscript({
      targetProvider: 'openai-chat',
      context: {
        model: 'gpt-4o',
        events: openAIChatConversation,
        ...baseContext,
      },
    });

    expect(transcript.provider).toBe('openai-chat');
    expect(transcript.steps).toHaveLength(2);
    const firstStep = transcript.steps[0];
    expect(firstStep.request).toMatchObject({ model: 'gpt-4o' });
    expect(firstStep.response).toMatchObject({ object: 'chat.completion' });
  });

  it('builds OpenAI Responses transcript including reasoning info', () => {
    const transcript = buildProviderTranscript({
      targetProvider: 'openai-responses',
      context: {
        model: 'gpt-5',
        events: openAIResponsesConversation,
        reasoningEffort: 'medium',
        ...baseContext,
      },
    });

    expect(transcript.provider).toBe('openai-responses');
    expect(transcript.steps.length).toBeGreaterThan(0);
    const step = transcript.steps[0];
    expect(step.request).toMatchObject({
      model: 'gpt-5',
      reasoning: expect.anything(),
    });
    expect(step.response).toMatchObject({ model: 'gpt-5' });
  });

  it('builds Anthropic transcript using shared transforms', () => {
    const transcript = buildProviderTranscript({
      targetProvider: 'anthropic-messages',
      context: {
        model: 'claude-3-5-sonnet-20241022',
        events: anthropicConversation,
        ...baseContext,
      },
    });

    expect(transcript.provider).toBe('anthropic-messages');
    expect(transcript.steps.length).toBeGreaterThan(0);
    const step = transcript.steps[0];
    expect(step.request).toMatchObject({ model: 'claude-3-5-sonnet-20241022' });
    expect(step.response).toMatchObject({ role: 'assistant', type: 'message' });
  });
});
