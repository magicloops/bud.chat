import { Event, Segment, eventsToOpenAIChatMessages, eventsToResponsesInputItems, eventsToAnthropicMessages, eventToAnthropicContent } from '@budchat/events';
import type {
  ProviderTranscript,
  BuildTranscriptOptions,
  TranscriptContext,
  ProviderCallStep,
  JsonValue,
} from '../types';

type ToolChoiceValue = 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };

const asJsonValue = (value: unknown): JsonValue => value as JsonValue;

export function buildProviderTranscript(options: BuildTranscriptOptions): ProviderTranscript {
  const { targetProvider, context } = options;

  switch (targetProvider) {
    case 'openai-chat':
      return buildOpenAIChatTranscript(context);
    case 'openai-responses':
      return buildOpenAIResponsesTranscript(context);
    case 'anthropic-messages':
      return buildAnthropicMessagesTranscript(context);
    default:
      return {
        provider: targetProvider,
        model: context.model,
        steps: [],
        warnings: [`Unsupported provider target: ${targetProvider}`],
      } as ProviderTranscript;
  }
}

interface AssistantTurn {
  assistantEvent: Event;
  history: Event[];
  trailingToolEvents: Event[];
}

function buildOpenAIChatTranscript(context: TranscriptContext): ProviderTranscript {
  const turns = collectAssistantTurns(context.events);
  const aggregatedWarnings: Set<string> = new Set();

  const toolDefinitionResult = deriveOpenAIFunctionTools(context);
  const steps: ProviderCallStep[] = turns.map((turn) => {
    const requestResult = buildOpenAIChatRequestPayload(turn, context, toolDefinitionResult.tools);
    const responseResult = buildOpenAIChatResponsePayload(turn, context);

    const stepWarnings = [
      ...toolDefinitionResult.warnings,
      ...requestResult.warnings,
      ...responseResult.warnings,
    ];
    stepWarnings.forEach((warning) => aggregatedWarnings.add(warning));

    return {
      assistantEventId: turn.assistantEvent.id,
      request: requestResult.request,
      response: responseResult.response,
      warnings: stepWarnings.length > 0 ? stepWarnings : undefined,
    };
  });

  return {
    provider: 'openai-chat',
    model: context.model,
    steps,
    warnings: aggregatedWarnings.size > 0 ? Array.from(aggregatedWarnings) : undefined,
  };
}

function buildOpenAIResponsesTranscript(context: TranscriptContext): ProviderTranscript {
  const turns = collectAssistantTurns(context.events);
  const aggregatedWarnings: Set<string> = new Set();
  const toolsResult = deriveOpenAIResponsesTools(context);

  const steps: ProviderCallStep[] = turns.map((turn) => {
    const requestResult = buildOpenAIResponsesRequestPayload(turn, context, toolsResult.tools);
    const responseResult = buildOpenAIResponsesResponsePayload(turn, context);

    const stepWarnings = [
      ...toolsResult.warnings,
      ...requestResult.warnings,
      ...responseResult.warnings,
    ];
    stepWarnings.forEach((warning) => aggregatedWarnings.add(warning));

    return {
      assistantEventId: turn.assistantEvent.id,
      request: requestResult.request,
      response: responseResult.response,
      streamPreview: responseResult.streamPreview,
      warnings: stepWarnings.length > 0 ? stepWarnings : undefined,
    };
  });

  return {
    provider: 'openai-responses',
    model: context.model,
    steps,
    warnings: aggregatedWarnings.size > 0 ? Array.from(aggregatedWarnings) : undefined,
  };
}

function buildOpenAIChatRequestPayload(
  turn: AssistantTurn,
  context: TranscriptContext,
  tools: JsonValue[] | undefined,
): { request: JsonValue; warnings: string[] } {
  const warnings: string[] = [];
  const messages = eventsToOpenAIChatMessages(turn.history);

  const payload: Record<string, JsonValue> = {
    model: context.model,
    messages: asJsonValue(messages),
  };

  if (typeof context.temperature === 'number') {
    payload.temperature = context.temperature;
  }

  if (typeof context.maxTokens === 'number') {
    payload.max_tokens = context.maxTokens;
  }

  if (tools && tools.length > 0) {
    payload.tools = asJsonValue(tools);
  }

  const toolChoice = context.mcpConfig?.tool_choice;
  if (toolChoice) {
    payload.tool_choice = serializeToolChoice(toolChoice);
  }

  return { request: payload, warnings };
}

