type Brand<K, T> = K & { __brand: T };
export type ConversationId = Brand<string, 'ConversationId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type BudId = Brand<string, 'BudId'>;
export type UserId = Brand<string, 'UserId'>;
export type EventId = Brand<string, 'EventId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export function isConversationId(id: string): id is ConversationId { return typeof id === 'string' && id.length > 0; }
export function isWorkspaceId(id: string): id is WorkspaceId { return typeof id === 'string' && id.length > 0; }
export function isBudId(id: string): id is BudId { return typeof id === 'string' && id.length > 0; }
export function isUserId(id: string): id is UserId { return typeof id === 'string' && id.length > 0; }
export function isEventId(id: string): id is EventId { return typeof id === 'string' && id.length > 0; }
export function isToolCallId(id: string): id is ToolCallId { return typeof id === 'string' && id.startsWith('call_'); }
export function toConversationId(id: string): ConversationId { if (!isConversationId(id)) throw new Error(`Invalid conversation ID: ${id}`); return id as ConversationId; }
export function toWorkspaceId(id: string): WorkspaceId { if (!isWorkspaceId(id)) throw new Error(`Invalid workspace ID: ${id}`); return id as WorkspaceId; }
export function toBudId(id: string): BudId { if (!isBudId(id)) throw new Error(`Invalid bud ID: ${id}`); return id as BudId; }
export function toUserId(id: string): UserId { if (!isUserId(id)) throw new Error(`Invalid user ID: ${id}`); return id as UserId; }
export function toEventId(id: string): EventId { if (!isEventId(id)) throw new Error(`Invalid event ID: ${id}`); return id as EventId; }
export function toToolCallId(id: string): ToolCallId { if (!isToolCallId(id)) throw new Error(`Invalid tool call ID: ${id}`); return id as ToolCallId; }
export function toConversationIdOrNull(id: string | null | undefined): ConversationId | null { if (!id) return null; return isConversationId(id) ? (id as ConversationId) : null; }
export function toWorkspaceIdOrNull(id: string | null | undefined): WorkspaceId | null { if (!id) return null; return isWorkspaceId(id) ? (id as WorkspaceId) : null; }
export function toBudIdOrNull(id: string | null | undefined): BudId | null { if (!id) return null; return isBudId(id) ? (id as BudId) : null; }
export function generateConversationId(): ConversationId { return crypto.randomUUID() as ConversationId; }
export function generateWorkspaceId(): WorkspaceId { return crypto.randomUUID() as WorkspaceId; }
export function generateBudId(): BudId { return crypto.randomUUID() as BudId; }
export function generateEventId(): EventId { return crypto.randomUUID() as EventId; }
export function generateToolCallId(): ToolCallId { return `call_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}` as ToolCallId; }

