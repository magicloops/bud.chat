'use client';

import { useMemo, useState } from 'react';
import type { EventConversation } from '@/state/eventChatStore';
import { buildProviderTranscript } from '@/lib/exports/providerTranscripts/buildProviderTranscript';
import type { TargetProvider, TranscriptContext, ProviderTranscript, JsonValue } from '@/lib/exports';
import { listGenerators, runGenerator } from '@/lib/exports/generators';
import { CodeBlock } from '@/components/CodeBlock';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { eventsToOpenAIChatMessages, eventsToResponsesInputItems, eventsToAnthropicMessages } from '@budchat/events';
import { cn } from '@/lib/utils';

interface EventJsonModeProps {
  conversation: EventConversation;
  model: string;
  targetProvider: TargetProvider;
}

const formatJson = (value: JsonValue | null | undefined): string =>
  value === undefined ? 'null' : JSON.stringify(value, null, 2);

export function EventJsonMode({ conversation, model, targetProvider }: EventJsonModeProps) {
  const [isExportOpen, setExportOpen] = useState(false);

  const transcript = useMemo<ProviderTranscript>(() => {
    const context: TranscriptContext = {
      model,
      events: conversation.events,
      temperature: (conversation.meta.model_config_overrides as { temperature?: number } | undefined)?.temperature,
      maxTokens: (conversation.meta.model_config_overrides as { max_tokens?: number } | undefined)?.max_tokens,
      reasoningEffort: (conversation.meta.model_config_overrides as { reasoning_effort?: TranscriptContext['reasoningEffort'] } | undefined)?.reasoning_effort,
      mcpConfig: conversation.meta.mcp_config_overrides as TranscriptContext['mcpConfig'],
      builtInToolsConfig: conversation.meta.builtin_tools_config_overrides as TranscriptContext['builtInToolsConfig'],
    };

    return buildProviderTranscript({ targetProvider, context });
  }, [conversation.events, conversation.meta, model, targetProvider]);

  const availableGenerators = useMemo(
    () => listGenerators().filter((descriptor) => descriptor.targetProvider === targetProvider),
    [targetProvider],
  );

  const generatorResults = useMemo(
    () =>
      availableGenerators.map((descriptor) => ({
        descriptor,
        result: runGenerator(descriptor.id, transcript),
      })),
    [availableGenerators, transcript],
  );

  const providerPayload = useMemo<JsonValue>(() => {
    const mcpOverrides = conversation.meta.mcp_config_overrides as
      | { remote_servers?: Array<{ server_label: string }> }
      | undefined;
    switch (targetProvider) {
      case 'openai-chat':
        return {
          model,
          messages: eventsToOpenAIChatMessages(conversation.events),
        };
      case 'openai-responses':
        return {
          model,
          input: eventsToResponsesInputItems(conversation.events, {
            remoteServers: mcpOverrides?.remote_servers,
          }),
        };
      case 'anthropic-messages':
        return {
          model,
          messages: eventsToAnthropicMessages(conversation.events),
        };
      default:
        return conversation.events as unknown as JsonValue;
    }
  }, [conversation.events, conversation.meta.mcp_config_overrides, model, targetProvider]);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="flex justify-end">
        <Dialog open={isExportOpen} onOpenChange={setExportOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">Export Code</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Export Conversation</DialogTitle>
              <DialogDescription>Select a template to copy a ready-to-run snippet.</DialogDescription>
            </DialogHeader>
            {generatorResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">No export templates available for this provider.</p>
            ) : (
              <Tabs defaultValue={generatorResults[0]?.descriptor.id} className="mt-4">
                <TabsList className="flex-wrap">
                  {generatorResults.map(({ descriptor }) => (
                    <TabsTrigger key={descriptor.id} value={descriptor.id}>
                      {descriptor.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="mt-3 max-h-[420px] overflow-y-auto pr-1 space-y-4">
                  {generatorResults.map(({ descriptor, result }) => (
                    <TabsContent key={descriptor.id} value={descriptor.id} className="space-y-3">
                      <div className="w-full overflow-x-auto rounded-md border bg-muted/20">
                        <CodeBlock language={result.language} value={result.code} />
                      </div>
                    </TabsContent>
                  ))}
                </div>
            </Tabs>
          )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground break-all">Provider: {targetProvider}</div>
        <CodeBlock language="json" value={formatJson(providerPayload)} />
      </div>
    </div>
  );
}