function buildOpenAIChatResponsePayload(
  turn: AssistantTurn,
  context: TranscriptContext,
): { response: JsonValue; warnings: string[] } {
  const warnings: string[] = [];
  const textSegments = (turn.assistantEvent.segments || []).filter(
    (segment): segment is { type: 'text'; text: string } => segment.type === 'text',
  );
  const contentText = textSegments.map((segment) => segment.text).join('');

  const toolCallSegments = (turn.assistantEvent.segments || []).filter(
    (segment): segment is Extract<Segment, { type: 'tool_call' }> => segment.type === 'tool_call',
  );

  const reasoningSegmentsPresent = (turn.assistantEvent.segments || []).some(
    (segment) => segment.type === 'reasoning',
  );
  if (reasoningSegmentsPresent) {
    warnings.push('Reasoning segments omitted in Chat Completions payload.');
  }

  const toolCalls = toolCallSegments.map((segment) => ({
    id: String(segment.id),
    type: 'function',
    function: {
      name: segment.name,
      arguments: JSON.stringify(segment.args ?? {}),
    },
  }));

  const message: Record<string, JsonValue> = {
    role: 'assistant',
    content: contentText.length > 0 ? contentText : null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls as unknown as JsonValue;
  }

  const choice: Record<string, JsonValue> = {
    index: 0,
    message,
    finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  };

  const response: Record<string, JsonValue> = {
    id: turn.assistantEvent.response_metadata?.openai_response_id || turn.assistantEvent.id,
    object: 'chat.completion',
    created: Math.floor(turn.assistantEvent.ts / 1000),
    model: context.model,
    choices: [choice],
  };

  const toolMessages = buildOpenAIToolResultMessages(turn.trailingToolEvents);
  if (toolMessages.length > 0) {
    warnings.push('Tool results included under `tool_messages` for reference; Chat Completions responses omit them.');
    response.tool_messages = toolMessages as JsonValue;
  }

  const usage = buildOpenAIChatUsage(turn.assistantEvent);
  if (usage) {
    response.usage = usage;
  }

  return { response, warnings };
}

function buildOpenAIResponsesRequestPayload(
  turn: AssistantTurn,
  context: TranscriptContext,
  tools: JsonValue[] | undefined,
): { request: JsonValue; warnings: string[] } {
  const warnings: string[] = [];
  const inputItems = eventsToResponsesInputItems(turn.history, { remoteServers: context.mcpConfig?.remote_servers });

  const payload: Record<string, JsonValue> = {
    model: context.model,
    input: asJsonValue(inputItems),
    max_output_tokens: typeof context.maxTokens === 'number' ? context.maxTokens : 8000,
  };

  if (tools && tools.length > 0) {
    payload.tools = asJsonValue(tools);
  }

  const effort = selectReasoningEffort(context);
  payload.reasoning = asJsonValue({
    effort,
    summary: context.reasoningConfig?.summary || (context.model.startsWith('gpt-5') ? 'detailed' : 'auto'),
  });

  const verbosity = context.textGenerationConfig?.verbosity;
  if (verbosity) {
    payload.text = asJsonValue({ verbosity });
  }

  return { request: payload, warnings };
}

function buildOpenAIResponsesResponsePayload(
  turn: AssistantTurn,
  context: TranscriptContext,
): { response: JsonValue; streamPreview?: JsonValue[]; warnings: string[] } {
  const warnings: string[] = [];
  const outputItems: JsonValue[] = [];
  const streamPreview: JsonValue[] = [];

  const reasoningSegments = (turn.assistantEvent.segments || []).filter(
    (segment): segment is Extract<typeof segment, { type: 'reasoning' }> => segment.type === 'reasoning',
  );

  for (const segment of turn.assistantEvent.segments || []) {
    if (segment.type === 'text') {
      outputItems.push({ type: 'output_text', content: segment.text });
      streamPreview.push({ type: 'text_delta', text: segment.text });
    }
    if (segment.type === 'tool_call') {
      outputItems.push(asJsonValue({
        type: 'mcp_call',
        id: String(segment.id),
        name: segment.name,
        arguments: JSON.stringify(segment.args ?? {}),
        server_label: (segment as any).server_label || null,
      }));
    }
  }

  for (const toolEvent of turn.trailingToolEvents) {
    if (!toolEvent.segments) continue;
    for (const segment of toolEvent.segments) {
      if (segment.type !== 'tool_result') continue;
      outputItems.push(asJsonValue({
        type: 'mcp_call',
        id: String(segment.id),
        output: JSON.stringify(segment.output ?? {}),
        error: segment.error ?? undefined,
      }));
    }
  }

  if (outputItems.length === 0) {
    warnings.push('Assistant event contained no text or tool call segments.');
  }

  const reasoningSummary = reasoningSegments.flatMap((segment) => {
    const parts = (segment as any).parts as Array<{ summary_index: number; text: string }> | undefined;
    if (!parts) return [];
    return parts.map((part) => ({ type: 'summary_text', text: part.text }));
  });

  const response: Record<string, JsonValue> = {
    id: turn.assistantEvent.response_metadata?.openai_response_id || turn.assistantEvent.id,
    status: 'completed',
    model: context.model,
    output: asJsonValue(outputItems),
  };

  if (reasoningSummary.length > 0) {
    response.reasoning = asJsonValue({
      summary: reasoningSummary,
      effort: effortFromSegments(reasoningSegments, context),
      tokens: turn.assistantEvent.response_metadata?.usage?.reasoning_tokens ?? undefined,
    });
  }

  const usage = buildOpenAIResponsesUsage(turn.assistantEvent);
  if (usage) {
    response.usage = usage;
  }

  return {
    response,
    streamPreview: streamPreview.length > 0 ? streamPreview.map((entry) => asJsonValue(entry)) : undefined,
    warnings,
  };
}

