export function observeTransformWrites(
  element: HTMLElement | SVGGElement,
  onWrite: () => void,
): { flush(): void; disconnect(): void } {
  const parser = element.ownerDocument.createElement('div').style;
  function styleTransform(value: string | null): string {
    parser.cssText = value ?? '';
    return parser.transform;
  }
  function count(records: readonly MutationRecord[]): void {
    let style = element.getAttribute('style');
    let transform = element.getAttribute('transform');
    // A later record's old value preserves intermediate writes in the same batch.
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (record.attributeName === 'style') {
        if (styleTransform(record.oldValue) !== styleTransform(style)) onWrite();
        style = record.oldValue;
      } else if (record.attributeName === 'transform') {
        if (record.oldValue !== transform) onWrite();
        transform = record.oldValue;
      }
    }
  }
  const observer = new MutationObserver(count);
  observer.observe(element, {
    attributes: true,
    attributeFilter: ['style', 'transform'],
    attributeOldValue: true,
  });
  return {
    flush() {
      count(observer.takeRecords());
    },
    disconnect() {
      observer.disconnect();
    },
  };
}
