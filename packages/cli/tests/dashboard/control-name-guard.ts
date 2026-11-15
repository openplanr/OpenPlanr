import axe from 'axe-core';
import { computeAccessibleName } from 'dom-accessibility-api';
import { vi } from 'vitest';

export const normalise = (text: string) => text.replace(/\s+/gu, ' ').trim().toLowerCase();

export function visibleText(element: Element): string {
  if (element.matches('svg') || element.closest('[aria-hidden="true"], [hidden]')) return '';
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return '';
  if (element.tagName === 'BR') return ' ';
  return Array.from(element.childNodes)
    .map((child) => (child instanceof Element ? visibleText(child) : (child.textContent ?? '')))
    .join('');
}

function fieldLabelText(element: Element): string {
  if (
    element.matches('input, textarea, select, svg') ||
    element.closest('[aria-hidden="true"], [hidden]')
  )
    return '';
  return Array.from(element.childNodes)
    .map((child) => (child instanceof Element ? fieldLabelText(child) : (child.textContent ?? '')))
    .join(' ');
}

function fieldNameFailures(root: HTMLElement): string[] {
  const failures: string[] = [];
  for (const field of root.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('input, textarea, select')) {
    if (field.closest('[aria-hidden="true"], [hidden]')) continue;
    const name = normalise(computeAccessibleName(field));
    const label = normalise(
      Array.from(field.labels ?? [])
        .map(fieldLabelText)
        .join(' '),
    );
    if (!name || (label && !name.includes(label)))
      failures.push(
        `${field.outerHTML}\nVisible label ${JSON.stringify(label)} is missing from name ${JSON.stringify(name)}.`,
      );
  }
  return failures;
}

export async function nameFailures(root: HTMLElement): Promise<string[]> {
  const canvas = vi.isMockFunction(HTMLCanvasElement.prototype.getContext)
    ? null
    : vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const result = await axe
    .run(root, {
      runOnly: { type: 'rule', values: ['label-content-name-mismatch'] },
      elementRef: true,
    })
    .finally(() => canvas?.mockRestore());
  const failures = result.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${node.target.join(', ')}: ${node.html}\n${node.failureSummary}`,
    ),
  );
  // jsdom cannot measure icon fonts without native canvas. Check undecidable text
  // controls directly so an axe incomplete result cannot silently pass this gate.
  for (const incomplete of result.incomplete) {
    for (const node of incomplete.nodes) {
      const element = node.element;
      if (!element) throw new Error(`Missing element for ${node.target.join(', ')}: ${node.html}`);
      const text = normalise(visibleText(element));
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      const name = normalise(computeAccessibleName(element));
      if (!name.includes(text))
        failures.push(
          `${node.target.join(', ')}: ${node.html}\nVisible text ${JSON.stringify(text)} is missing from name ${JSON.stringify(name)}.`,
        );
    }
  }
  failures.push(...fieldNameFailures(root));
  return failures;
}