function selectReasoningEffort(context: TranscriptContext): string {
  let effort = context.reasoningConfig?.effort || context.reasoningEffort || 'low';
  const hasBuiltInTools = !!(context.builtInToolsConfig?.enabled_tools && context.builtInToolsConfig.enabled_tools.length > 0);
  if (hasBuiltInTools && effort === 'minimal') {
    effort = 'low';
  }
  return effort;
}

function effortFromSegments(segments: Array<{ effort_level?: string | undefined }>, context: TranscriptContext): string {
  for (const segment of segments) {
    const effortLevel = (segment as any).effort_level as string | undefined;
    if (effortLevel) {
      return effortLevel;
    }
  }
  return selectReasoningEffort(context);
}

function buildOpenAIResponsesUsage(event: Event): JsonValue | undefined {
  const usage = event.response_metadata?.usage;
  if (!usage) return undefined;
  const payload: Record<string, JsonValue> = {};
  if (typeof usage.reasoning_tokens === 'number') payload.reasoning_tokens = usage.reasoning_tokens;
  if (typeof usage.completion_tokens === 'number') payload.completion_tokens = usage.completion_tokens;
  if (typeof usage.total_tokens === 'number') payload.total_tokens = usage.total_tokens;
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function deriveOpenAIFunctionTools(
  context: TranscriptContext,
): { tools?: JsonValue[]; warnings: string[] } {
  const warnings: string[] = [];
  const seenNames = new Map<string, JsonValue>();

  const collectFromEvents = (events: Event[]) => {
    for (const event of events) {
      if (!event.segments) continue;
      for (const segment of event.segments) {
        if (segment.type !== 'tool_call') continue;
        if (!segment.name) continue;

        if (!seenNames.has(segment.name)) {
          const schema = inferJsonSchema(segment.args ?? {});
          seenNames.set(segment.name, {
            type: 'function',
            function: {
              name: segment.name,
              description: 'Reconstructed tool definition. Verify parameters before use.',
              parameters: schema,
            },
          });
        }
      }
    }
  };

  collectFromEvents(context.events);

  if (seenNames.size === 0) {
    return { warnings };
  }

  const tools = Array.from(seenNames.values()).map((tool) => asJsonValue(tool));
  warnings.push('Tool schemas inferred from sample calls. Validate before production use.');
  return { tools, warnings };
}

function deriveOpenAIResponsesTools(
  context: TranscriptContext,
): { tools?: JsonValue[]; warnings: string[] } {
  const warnings: string[] = [];
  const tools: JsonValue[] = [];

  const remoteServers = context.mcpConfig?.remote_servers ?? [];
  for (const server of remoteServers) {
    const tool: Record<string, JsonValue> = {
      type: 'mcp',
      server_label: server.server_label,
      server_url: server.server_url,
      require_approval: serializeToolOutput(server.require_approval),
    };
    if (server.allowed_tools) {
      tool.allowed_tools = asJsonValue(server.allowed_tools);
    }
    if (server.headers) {
      tool.headers = serializeToolOutput(server.headers);
    }
    tools.push(asJsonValue(tool));
  }

  const builtIn = context.builtInToolsConfig?.enabled_tools ?? [];
  for (const toolType of builtIn) {
    const settings = context.builtInToolsConfig?.tool_settings?.[toolType] as Record<string, JsonValue> | undefined;
    if (toolType === 'web_search_preview') {
      tools.push(asJsonValue({
        type: 'web_search_preview',
        search_context_size: (settings?.search_context_size as string) || 'medium',
      }));
    } else if (toolType === 'code_interpreter') {
      tools.push(asJsonValue({
        type: 'code_interpreter',
        container: (settings?.container as string) || 'default',
      }));
    }
  }

  if (tools.length === 0) {
    return { warnings };
  }

  return { tools, warnings };
}

function deriveAnthropicToolDefinitions(
  context: TranscriptContext,
): { tools?: JsonValue[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Map<string, JsonValue>();

  for (const event of context.events) {
    for (const segment of event.segments || []) {
      if (segment.type !== 'tool_call' || !segment.name) continue;
      if (seen.has(segment.name)) continue;
      const schema = inferJsonSchema(segment.args ?? {});
      seen.set(segment.name, asJsonValue({
        name: segment.name,
        description: 'Reconstructed tool definition. Verify input_schema before reuse.',
        input_schema: schema,
      }));
    }
  }

  if (seen.size === 0) {
    return { warnings };
  }

  return { tools: Array.from(seen.values()), warnings };
}

function buildOpenAIChatUsage(event: Event): JsonValue | undefined {
  const usage = event.response_metadata?.usage;
  if (!usage) return undefined;

  const payload: Record<string, JsonValue> = {};
  if (typeof usage.completion_tokens === 'number') {
    payload.completion_tokens = usage.completion_tokens;
  }
  if (typeof (usage as { prompt_tokens?: number }).prompt_tokens === 'number') {
    payload.prompt_tokens = (usage as { prompt_tokens: number }).prompt_tokens;
  }
  if (typeof usage.total_tokens === 'number') {
    payload.total_tokens = usage.total_tokens;
  }
  if (Object.keys(payload).length === 0) return undefined;
  return payload;
}

function buildOpenAIToolResultMessages(toolEvents: Event[]): JsonValue[] {
  const messages: JsonValue[] = [];

  for (const toolEvent of toolEvents) {
    if (!toolEvent.segments) continue;
    for (const segment of toolEvent.segments) {
      if (segment.type !== 'tool_result') continue;
      messages.push({
        role: 'tool',
        tool_call_id: segment.id,
        content: serializeToolOutput(segment.output),
        error: segment.error ?? null,
      });
    }
  }

  return messages;
}

function serializeToolOutput(output: unknown): JsonValue {
  if (output === null || output === undefined) return null;
  if (typeof output === 'string' || typeof output === 'number' || typeof output === 'boolean') {
    return output;
  }
  if (Array.isArray(output)) {
    return output.map((item) => serializeToolOutput(item));
  }
  if (typeof output === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
      result[key] = serializeToolOutput(value);
    }
    return result;
  }
  return String(output);
}

function inferJsonSchema(value: unknown, depth = 0): JsonValue {
  if (depth > 5) {
    return { type: 'string' };
  }

  if (value === null) {
    return asJsonValue({ type: 'null' });
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return asJsonValue({ type: valueType });
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return asJsonValue({ type: 'array', items: {} });
    }
    const itemSchemas = value.map((item) => inferJsonSchema(item, depth + 1));
    const merged = mergeSchemas(itemSchemas);
    return asJsonValue({ type: 'array', items: merged });
  }

  if (typeof value === 'object') {
    const properties: Record<string, JsonValue> = {};
    const required: string[] = [];
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = inferJsonSchema(val, depth + 1);
      if (val !== undefined) {
        required.push(key);
      }
    }
    return asJsonValue({
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    });
  }

  return asJsonValue({ type: 'string' });
}

