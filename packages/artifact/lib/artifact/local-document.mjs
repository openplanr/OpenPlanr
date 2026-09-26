/** Offline, uncompiled HTML/CSS/JavaScript packaging for portable design skills. */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { parse, parseFragment, serialize } from 'parse5';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};
const children = (node) => [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])];
const attr = (node, name) => node.attrs?.find((item) => item.name === name);
const text = (node) =>
  children(node)
    .map((item) => item.value ?? '')
    .join('');
function setText(node, value) {
  node.childNodes = [{ nodeName: '#text', value, parentNode: node }];
}
function element(name, value) {
  const node = parseFragment(`<${name}></${name}>`).childNodes[0];
  setText(node, value);
  return node;
}

export function resolveLocalDocumentFile(root, path, from = root) {
  if (typeof path !== 'string' || !path || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/iu.test(path))
    throw new Error(`Expected a local relative asset: ${path}`);
  const candidate = resolve(from, path);
  const inside = (file) => {
    const r = relative(root, file);
    return (
      r !== '..' &&
      !r.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      !isAbsolute(r)
    );
  };
  if (!inside(candidate)) throw new Error(`Asset escapes design root: ${path}`);
  const actual = realpathSync(candidate);
  if (!inside(actual) || !statSync(actual).isFile())
    throw new Error(`Asset is not a contained regular file: ${path}`);
  return actual;
}

