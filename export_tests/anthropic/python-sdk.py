import os
import json
import anthropic

anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
client = anthropic.Anthropic(api_key=anthropic_api_key) if anthropic_api_key else anthropic.Anthropic()

def run():
    # Replay the recorded assistant turn
    response = client.messages.create(
        model="claude-3-7-sonnet-latest",
        messages=[
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
        system="You are a helpful, harmless, and honest AI assistant.",
        max_tokens=4096,
    )
    response_data = response.to_dict() if hasattr(response, 'to_dict') else response
    print(json.dumps(response_data, indent=2))

if __name__ == "__main__":
    run()
