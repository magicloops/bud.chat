import { Event, ToolCallId, EventId, toEventId, toToolCallId } from '@budchat/events';

const toolCallId: ToolCallId = toToolCallId('call_fixture_tool_1');

const eventId = (value: string): EventId => toEventId(value);

export const basicEventSequence: Event[] = [
  {
    id: eventId('evt_sys_1'),
    role: 'system',
    ts: 1,
    segments: [
      { type: 'text', text: 'You are a helpful assistant.' },
    ],
  },
  {
    id: eventId('evt_user_1'),
    role: 'user',
    ts: 2,
    segments: [
      { type: 'text', text: 'Hello!' },
    ],
  },
  {
    id: eventId('evt_assistant_1'),
    role: 'assistant',
    ts: 3,
    segments: [
      { type: 'text', text: 'Hi there!' },
    ],
  },
  {
    id: eventId('evt_assistant_tool_call'),
    role: 'assistant',
    ts: 4,
    segments: [
      { type: 'tool_call', id: toolCallId, name: 'fetchWeather', args: { location: 'San Francisco' } },
    ],
  },
  {
    id: eventId('evt_tool_result_1'),
    role: 'tool',
    ts: 5,
    segments: [
      { type: 'tool_result', id: toolCallId, output: { temperature: 68 } },
    ],
  },
];

export const reasoningEventSequence: Event[] = [
  {
    id: eventId('evt_reasoning_system'),
    role: 'system',
    ts: 1,
    segments: [{ type: 'text', text: 'Reason carefully.' }],
  },
  {
    id: eventId('evt_reasoning_user'),
    role: 'user',
    ts: 2,
    segments: [{ type: 'text', text: 'Summarize the meeting notes.' }],
  },
  {
    id: eventId('evt_reasoning_assistant'),
    role: 'assistant',
    ts: 3,
    segments: [
      {
        type: 'reasoning',
        id: 'reasoning-1',
        output_index: 0,
        sequence_number: 0,
        parts: [
          {
            summary_index: 0,
            type: 'summary_text',
            text: 'Thinking through the notes...',
            sequence_number: 0,
            is_complete: true,
            created_at: Date.now(),
          },
        ],
        effort_level: 'medium',
      },
      { type: 'text', text: 'Here is the summary.' },
    ],
  },
];
