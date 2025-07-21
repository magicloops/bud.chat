import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    const { prompt } = body;

    if (!prompt) {
      return new Response('Prompt is required', { status: 400 });
    }

    // Generate theme using o3
    const response = await openai.chat.completions.create({
      model: 'o3',
      messages: [
        {
          role: 'system',
          content: `Generate a complete UI theme based on the user's description. Return a JSON object with the following structure:
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
The theme should be cohesive and match the user's description.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 8000
    });

    const themeJson = response.choices[0]?.message?.content;
    if (!themeJson) {
      throw new Error('No theme generated');
    }

    const theme = JSON.parse(themeJson);
    
    // Validate the theme structure
    if (!theme.name || !theme.cssVariables) {
      throw new Error('Invalid theme structure');
    }

    return Response.json(theme);
  } catch (error) {
    console.error('Theme generation error:', error);
    return new Response('Failed to generate theme', { status: 500 });
  }
}
