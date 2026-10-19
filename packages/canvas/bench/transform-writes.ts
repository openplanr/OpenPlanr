export function observeTransformWrites(
  element: HTMLElement,
  onWrite: () => void,
): { flush(): void; disconnect(): void } {
  const parser = element.ownerDocument.createElement('div').style;
  function styleTransform(value: string | null): string {
    parser.cssText = value ?? '';
    return parser.transform;
  }
  function count(records: readonly MutationRecord[]): void {
    let style = element.getAttribute('style');
    // A later record's old value preserves intermediate writes in the same batch.
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (record.attributeName === 'style') {
        if (styleTransform(record.oldValue) !== styleTransform(style)) onWrite();
        style = record.oldValue;
      }
    }
  }
  const observer = new MutationObserver(count);
  observer.observe(element, {
    attributes: true,
    attributeFilter: ['style'],
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
