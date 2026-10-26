/**
 * The slice of the Anthropic TypeScript SDK (`@anthropic-ai/sdk`) the Edge
 * Functions use. Production passes `new Anthropic({ apiKey }).messages`
 * (imported in Deno as `npm:@anthropic-ai/sdk@1.3.0`); tests pass a fake.
 * Shapes follow the Messages API: structured JSON via `output_config.format`.
 */

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicMessageLike {
  stop_reason: string | null;
  content: readonly ({ type: string } & Partial<AnthropicTextBlock>)[];
}

export interface AnthropicCreateBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  thinking?: { type: 'disabled' } | { type: 'adaptive' };
  output_config?: {
    effort?: 'low' | 'medium' | 'high';
    format?: { type: 'json_schema'; schema: Record<string, unknown> };
  };
}

export interface AnthropicMessagesLike {
  create(body: AnthropicCreateBody, options?: { signal?: AbortSignal; timeout?: number; maxRetries?: number }): Promise<AnthropicMessageLike>;
}

/** Model used for chat classification and slang-aware translation fallback (ADR 0005). */
export const CLAUDE_MODEL = 'claude-haiku-5-5';

/** Returns the concatenated text blocks, or throws on refusal / truncation. */
export function textOf(msg: AnthropicMessageLike): string {
  if (msg.stop_reason === 'refusal') throw new Error('model refused');
  if (msg.stop_reason === 'max_tokens') throw new Error('model output truncated');
  return msg.content
    .filter((b): b is AnthropicTextBlock => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}
