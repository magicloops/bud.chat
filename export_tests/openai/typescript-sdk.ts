import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

async function run() {
  // Replay the recorded assistant turn
  {
    const response = await client.responses.create(
          {
            "model": "gpt-5",
            "input": [
              {
                "id": "msg_0",
                "type": "message",
                "role": "system",
                "content": [
                  {
                    "type": "input_text",
                    "text": "You are a helpful, harmless, and honest AI assistant. Respond in markdown."
                  }
                ]
              },
              {
                "id": "msg_1",
                "type": "message",
                "role": "user",
                "content": [
                  {
                    "type": "input_text",
                    "text": "test"
                  }
                ]
              },
              {
                "id": "rs_68d377732b98819082fe9b3cdae34347",
                "type": "reasoning",
                "summary": [
                  {
                    "type": "summary_text",
                    "text": ""
                  }
                ]
              },
              {
                "id": "msg_68d377735b8881908c0fc30fa9d49706",
                "type": "message",
                "role": "assistant",
                "content": [
                  {
                    "type": "output_text",
                    "text": "Hi! I’m here and working. How can I help you today?"
                  }
                ]
              }
            ],
            "max_output_tokens": 8000,
            "reasoning": {
              "effort": "low",
              "summary": "detailed"
            }
          }
    );
    console.log(JSON.stringify(response, null, 2));
    // For streaming responses, consider using client.responses.stream(...)
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
