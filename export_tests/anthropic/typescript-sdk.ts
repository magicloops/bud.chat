import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function run() {
  // Replay the recorded assistant turn
  {
    const response = await client.messages.create(
          {
            "model": "claude-3-7-sonnet-latest",
            "messages": [
              {
                "role": "user",
                "content": [
                  {
                    "type": "text",
                    "text": "test"
                  }
                ]
              }
            ],
            "system": "You are a helpful, harmless, and honest AI assistant.",
            "max_tokens": 4096
          }
    );
    console.log(JSON.stringify(response, null, 2));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
