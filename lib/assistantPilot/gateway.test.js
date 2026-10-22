// The pilot's Anthropic provider sends Claude Haiku 5.5 requests with
// thinking turned off, so the output cap holds and nothing extra is billed.
const { anthropicProvider } = require("./gateway");

test("stream requests carry the model, the output cap and thinking off, and nothing else billable", async () => {
  const sent = [];
  const sdk = {
    messages: {
      stream(params) {
        sent.push(params);
        const events = [{ type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } }];
        return {
          async *[Symbol.asyncIterator]() {
            yield* events;
          },
          finalMessage: async () => ({ usage: { input_tokens: 10, output_tokens: 2 } })
        };
      }
    }
  };
  const provider = anthropicProvider({ sdk, model: "claude-haiku-5-5" });
  const out = await provider.stream({ system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 400, onText: () => {} });
  expect(out).toEqual({ text: "Hello", usage: { input_tokens: 10, output_tokens: 2 } });
  expect(sent[0]).toEqual({ model: "claude-haiku-5-5", thinking: { type: "disabled" }, max_tokens: 400, system: "s", messages: [{ role: "user", content: "hi" }] });
});
