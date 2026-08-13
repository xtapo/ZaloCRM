/**
 * Shared handler for OpenAI-compatible chat/completions API.
 * Works with: OpenAI, Qwen (dashscope compat mode), Kimi (Moonshot).
 */
export async function generateWithOpenaiCompat(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
  maxTokens = 600,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      throw new Error(`OpenAI-compat request failed with status ${status}`);
    }

    const rawText = await response.text();
    const cleanedText = rawText.replace(/data:\s*\[DONE\]\s*$/i, '').trim();

    let data;
    try {
      data = JSON.parse(cleanedText) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
    } catch (err) {
      throw new Error(`OpenAI-compat parse error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI-compat returned empty content');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
