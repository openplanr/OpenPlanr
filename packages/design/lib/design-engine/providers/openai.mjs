/**
 * OpenAI provider — Responses API carrying the image_generation tool.
 *
 *   generate : POST /v1/responses { model: <mainline>, tools: [{type: image_generation,
 *              model: <image model>, size, quality}], input: brief } → base64 PNG.
 *   iterate  : same call + previous_response_id from the session → the model
 *              REFINES the existing image rather than regenerating from scratch.
 *   check    : the mainline model's vision judges the PNG against its brief → { pass, issues }.
 *
 * Every call here is billed to the caller's OpenAI account, so the CLI reaches
 * this module only behind an explicit `--provider openai`.
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

/** Mainline model that carries the image_generation tool and answers the vision checks. */
export const DEFAULT_MODEL = 'gpt-5.5';
/** Image model selected through the tool's `model` field. */
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-sunburst';
export const DEFAULT_SIZE = '1024x1024';
export const DEFAULT_QUALITY = 'high';
export const IMAGE_QUALITIES = ['low', 'medium', 'high', 'auto', 'xhigh', 'max'];

const SIZE_STEP = 16;
const SIZE_MAX_EDGE = 3840;
const SIZE_MAX_ASPECT = 3;

/**
 * Accepts `auto` or WIDTHxHEIGHT in multiples of 16, aspect within 1:3..3:1, no edge over 3840.
 * Returns the size; throws with the accepted forms otherwise.
 */
export function assertImageSize(size) {
  if (size === 'auto') return size;
  const m = /^(\d+)x(\d+)$/.exec(String(size));
  const width = m ? Number(m[1]) : 0;
  const height = m ? Number(m[2]) : 0;
  const valid =
    width > 0 &&
    height > 0 &&
    width % SIZE_STEP === 0 &&
    height % SIZE_STEP === 0 &&
    width <= SIZE_MAX_EDGE &&
    height <= SIZE_MAX_EDGE &&
    width / height <= SIZE_MAX_ASPECT &&
    height / width <= SIZE_MAX_ASPECT;
  if (!valid) {
    throw new Error(
      `invalid image size "${size}": use auto, 1024x1024, 1024x1536, 1536x1024, or WIDTHxHEIGHT ` +
        `with multiples of ${SIZE_STEP}, an aspect between 1:3 and 3:1, and no edge over ${SIZE_MAX_EDGE}`,
    );
  }
  return size;
}

/** Returns the quality; throws naming the accepted values otherwise. */
export function assertImageQuality(quality) {
  if (!IMAGE_QUALITIES.includes(quality)) {
    throw new Error(`invalid image quality "${quality}": use one of ${IMAGE_QUALITIES.join(', ')}`);
  }
  return quality;
}

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
    model = DEFAULT_MODEL,
    imageModel = DEFAULT_IMAGE_MODEL,
    size = DEFAULT_SIZE,
    quality = DEFAULT_QUALITY,
    previousResponseId = null,
    imageInputPath = null, // evolve: variants FROM a screenshot ("I don't like THIS")
    fetchImpl = fetch,
    tmpDir = tmpdir(),
    readFile,
  } = opts;
  if (!apiKey)
    throw new Error('openai provider requires an API key (run setup, or use claude-svg)');
  assertImageSize(size);
  assertImageQuality(quality);

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
    model,
    tools: [{ type: 'image_generation', model: imageModel, size, quality }],
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
  const { apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, readFile } = opts;
  if (!apiKey)
    throw new Error(
      'extractAttributes (openai) requires an API key — pass attributes via flags instead',
    );
  const read = readFile ?? (await import('node:fs')).readFileSync;
  const b64 = Buffer.from(read(imagePath)).toString('base64');
  const response = await callResponses(
    {
      model,
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
    return {
      fonts: arr(out.fonts),
      colors: arr(out.colors),
      layouts: arr(out.layouts),
      aesthetics: arr(out.aesthetics),
    };
  } catch {
    return { fonts: [], colors: [], layouts: [], aesthetics: [] };
  }
}

/** Vision quality gate (hard rule 10): judge the PNG against its brief. */
export async function checkQuality(imagePath, brief, opts = {}) {
  const { apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, readFile } = opts;
  if (!apiKey) throw new Error('checkQuality (openai) requires an API key');
  const read = readFile ?? (await import('node:fs')).readFileSync;
  const b64 = Buffer.from(read(imagePath)).toString('base64');

  const response = await callResponses(
    {
      model,
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
    return {
      pass: Boolean(verdict.pass),
      issues: Array.isArray(verdict.issues) ? verdict.issues : [],
    };
  } catch {
    return { pass: false, issues: ['quality check verdict was not valid JSON'] };
  }
}
