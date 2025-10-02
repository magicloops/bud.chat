import os
import json
import requests

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

def run():
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("Set the ANTHROPIC_API_KEY environment variable before running this script.")

    headers = {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
    }

    # Replay the recorded assistant turn
    body = {
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
    response = requests.post(
        'https://api.anthropic.com/v1/messages',
        headers=headers,
        json=body,
    )
    response.raise_for_status()
    data = response.json()
    print(json.dumps(data, indent=2))

if __name__ == "__main__":
    run()
