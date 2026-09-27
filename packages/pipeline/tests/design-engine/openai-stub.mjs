/**
 * Preload (`node --import`) for design-engine CLI tests: answers OpenAI image generation from
 * fixture PNGs and refuses every other non-loopback request, so no test reaches the network.
 *
 * `OPENPLANR_OPENAI_STUB_DIR` holds `images.json` (brief → PNG file name) and the PNGs; each
 * answered request is appended to `requests.jsonl` there, without its authorization header.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const directory = process.env.OPENPLANR_OPENAI_STUB_DIR;
if (!directory) {
  throw new Error('The OpenAI stub needs OPENPLANR_OPENAI_STUB_DIR, its fixture directory.');
}
const images = JSON.parse(readFileSync(join(directory, 'images.json'), 'utf8'));
const loopbackFetch = globalThis.fetch;

globalThis.fetch = async (resource, init = {}) => {
  const url = new URL(resource instanceof Request ? resource.url : String(resource));
  if (url.href === RESPONSES_URL) return answerImageGeneration(init);
  if (LOOPBACK_HOSTS.has(url.hostname)) return loopbackFetch(resource, init);
  throw new Error(`The OpenAI stub refused ${url.href}: tests may reach loopback hosts only.`);
};

function answerImageGeneration(init) {
  if (init.method !== 'POST') {
    throw new Error(`The OpenAI stub expects POST ${RESPONSES_URL}, not ${init.method ?? 'GET'}.`);
  }
  if (!/^Bearer \S+$/u.test(init.headers?.authorization ?? '')) {
    throw new Error(`The OpenAI stub expects a bearer authorization header on ${RESPONSES_URL}.`);
  }
  const body = JSON.parse(init.body);
  const [tool] = body.tools ?? [];
  if (tool?.type !== 'image_generation') {
    throw new Error(
      `The OpenAI stub answers image generation only; the request carried tools ${JSON.stringify(body.tools)}.`,
    );
  }
  const brief = typeof body.input === 'string' ? body.input : body.input?.[0]?.content?.[0]?.text;
  const file = images[brief];
  if (!file) {
    throw new Error(
      `The OpenAI stub has no image for the brief ${JSON.stringify(brief)}; images.json lists ${JSON.stringify(Object.keys(images))}.`,
    );
  }
  appendFileSync(
    join(directory, 'requests.jsonl'),
    `${JSON.stringify({
      model: body.model,
      tool,
      brief,
      previousResponseId: body.previous_response_id ?? null,
    })}\n`,
  );
  return Response.json({
    id: `resp_${file.replace(/\W/gu, '_')}`,
    output: [
      {
        type: 'image_generation_call',
        result: readFileSync(join(directory, file)).toString('base64'),
      },
    ],
  });
}
