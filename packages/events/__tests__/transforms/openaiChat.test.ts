import { eventsToOpenAIChatMessages, openAIChatMessageToEvent } from '@budchat/events';
import type { Event } from '@budchat/events';
import { basicEventSequence } from '../../test-utils/basicEvents';

describe('openaiChat transforms', () => {
  it('converts events to chat messages with tool calls and results', () => {
    const messages = eventsToOpenAIChatMessages(basicEventSequence);
    expect(messages).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_fixture_tool_1',
            type: 'function',
            function: {
              name: 'fetchWeather',
              arguments: JSON.stringify({ location: 'San Francisco' }),
            },
          },
        ],
      },
      {
        role: 'tool',
        content: JSON.stringify({ temperature: 68 }),
        tool_call_id: 'call_fixture_tool_1',
      },
    ]);
  });

  it('reconstructs events from assistant tool call messages', () => {
    const messages = eventsToOpenAIChatMessages(basicEventSequence);
    const toolCallMessage = messages[3];
    const event = openAIChatMessageToEvent(toolCallMessage as any);
    expect(event.role).toBe('assistant');
    expect(event.segments).toEqual([
      {
        type: 'tool_call',
        id: 'call_fixture_tool_1',
        name: 'fetchWeather',
        args: { location: 'San Francisco' },
      },
    ]);
  });

  it('reconstructs tool results from tool role messages', () => {
    const messages = eventsToOpenAIChatMessages(basicEventSequence);
    const toolResultMessage = messages[4];
    const event = openAIChatMessageToEvent(toolResultMessage as any);
    expect(event.role).toBe('tool');
    expect(event.segments).toEqual([
      {
        type: 'tool_result',
        id: 'call_fixture_tool_1',
        output: { temperature: 68 },
      },
    ]);
  });
});
