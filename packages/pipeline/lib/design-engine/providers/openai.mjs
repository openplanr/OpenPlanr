/**
 * OpenAI provider — Responses API carrying the image_generation tool.
 *
 *   generate : POST /v1/responses { model: gpt-4o, tools: [{type: image_generation,
 *              model: gpt-image-2, size, quality}], input: brief } → base64 PNG.
 *   iterate  : same call + previous_response_id from the session → the model
 *              REFINES the existing image rather than regenerating from scratch.
 *   check    : gpt-4o vision judges the PNG against its brief → { pass, issues }.
 *
 * Hard rule 5: images are written to a tmp path first; the CALLER cp's to the
 * final dir. 429s surface as err.code='RATE_LIMITED' so the variant subagent
 * can do its ≤3 retries. `fetchImpl` is injectable — unit tests never touch
 * the network.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const API = 'https://api.openai.com/v1/responses';

function rateLimitError(detail) {
  const err = new Error(`OpenAI rate limit (429): ${detail}`);
  err.code = 'RATE_LIMITED';
  return err;
}

async function callResponses(body, { apiKey, fetchImpl = fetch }) {
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw rateLimitError(await res.text().catch(() => ''));
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`);
  }
  return res.json();
}

function extractImageBase64(response) {
  for (const item of response.output ?? []) {
    if (item.type === 'image_generation_call' && item.result) return item.result;
  }
  return null;
}

function extractText(response) {
  const parts = [];
  for (const item of response.output ?? []) {
    for (const c of item.content ?? []) {
      if (typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n');
}

/**
 * Generate one variant image. Returns a tmp path (caller cp's it) + the
 * response id to chain.
 */
export async function generateVariant(brief, opts = {}) {
  const {
    apiKey,
    size = '1024x1024',
    quality = 'high',
    previousResponseId = null,
    imageInputPath = null, // evolve: variants FROM a screenshot ("I don't like THIS")
    fetchImpl = fetch,
    tmpDir = tmpdir(),
    readFile,
  } = opts;
  if (!apiKey) throw new Error('openai provider requires an API key (run setup, or use claude-svg)');

  let input = brief;
  if (imageInputPath) {
    const read = readFile ?? (await import('node:fs')).readFileSync;
    const b64in = Buffer.from(read(imageInputPath)).toString('base64');
    input = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: brief },
          { type: 'input_image', image_url: `data:image/png;base64,${b64in}` },
        ],
      },
    ];
  }

  const body = {
    model: 'gpt-4o',
    tools: [{ type: 'image_generation', model: 'gpt-image-2', size, quality }],
    input,
  };
  if (previousResponseId) body.previous_response_id = previousResponseId;

  const response = await callResponses(body, { apiKey, fetchImpl });
  const b64 = extractImageBase64(response);
  if (!b64) throw new Error('OpenAI response contained no image_generation result');

  const imagePath = join(tmpDir, `planr-design-${randomBytes(6).toString('hex')}.png`);
  writeFileSync(imagePath, Buffer.from(b64, 'base64'));
  return { imagePath, responseId: response.id ?? null, bytes: Buffer.byteLength(b64, 'base64') };
}

/** Continue the SAME chain with feedback text — refine, don't regenerate. */
export async function iterate(session, feedbackText, opts = {}) {
  if (!session.lastResponseId) {
    throw new Error('iterate: session has no lastResponseId to chain (generate first)');
  }
  return generateVariant(feedbackText, { ...opts, previousResponseId: session.lastResponseId });
}

/** Vision attribute extraction for the taste profile (taste-update on a PNG). */
export async function extractAttributes(imagePath, opts = {}) {
  const { apiKey, fetchImpl = fetch, readFile } = opts;
  if (!apiKey) throw new Error('extractAttributes (openai) requires an API key — pass attributes via flags instead');
  const read = readFile ?? (await import('node:fs')).readFileSync;
  const b64 = Buffer.from(read(imagePath)).toString('base64');
  const response = await callResponses(
    {
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Extract the design attributes of this image. Reply ONLY JSON: ' +
                '{"fonts": ["family-or-style", …], "colors": ["named color", …], ' +
                '"layouts": ["layout pattern", …], "aesthetics": ["style word", …]} — ≤3 entries each.',
            },
            { type: 'input_image', image_url: `data:image/png;base64,${b64}` },
          ],
        },
      ],
    },
    { apiKey, fetchImpl },
  );
  const m = extractText(response).match(/\{[\s\S]*\}/);
  if (!m) return { fonts: [], colors: [], layouts: [], aesthetics: [] };
  try {
    const out = JSON.parse(m[0]);
    const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
    return { fonts: arr(out.fonts), colors: arr(out.colors), layouts: arr(out.layouts), aesthetics: arr(out.aesthetics) };
  } catch {
    return { fonts: [], colors: [], layouts: [], aesthetics: [] };
  }
}

/** Vision quality gate (hard rule 10): judge the PNG against its brief. */
export async function checkQuality(imagePath, brief, opts = {}) {
  const { apiKey, fetchImpl = fetch, readFile } = opts;
  if (!apiKey) throw new Error('checkQuality (openai) requires an API key');
  const read = readFile ?? (await import('node:fs')).readFileSync;
  const b64 = Buffer.from(read(imagePath)).toString('base64');

  const response = await callResponses(
    {
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'You are a strict design QA. Judge this image against the brief. ' +
                'Reply with ONLY JSON: {"pass": boolean, "issues": ["…"]} — issues empty when pass.\n' +
                `BRIEF:\n${brief}`,
            },
            { type: 'input_image', image_url: `data:image/png;base64,${b64}` },
          ],
        },
      ],
    },
    { apiKey, fetchImpl },
  );

  const text = extractText(response);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { pass: false, issues: ['quality check returned no parseable verdict'] };
  try {
    const verdict = JSON.parse(m[0]);
    return { pass: Boolean(verdict.pass), issues: Array.isArray(verdict.issues) ? verdict.issues : [] };
  } catch {
    return { pass: false, issues: ['quality check verdict was not valid JSON'] };
  }
}