/** No network, package resolution, transpiler, native binary, or code execution. */
export function bundleLocalDocument({
  root: inputRoot,
  source,
  sharedStyles = [],
  screenId,
  maxBytes = 10 * 1024 * 1024,
  readSource,
  passive = false,
}) {
  const root = realpathSync(inputRoot);
  const files = new Map();
  const mediaStack = new Set();
  let svgDepth = 0;
  let cssExpansionBytes = 0;
  let cssExpansions = 0;
  let bytes = 0;
  function read(path, from = root) {
    // Company publication supplies a bounded reader that rejects unsafe paths
    // before resolving or reading them. Existing local/share callers are unchanged.
    const checked = readSource?.(path, from);
    const file = checked?.file ?? resolveLocalDocumentFile(root, path, from);
    if (!files.has(file)) {
      const value = checked?.value ?? readFileSync(file);
      bytes += value.length;
      if (bytes > maxBytes || files.size >= 1000)
        throw new Error('Design source exceeds the local asset budget.');
      files.set(file, value);
    }
    return { file, value: files.get(file) };
  }
  function asset(ref, from) {
    if (/^#/iu.test(ref)) return ref;
    if (/^data:/iu.test(ref)) {
      if (!passive) return ref;
      const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/iu.exec(ref);
      if (!match || !Object.values(MIME).includes(match[1].toLowerCase()))
        throw new Error('Passive design media must be a supported image or font.');
      if (match[1].toLowerCase() !== 'image/svg+xml') return ref;
      const svg = match[2]
        ? Buffer.from(match[3], 'base64').toString('utf8')
        : decodeURIComponent(match[3]);
      return `data:image/svg+xml;base64,${Buffer.from(passiveSvg(svg, from)).toString('base64')}`;
    }
    const fragmentIndex = ref.indexOf('#');
    const fragment = fragmentIndex < 0 ? '' : ref.slice(fragmentIndex);
    const { file, value } = read(fragmentIndex < 0 ? ref : ref.slice(0, fragmentIndex), from);
    if (!MIME[extname(file).toLowerCase()]) throw new Error(`Unsupported local media: ${ref}`);
    let payload = value;
    if (passive && extname(file).toLowerCase() === '.svg') {
      if (mediaStack.has(file) || mediaStack.size >= 16)
        throw new Error('Circular or excessively nested SVG media cannot be published.');
      mediaStack.add(file);
      try {
        payload = Buffer.from(passiveSvg(value.toString('utf8'), dirname(file)));
      } finally {
        mediaStack.delete(file);
      }
    }
    return `data:${MIME[extname(file).toLowerCase()]};base64,${payload.toString('base64')}${fragment}`;
  }
  function passiveSvg(value, from) {
    if (++svgDepth > 16) throw new Error('Excessively nested SVG media cannot be published.');
    try {
      const fragment = parseFragment(value);
      if (!fragment.childNodes.some((node) => node.tagName === 'svg'))
        throw new Error('SVG media must contain an SVG drawing.');
      const queue = [...children(fragment)];
      while (queue.length) {
        const node = queue.shift();
        if (['script', 'foreignObject', 'iframe', 'object', 'embed'].includes(node.tagName)) {
          node.parentNode.childNodes = node.parentNode.childNodes.filter((child) => child !== node);
          continue;
        }
        node.attrs = (node.attrs ?? []).filter((item) => !/^on/iu.test(item.name));
        if (node.tagName === 'style') setText(node, css(text(node), from));
        for (const item of node.attrs) {
          if (item.name === 'style') item.value = css(item.value, from);
          if (['href', 'src'].includes(item.name)) item.value = asset(item.value, from);
        }
        queue.unshift(...children(node));
      }
      return serialize(fragment);
    } finally {
      svgDepth--;
    }
  }
  function replaceCss(value, pattern, replacement) {
    const parts = [];
    let offset = 0,
      outputBytes = 0;
    function append(part) {
      const size = Buffer.byteLength(part);
      outputBytes += size;
      cssExpansionBytes += size;
      // Check BEFORE joining parts. Repeated acyclic imports can otherwise
      // allocate exponentially larger strings from only a few source bytes.
      if (outputBytes > maxBytes || cssExpansionBytes > maxBytes * 8)
        throw new Error('Stylesheet expansion exceeds the local asset budget.');
      parts.push(part);
    }
    for (const match of value.matchAll(pattern)) {
      append(value.slice(offset, match.index));
      append(replacement(...match));
      offset = match.index + match[0].length;
    }
    append(value.slice(offset));
    return parts.join('');
  }
  function css(value, from, stack = new Set()) {
    // Also bound empty/tiny import graphs, which can consume work without
    // growing output enough to trip the byte budget.
    if (++cssExpansions > 4096)
      throw new Error('Stylesheet expansion complexity exceeds the local asset budget.');
    let result = replaceCss(
      value,
      /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*([^;]*);/giu,
      (_all, ref, media) => {
        const next = read(ref, from);
        if (stack.has(next.file)) throw new Error(`Circular stylesheet import: ${ref}`);
        const expanded = css(
          next.value.toString('utf8'),
          dirname(next.file),
          new Set([...stack, next.file]),
        );
        return media.trim() ? `@media ${media.trim()}{${expanded}}` : expanded;
      },
    );
    if (/@import\b/iu.test(result)) throw new Error('Use quoted local stylesheet imports.');
    result = replaceCss(
      result,
      /url\(\s*(["']?)(.*?)\1\s*\)/giu,
      (_all, _quote, ref) => `url("${asset(ref, from)}")`,
    );
    return replaceCss(result, /<\/style/giu, () => '<\\/style');
  }
  function js(value, label) {
    try {
      new Script(value, { filename: label });
    } catch (error) {
      throw new Error(
        `Use compiled, self-contained browser JavaScript in ${label}: ${error.message}`,
      );
    }
    return value.replace(/<\/script/giu, '<\\/script');
  }
  const input = read(source.html);
  const document = parse(input.value.toString('utf8'));
  let head, body;
  const deferredScripts = [];
  const queue = [...children(document)];
  while (queue.length) {
    const node = queue.shift();
    if (node.tagName === 'head') head = node;
    if (node.tagName === 'body') body = node;
    if (['base', 'iframe', 'frame', 'frameset', 'object', 'embed'].includes(node.tagName))
      throw new Error(
        `Unsupported <${node.tagName}> in a local design. Use local controls and button handlers.`,
      );
    if (node.tagName === 'meta' && attr(node, 'http-equiv')?.value.toLowerCase() === 'refresh')
      throw new Error('Design screens cannot redirect.');
    if (node.tagName === 'style') setText(node, css(text(node), dirname(input.file)));
    if (
      node.tagName === 'link' &&
      attr(node, 'rel')?.value.toLowerCase().split(/\s+/u).includes('stylesheet')
    ) {
      const linked = read(attr(node, 'href')?.value, dirname(input.file));
      node.tagName = 'style';
      node.nodeName = 'style';
      node.attrs = [];
      setText(
        node,
        css(linked.value.toString('utf8'), dirname(linked.file), new Set([linked.file])),
      );
    }
    if (node.tagName === 'script') {
      const src = attr(node, 'src');
      if (passive) {
        if (src) read(src.value, dirname(input.file));
        node.parentNode.childNodes = node.parentNode.childNodes.filter((child) => child !== node);
        continue;
      }
      const type = attr(node, 'type')?.value.trim().toLowerCase();
      if (type === 'module')
        throw new Error('Compile module scripts before using them in a portable design.');
      if (!type || /(?:javascript|ecmascript)/u.test(type)) {
        const linked = src ? read(src.value, dirname(input.file)) : null;
        setText(
          node,
          js(linked ? linked.value.toString('utf8') : text(node), linked?.file ?? input.file),
        );
        if (src && attr(node, 'defer')) {
          deferredScripts.push(node);
          node.parentNode.childNodes = node.parentNode.childNodes.filter((child) => child !== node);
        }
        node.attrs = (node.attrs ?? []).filter(
          (item) => !['src', 'async', 'defer'].includes(item.name),
        );
      }
    }
    if (passive) node.attrs = (node.attrs ?? []).filter((item) => !/^on/iu.test(item.name));
    for (const item of node.attrs ?? []) {
      if (item.name === 'style') item.value = css(item.value, dirname(input.file));
      if (['src', 'poster'].includes(item.name))
        item.value = asset(item.value, dirname(input.file));
      if (item.name === 'srcset')
        throw new Error('Use a local src and responsive CSS for portable design images.');
      if (['action', 'formaction', 'target', 'formtarget'].includes(item.name) && item.value.trim())
        throw new Error('Design forms must use local submit handlers without navigation targets.');
      if (item.name === 'href' && !item.value.startsWith('#')) {
        if (node.tagName === 'link' || node.namespaceURI === 'http://www.w3.org/2000/svg')
          item.value = asset(item.value, dirname(input.file));
        else if (node.tagName === 'a')
          throw new Error('Use data-design-navigate="screen-id" for prototype navigation.');
      }
    }
    queue.unshift(...children(node));
  }
  const prepend = [];
  for (const path of [...sharedStyles, ...(source.styles ?? [])]) {
    const linked = read(path);
    prepend.push(
      element(
        'style',
        css(linked.value.toString('utf8'), dirname(linked.file), new Set([linked.file])),
      ),
    );
  }
  head.childNodes = [...prepend, ...head.childNodes];
  for (const node of prepend) node.parentNode = head;
  for (const path of source.scripts ?? []) {
    const linked = read(path);
    if (passive) continue;
    const node = element('script', js(linked.value.toString('utf8'), path));
    node.parentNode = body;
    body.childNodes.push(node);
  }
  // External classic defer scripts run after the full document is parsed, in
  // their original order. Inline scripts ignore defer in browsers, so relocate
  // the bundled equivalents after authored body and appended script content.
  for (const node of deferredScripts) {
    node.parentNode = body;
    body.childNodes.push(node);
  }
  body.attrs.push({ name: 'data-planr-screen', value: screenId });
  const html = serialize(document);
  if (Buffer.byteLength(html) > maxBytes)
    throw new Error('Bundled design exceeds the output budget.');
  return {
    html,
    files: [...files.keys()].map((path) => relative(root, path)),
    sourceDigests: Object.fromEntries(
      [...files].map(([path, value]) => [
        relative(root, path),
        createHash('sha256').update(value).digest('hex'),
      ]),
    ),
    inputBytes: bytes,
    bytes: Buffer.byteLength(html),
  };
}
