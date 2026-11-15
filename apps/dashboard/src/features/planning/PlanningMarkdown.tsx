import { type ReactNode, useEffect, useRef, useState } from 'react';
import { parseDashboardRoute, serializeDashboardRoute } from '../../app/router.js';

export function safePlanningMarkdownHref(value: string): string | null {
  if (value.startsWith('#/')) {
    const route = parseDashboardRoute(value);
    return route.kind === 'planning.detail' || route.kind === 'planning.spec'
      ? serializeDashboardRoute(route)
      : null;
  }
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function inline(text: string): ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/gu;
  const content: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    content.push(text.slice(offset, match.index));
    const token = match[0];
    if (token.startsWith('`')) content.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**'))
      content.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);
      const href = link ? safePlanningMarkdownHref(link[2]) : null;
      content.push(
        href && link ? (
          <a key={match.index} href={href} rel="noreferrer">
            {link[1]}
          </a>
        ) : (
          token
        ),
      );
    }
    offset = match.index + token.length;
  }
  content.push(text.slice(offset));
  return content;
}

// Raw HTML stays text; a small Markdown subset never grants new browser protocols.
const parsed = new Map<string, ReactNode>();
let cachedCharacters = 0;
export function PlanningMarkdown({ text }: { text: string }) {
  const cached = parsed.get(text);
  if (cached) return cached;
  const result = parseMarkdown(text);
  // Bound retained source and elements; long bodies still render safely on demand.
  if (text.length <= 250_000) {
    while (parsed.size && (parsed.size >= 128 || cachedCharacters + text.length > 500_000)) {
      const oldest = parsed.keys().next().value as string;
      cachedCharacters -= oldest.length;
      parsed.delete(oldest);
    }
    parsed.set(text, result);
    cachedCharacters += text.length;
  }
  return result;
}

function parseMarkdown(text: string) {
  const blocks: ReactNode[] = [];
  const lines = text.split(/\r?\n/u);
  let fence: string | null = null;
  let code: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker && !fence) {
      fence = marker;
      continue;
    }
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length) {
        blocks.push(
          <pre key={index}>
            <code>{code.join('\n')}</code>
          </pre>,
        );
        fence = null;
        code = [];
      } else code.push(line);
      continue;
    }
    if (!line.trim()) continue;
    const heading = /^#{1,6}\s+(.+)$/u.exec(line);
    if (heading) blocks.push(<h3 key={index}>{inline(heading[1])}</h3>);
    else if (/^\s*[-*+]\s+/u.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/u.test(lines[index])) {
        items.push(<li key={index}>{inline(lines[index].replace(/^\s*[-*+]\s+/u, ''))}</li>);
        index++;
      }
      index--;
      blocks.push(<ul key={index}>{items}</ul>);
    } else blocks.push(<p key={index}>{inline(line)}</p>);
  }
  if (fence)
    blocks.push(
      <pre key="unclosed">
        <code>{code.join('\n')}</code>
      </pre>,
    );
  return <div className="pc-detail__markdown">{blocks}</div>;
}

/** A closed disclosure must not parse or mount its potentially large contents. */
export function DetailDisclosure({
  label,
  children,
}: {
  label: string;
  children: () => ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="pc-detail__disclosure"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>{label}</summary>
      {opened ? children() : null}
    </details>
  );
}

/** The enclosing fixed-size scroll region reserves geometry before any content mounts. */
export function DeferredDetailContent({ children }: { children: () => ReactNode }) {
  const marker = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const region = marker.current?.parentElement;
    if (visible || !region) return;
    const reveal = () => setVisible(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) reveal();
      },
      { rootMargin: '100px' },
    );
    observer.observe(region);
    region.addEventListener('focusin', reveal);
    return () => {
      observer.disconnect();
      region.removeEventListener('focusin', reveal);
    };
  }, [visible]);
  return <div ref={marker}>{visible ? children() : null}</div>;
}
