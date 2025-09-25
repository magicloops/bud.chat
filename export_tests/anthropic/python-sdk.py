import os
import anthropic

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

def run():
    # Step 1: Recreate assistant turn 15066fd6-6a59-496b-aa94-89de70dc1565
    response_1 = client.messages.create({
                "model": "claude-3-5-sonnet",
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
                "system": "You are a helpful, harmless, and honest AI assistant."
            })
    print("assistant 1:", response_1)

if __name__ == "__main__":
    run()
