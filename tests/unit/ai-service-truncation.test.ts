/**
 * Tests for AI service truncation detection and token budget handling.
 *
 * Verifies that:
 * - Truncated responses are detected and throw immediately (no retry)
 * - Error messages contain per-attempt token counts (not cumulative)
 * - Retry truncation is also caught
 * - Non-truncated failures still retry normally
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AIProvider, AIUsage } from '../../src/ai/types.js';
import { generateJSON, generateStreamingJSON } from '../../src/services/ai-service.js';

const { createSpinnerMock } = vi.hoisted(() => ({
  createSpinnerMock: vi.fn(() => ({
    stop: vi.fn(),
    succeed: vi.fn(),
    update: vi.fn(),
  })),
}));

// Mock logger to prevent spinner output in tests
vi.mock('../../src/utils/logger.js', () => ({
  createSpinner: createSpinnerMock,
  formatUsage: () => '',
}));

const testSchema = z.object({
  title: z.string(),
  items: z.array(z.string()),
});

function createMockProvider(overrides: {
  chatSyncResponses?: string[];
  chatStreamResponses?: string[];
  usages?: (AIUsage | undefined)[];
}): AIProvider {
  let callIndex = 0;
  const chatSyncResponses = overrides.chatSyncResponses ?? [];
  const chatStreamResponses = overrides.chatStreamResponses ?? chatSyncResponses;
  const usages = overrides.usages ?? [];

  return {
    name: 'anthropic',
    model: 'test-model',
    chatSync: vi.fn(async () => {
      const response = chatSyncResponses[callIndex] ?? '';
      callIndex++;
      return response;
    }),
    chat: vi.fn(async function* () {
      const response = chatStreamResponses[0] ?? '';
      // callIndex is advanced by getLastUsage, keep it at 0 for streaming
      yield response;
    }),
    getLastUsage: vi.fn(() => {
      return usages[callIndex - 1] ?? usages[0];
    }),
  };
}

describe('generateJSON truncation detection', () => {
  it('does not create terminal progress output in quiet mode', async () => {
    createSpinnerMock.mockClear();
    const provider = createMockProvider({
      chatSyncResponses: ['{"title": "Quiet", "items": []}'],
      usages: [{ inputTokens: 10, outputTokens: 10, truncated: false }],
    });

    const result = await generateJSON(provider, [], testSchema, { quiet: true });

    expect(result.result).toEqual({ title: 'Quiet', items: [] });
    expect(createSpinnerMock).not.toHaveBeenCalled();
  });

  it('throws immediately on truncated first response (no retry)', async () => {
    const provider = createMockProvider({
      chatSyncResponses: ['{"title": "incomplete...'],
      usages: [{ inputTokens: 5000, outputTokens: 4096, truncated: true }],
    });

    await expect(generateJSON(provider, [], testSchema, { maxTokens: 4096 })).rejects.toThrow(
      /truncated at 4,096 output tokens/,
    );

    // chatSync should only be called once — no retry
    expect(provider.chatSync).toHaveBeenCalledTimes(1);
  });

  it('includes configured maxTokens in truncation error', async () => {
    const provider = createMockProvider({
      chatSyncResponses: ['{"truncated...'],
      usages: [{ inputTokens: 3000, outputTokens: 8192, truncated: true }],
    });

    await expect(generateJSON(provider, [], testSchema, { maxTokens: 8192 })).rejects.toThrow(
      /max_tokens limit of 8,192/,
    );
  });

  it('catches truncation on retry attempt', async () => {
    const validButWrongJson = '{"wrong": "schema"}';
    const provider = createMockProvider({
      chatSyncResponses: [validButWrongJson, '{"truncated on retry...'],
      usages: [
        { inputTokens: 3000, outputTokens: 2000, truncated: false },
        { inputTokens: 5000, outputTokens: 4096, truncated: true },
      ],
    });

    // Adjust getLastUsage to track call index properly
    let usageIndex = 0;
    const usages = [
      { inputTokens: 3000, outputTokens: 2000, truncated: false },
      { inputTokens: 5000, outputTokens: 4096, truncated: true },
    ];
    provider.getLastUsage = vi.fn(() => usages[usageIndex++]);

    await expect(generateJSON(provider, [], testSchema, { maxTokens: 4096 })).rejects.toThrow(
      /retry response was truncated at 4,096/,
    );

    // Both attempts should be called (first + retry)
    expect(provider.chatSync).toHaveBeenCalledTimes(2);
  });

  it('retries normally on non-truncated validation failure', async () => {
    const badJson = '{"wrong": "schema"}';
    const goodJson = '{"title": "Test", "items": ["a", "b"]}';
    let usageIndex = 0;
    const usages = [
      { inputTokens: 3000, outputTokens: 500, truncated: false },
      { inputTokens: 4000, outputTokens: 600, truncated: false },
    ];

    const provider = createMockProvider({
      chatSyncResponses: [badJson, goodJson],
      usages,
    });
    provider.getLastUsage = vi.fn(() => usages[usageIndex++]);

    const result = await generateJSON(provider, [], testSchema, { maxTokens: 4096 });
    expect(result.result).toEqual({ title: 'Test', items: ['a', 'b'] });
    expect(provider.chatSync).toHaveBeenCalledTimes(2);
  });
});

describe('generateStreamingJSON truncation detection', () => {
  it('throws immediately on truncated streaming response (no retry)', async () => {
    let usageCalled = false;
    const provider: AIProvider = {
      name: 'anthropic',
      model: 'test',
      chatSync: vi.fn(),
      chat: vi.fn(async function* () {
        yield '{"title": "incomplete...';
      }),
      getLastUsage: vi.fn(() => {
        usageCalled = true;
        return { inputTokens: 10000, outputTokens: 16384, truncated: true };
      }),
    };

    await expect(
      generateStreamingJSON(provider, [], testSchema, { maxTokens: 16384 }),
    ).rejects.toThrow(/truncated at 16,384 output tokens/);

    // chatSync (retry) should NOT be called
    expect(provider.chatSync).not.toHaveBeenCalled();
    expect(usageCalled).toBe(true);
  });

  it('succeeds on non-truncated valid streaming response', async () => {
    const validJson = '{"title": "Streamed", "items": ["x"]}';
    const provider: AIProvider = {
      name: 'anthropic',
      model: 'test',
      chatSync: vi.fn(),
      chat: vi.fn(async function* () {
        yield validJson;
      }),
      getLastUsage: vi.fn(() => ({
        inputTokens: 2000,
        outputTokens: 500,
        truncated: false,
      })),
    };

    const result = await generateStreamingJSON(provider, [], testSchema, { maxTokens: 8192 });
    expect(result.result).toEqual({ title: 'Streamed', items: ['x'] });
  });
});

describe('truncation error message quality', () => {
  it('reports per-attempt tokens, not cumulative', async () => {
    // First attempt: 2000 output tokens (not truncated, but bad schema)
    // Retry: 4096 output tokens (truncated)
    let usageIndex = 0;
    const usages = [
      { inputTokens: 3000, outputTokens: 2000, truncated: false },
      { inputTokens: 5000, outputTokens: 4096, truncated: true },
    ];

    const provider: AIProvider = {
      name: 'anthropic',
      model: 'test',
      chatSync: vi
        .fn()
        .mockResolvedValueOnce('{"bad": "schema"}')
        .mockResolvedValueOnce('{"truncated...'),
      chat: vi.fn(),
      getLastUsage: vi.fn(() => usages[usageIndex++]),
    };

    try {
      await generateJSON(provider, [], testSchema, { maxTokens: 4096 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      // Should report 4,096 (retry attempt), NOT 6,096 (cumulative)
      expect(message).toContain('4,096 output tokens');
      expect(message).not.toContain('6,096');
    }
  });

  it('uses generic hint, not task-specific', async () => {
    const provider = createMockProvider({
      chatSyncResponses: ['truncated...'],
      usages: [{ inputTokens: 1000, outputTokens: 4096, truncated: true }],
    });

    try {
      await generateJSON(provider, [], testSchema, { maxTokens: 4096 });
      expect.unreachable('Should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      // Generic hint, not "--story instead of --feature"
      expect(message).toContain('reducing the input scope');
      expect(message).not.toContain('--story');
    }
  });
});
