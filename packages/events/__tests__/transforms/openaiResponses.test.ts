import { eventsToResponsesInputItems, responsesPayloadToEvent } from '@budchat/events';
import type { Event } from '@budchat/events';
import { basicEventSequence, reasoningEventSequence } from '../../test-utils/basicEvents';

describe('openaiResponses transforms', () => {
  it('converts events to responses input items including MCP calls', () => {
    const items = eventsToResponsesInputItems(basicEventSequence);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text: 'You are a helpful assistant.' }],
    });
    expect(items[1]).toMatchObject({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Hello!' }],
    });
    expect(items[2]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hi there!' }],
    });
    expect(items[3]).toMatchObject({
      type: 'mcp_call',
      name: 'fetchWeather',
      arguments: JSON.stringify({ location: 'San Francisco' }),
    });
    expect(items[4]).toMatchObject({
      type: 'mcp_call',
      output: JSON.stringify({ temperature: 68 }),
    });
  });

  it('reconstructs events from response payloads with reasoning', () => {
    const payload = {
      id: 'resp-1',
      output: [
        { type: 'text', content: 'Here is the summary.' },
        { type: 'mcp_call', id: 'mcp-1', name: 'fetchWeather', arguments: JSON.stringify({ location: 'Paris' }), server_label: 'weather' },
      ],
      reasoning_content: 'Thinking through the notes...',
    };
    const event = responsesPayloadToEvent(payload);
    expect(event.role).toBe('assistant');
    expect(event.segments).toEqual([
      {
        type: 'reasoning',
        id: 'resp-1',
        output_index: 0,
        sequence_number: 0,
        parts: [
          {
            summary_index: 0,
            type: 'summary_text',
            text: 'Thinking through the notes...',
            sequence_number: 0,
            is_complete: true,
            created_at: expect.any(Number),
          },
        ],
      },
      { type: 'text', text: 'Here is the summary.' },
      {
        type: 'tool_call',
        id: 'mcp-1',
        name: 'fetchWeather',
        args: { location: 'Paris' },
        server_label: 'weather',
      },
    ]);
  });
});
