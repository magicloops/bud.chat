import os
import json
from openai import OpenAI

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

def run():
    # Replay the recorded assistant turn
    payload = {
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
                "id": "rs_68d39a4339448190a582291f687b00ea",
                "type": "reasoning",
                "summary": [
                    {
                        "type": "summary_text",
                        "text": ""
                    }
                ]
            },
            {
                "id": "msg_68d39a4358588190adda53c94e3054f5",
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
    response = client.responses.create(**payload)
    print(json.dumps(response.model_dump(), indent=2))

if __name__ == "__main__":
    run()