function mergeSchemas(schemas: JsonValue[]): JsonValue {
  if (schemas.length === 0) return asJsonValue({});
  if (schemas.length === 1) return schemas[0];

  const types = new Set<string>();
  for (const schema of schemas) {
    if (schema && typeof schema === 'object' && 'type' in schema) {
      const type = (schema as { type?: string | string[] }).type;
      if (Array.isArray(type)) {
        type.forEach((t) => types.add(String(t)));
      } else if (type) {
        types.add(String(type));
      }
    }
  }

  if (types.size === 1) {
    return schemas[0];
  }

  return asJsonValue({ anyOf: schemas });
}

function serializeToolChoice(choice?: ToolChoiceValue): JsonValue {
  if (!choice) return 'auto';
  if (choice === 'auto' || choice === 'none' || choice === 'required') {
    return choice;
  }
  if (typeof choice === 'object' && 'type' in choice) {
    return asJsonValue(choice);
  }
  return 'auto';
}

function serializeAnthropicToolChoice(choice?: ToolChoiceValue): JsonValue | undefined {
  if (!choice) return undefined;
  if (choice === 'auto') return asJsonValue({ type: 'auto' });
  if (choice === 'none') return asJsonValue({ type: 'none' });
  if (choice === 'required') return asJsonValue({ type: 'any' });
  if (typeof choice === 'object' && 'type' in choice) {
    return asJsonValue({ type: 'tool', name: (choice as any).function?.name });
  }
  return undefined;
}

