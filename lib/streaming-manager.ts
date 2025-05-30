// Direct DOM manipulation for streaming to avoid React re-renders
class StreamingManager {
  private streamingContainer: HTMLElement | null = null
  private streamingMessage: any = null
  private isStreaming = false
  
  getIsStreaming() {
    return this.isStreaming
  }
  
  initialize(containerId: string) {
    this.streamingContainer = document.getElementById(containerId)
    if (!this.streamingContainer) {
      console.warn('Streaming container not found:', containerId)
    }
  }
  
  startStreaming(message: any, assistantName: string) {
    this.streamingMessage = message
    this.isStreaming = true
    console.log('🎬 START STREAMING (DOM):', message.id)
    this.renderStreamingMessage(assistantName)
  }
  
  updateStreamingMessage(content: string, assistantName: string) {
    if (this.streamingMessage) {
      this.streamingMessage.content = content
      console.log('📝 UPDATE STREAMING (DOM):', content.length, 'chars')
      this.renderStreamingMessage(assistantName)
    }
  }
  
  completeStreaming(onComplete?: (finalMessage: any) => void) {
    console.log('✅ COMPLETE STREAMING (DOM):', !!this.streamingMessage)
    if (this.streamingMessage && onComplete) {
      onComplete(this.streamingMessage)
    }
    this.clearStreaming()
  }
  
  cancelStreaming() {
    console.log('❌ CANCEL STREAMING (DOM)')
    this.clearStreaming()
  }
  
  private clearStreaming() {
    this.streamingMessage = null
    this.isStreaming = false
    if (this.streamingContainer) {
      this.streamingContainer.innerHTML = ''
    }
  }
  
  private renderStreamingMessage(assistantName: string) {
    if (!this.streamingContainer || !this.streamingMessage) return
    
    const messageHtml = `
      <div class="mb-6 group">
        <div class="flex items-start gap-3">
          <div class="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-md border bg-muted text-sm font-medium">
            <svg class="h-5 w-5 text-green-500" fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24">
              <rect height="11" width="14" x="3" y="11" rx="2" ry="2"></rect>
              <circle cx="11" cy="11" r="4"></circle>
              <path d="m15 7-4 4 4 4m-6-8-4 4 4 4"></path>
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-medium">${assistantName}</span>
              ${this.streamingMessage.metadata?.model && this.streamingMessage.metadata.model !== 'greeting' ? 
                `<span class="text-xs text-muted-foreground/60">${this.streamingMessage.metadata.model}</span>` : ''
              }
              <span class="text-xs text-muted-foreground">
                · ${this.isStreaming ? 'typing...' : 'just now'}
              </span>
            </div>
            <div class="relative">
              <div class="prose prose-sm max-w-none dark:prose-invert">
                ${this.streamingMessage.content.replace(/\n/g, '<br>')}
              </div>
              ${this.isStreaming ? '<span class="animate-bounce animate-pulse text-muted-foreground/60 text-sm ml-1">|</span>' : ''}
            </div>
          </div>
          <div class="h-6 w-6 opacity-0"></div>
        </div>
      </div>
    `
    
    this.streamingContainer.innerHTML = messageHtml
  }
}

// Global instance
export const streamingManager = new StreamingManager()