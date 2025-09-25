import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

async function run() {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  };
  const endpoint = 'https://api.openai.com/v1/responses';

  // Replay the recorded assistant turn
  {
    const body =       {
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
          };
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }
    console.log(JSON.stringify(json, null, 2));
    // TODO: Stream handling required for Responses API.
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
