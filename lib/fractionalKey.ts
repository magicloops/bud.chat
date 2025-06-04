import { generateKeyBetween } from 'fractional-indexing'

/**
 * Utility functions for generating fractional indexing keys
 * These ensure proper ordering of messages in conversations
 */

export function generateNextKey(lastKey?: string): string {
  return generateKeyBetween(lastKey || null, null)
}

export function generatePreviousKey(firstKey?: string): string {
  return generateKeyBetween(null, firstKey || null)
}

export function generateBetweenKey(prevKey?: string, nextKey?: string): string {
  return generateKeyBetween(prevKey || null, nextKey || null)
}

/**
 * Generate a new order key for a message being inserted at the end
 */
export function generateAppendKey(messages: Array<{ order_key: string }>): string {
  if (messages.length === 0) {
    return generateKeyAfter(undefined)
  }
  
  const lastMessage = messages[messages.length - 1]
  return generateKeyAfter(lastMessage.order_key)
}

/**
 * Generate a new order key for a message being inserted at the beginning
 */
export function generatePrependKey(messages: Array<{ order_key: string }>): string {
  if (messages.length === 0) {
    return generateKeyBefore(undefined)
  }
  
  const firstMessage = messages[0]
  return generateKeyBefore(firstMessage.order_key)
}

/**
 * Generate a new order key for a message being inserted between two existing messages
 */
export function generateInsertKey(
  messages: Array<{ order_key: string }>,
  insertIndex: number
): string {
  if (insertIndex === 0) {
    return generatePrependKey(messages)
  }
  
  if (insertIndex >= messages.length) {
    return generateAppendKey(messages)
  }
  
  const prevMessage = messages[insertIndex - 1]
  const nextMessage = messages[insertIndex]
  
  return generateKeyBetween(prevMessage.order_key, nextMessage.order_key)
}

/**
 * Sort messages by their order_key
 */
export function sortByOrderKey<T extends { order_key: string }>(messages: T[]): T[] {
  return [...messages].sort((a, b) => a.order_key.localeCompare(b.order_key))
}

/**
 * Generate a temporary ID for optimistic messages
 */
export function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Check if an ID is a temporary/optimistic ID
 */
export function isTempId(id: string): boolean {
  return id.startsWith('temp-')
}