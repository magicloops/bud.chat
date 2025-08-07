import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { ProviderFactory } from '@/lib/providers/unified/ProviderFactory';
import { AppError, handleApiError } from '@/lib/errors';
import { createTextEvent, Event } from '@/lib/types/events';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw AppError.unauthorized();
    }

    const body = await request.json();
    const { prompt } = body;

    if (!prompt) {
      throw AppError.validation('Prompt is required');
    }

    // Create events for theme generation
    const systemPrompt = `Generate a complete UI theme based on the user's description. Return a JSON object with the following structure:
{
  "name": "Theme Name",
  "description": "Brief description of the theme",
  "cssVariables": {
    "--background": "hsl value",
    "--foreground": "hsl value",
    "--card": "hsl value",
    "--card-foreground": "hsl value",
    "--popover": "hsl value",
    "--popover-foreground": "hsl value",
    "--primary": "hsl value",
    "--primary-foreground": "hsl value",
    "--secondary": "hsl value",
    "--secondary-foreground": "hsl value",
    "--muted": "hsl value",
    "--muted-foreground": "hsl value",
    "--accent": "hsl value",
    "--accent-foreground": "hsl value",
    "--destructive": "hsl value",
    "--destructive-foreground": "hsl value",
    "--border": "hsl value",
    "--input": "hsl value",
    "--ring": "hsl value",
    "--radius": "0.5rem"
  }
}

All color values should be in HSL format without the "hsl()" wrapper (e.g., "220 14% 93%" not "hsl(220, 14%, 93%)").
Ensure good contrast between foreground and background colors for accessibility.
The theme should be cohesive and match the user's description.`;

    const events: Event[] = [
      createTextEvent('system', systemPrompt),
      createTextEvent('user', prompt)
    ];

    // Use the provider factory to generate theme
    const provider = ProviderFactory.create('o3');
    const response = await provider.chat({
      events,
      model: 'o3',
      maxTokens: 8000
      // Note: responseFormat is not supported in UnifiedChatRequest
    });

    // Extract text content from the response event
    const responseEvent = response.event;
    const textSegments = responseEvent.segments.filter(s => s.type === 'text');
    const themeJson = textSegments.map(s => s.text).join('');
    if (!themeJson) {
      throw new Error('No theme generated');
    }

    const theme = JSON.parse(themeJson);
    
    // Validate the theme structure
    if (!theme.name || !theme.cssVariables) {
      throw new Error('Invalid theme structure');
    }

    return NextResponse.json(theme);
  } catch (error) {
    return handleApiError(error);
  }
}
