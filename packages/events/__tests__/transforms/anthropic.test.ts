import { eventsToAnthropicMessages, anthropicResponseToEvent, eventToAnthropicContent, type AnthropicContentBlock } from '@budchat/events';
import { basicEventSequence } from '../../test-utils/basicEvents';

describe('anthropic transforms', () => {
  it('converts events to anthropic messages', () => {
    const messages = eventsToAnthropicMessages(basicEventSequence);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello!' }],
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there!' }],
    });
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_fixture_tool_1', name: 'fetchWeather' }],
    });
    expect(messages[3]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_fixture_tool_1' }],
    });
  });

  it('reconstructs events from anthropic response', () => {
    const response: { id: string; content: AnthropicContentBlock[] } = {
      id: 'resp',
      content: [
        { type: 'text', text: 'Hi there!' },
        { type: 'tool_use', id: 'call_fixture_tool_1', name: 'fetchWeather', input: { location: 'Berlin' } },
      ],
    };
    const event = anthropicResponseToEvent(response);
    expect(event.role).toBe('assistant');
    expect(event.segments).toEqual([
      { type: 'text', text: 'Hi there!' },
      {
        type: 'tool_call',
        id: 'call_fixture_tool_1',
        name: 'fetchWeather',
        args: { location: 'Berlin' },
      },
    ]);
  });

  it('serializes event segments back into anthropic content blocks', () => {
    const content = eventToAnthropicContent(basicEventSequence[3]);
    expect(content).toEqual([
      {
        type: 'tool_use',
        id: 'call_fixture_tool_1',
        name: 'fetchWeather',
        input: { location: 'San Francisco' },
      },
    ]);
  });
});