function extractSystemPrompt(events: Event[]): string | undefined {
  const parts: string[] = [];
  for (const event of events) {
    if (event.role !== 'system') continue;
    for (const segment of event.segments || []) {
      if (segment.type === 'text' && segment.text) {
        parts.push(segment.text);
      }
    }
  }
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

function buildAnthropicMessagesTranscript(context: TranscriptContext): ProviderTranscript {
  const turns = collectAssistantTurns(context.events);
  const aggregatedWarnings: Set<string> = new Set();

  const steps: ProviderCallStep[] = turns.map((turn) => {
    const requestResult = buildAnthropicRequestPayload(turn, context);
    const responseResult = buildAnthropicResponsePayload(turn, context);
    const stepWarnings = [...requestResult.warnings, ...responseResult.warnings];
    stepWarnings.forEach((warning) => aggregatedWarnings.add(warning));
    return {
      assistantEventId: turn.assistantEvent.id,
      request: requestResult.request,
      response: responseResult.response,
      warnings: stepWarnings.length > 0 ? stepWarnings : undefined,
    };
  });

  return {
    provider: 'anthropic-messages',
    model: context.model,
    steps,
    warnings: aggregatedWarnings.size > 0 ? Array.from(aggregatedWarnings) : undefined,
  };
}

function buildAnthropicRequestPayload(
  turn: AssistantTurn,
  context: TranscriptContext,
): { request: JsonValue; warnings: string[] } {
  const warnings: string[] = [];
  const messages = eventsToAnthropicMessages(turn.history);

  const payload: Record<string, JsonValue> = {
    model: context.model,
    messages: messages as unknown as JsonValue,
  };

  const systemPrompt = extractSystemPrompt(turn.history);
  if (systemPrompt) {
    payload.system = systemPrompt;
  }

  if (typeof context.temperature === 'number') {
    payload.temperature = context.temperature;
  }
  if (typeof context.maxTokens === 'number') {
    payload.max_tokens = context.maxTokens;
  }

  const toolDefs = deriveAnthropicToolDefinitions(context);
  if (toolDefs.tools && toolDefs.tools.length > 0) {
    payload.tools = toolDefs.tools as JsonValue;
  }
  toolDefs.warnings.forEach((warning) => warnings.push(warning));

  const toolChoiceSetting = context.mcpConfig?.tool_choice;
  const serializedChoice = serializeAnthropicToolChoice(toolChoiceSetting);
  if (serializedChoice) {
    payload.tool_choice = serializedChoice;
  }

  return { request: payload, warnings };
}

function buildAnthropicResponsePayload(
  turn: AssistantTurn,
  _context: TranscriptContext,
): { response: JsonValue; warnings: string[] } {
  const warnings: string[] = [];
  const contentBlocks = eventToAnthropicContent(turn.assistantEvent);

  const response: Record<string, JsonValue> = {
    id: turn.assistantEvent.id,
    role: 'assistant',
    type: 'message',
    content: asJsonValue(contentBlocks),
  };

  const toolResults = turn.trailingToolEvents.flatMap((toolEvent) => {
    const outputs: JsonValue[] = [];
    for (const segment of toolEvent.segments || []) {
      if (segment.type === 'tool_result') {
        outputs.push({
          type: 'tool_result',
          tool_use_id: String(segment.id),
          content: JSON.stringify(serializeToolOutput(segment.output)),
          error: segment.error ?? null,
        });
      }
    }
    return outputs;
  });

  if (toolResults.length > 0) {
    response.tool_results = asJsonValue(toolResults);
  }

  return { response, warnings };
}

function collectAssistantTurns(events: Event[]): AssistantTurn[] {
  const turns: AssistantTurn[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.role !== 'assistant') continue;

    const history = events.slice(0, index);
    const trailingToolEvents: Event[] = [];

    let lookahead = index + 1;
    while (lookahead < events.length && events[lookahead].role === 'tool') {
      trailingToolEvents.push(events[lookahead]);
      lookahead += 1;
    }

    turns.push({ assistantEvent: event, history, trailingToolEvents });
  }

  return turns;
}
