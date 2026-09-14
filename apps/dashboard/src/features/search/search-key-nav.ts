export type SearchKeyNav<T> = Readonly<{
  items: readonly T[];
  activeIndex: number;
  moveDown: () => SearchKeyNav<T>;
  moveUp: () => SearchKeyNav<T>;
  reset: (items: readonly T[]) => SearchKeyNav<T>;
  getActive: () => T | null;
}>;

/** Pure keyboard cursor over a flat result list. Index -1 means nothing is active. */
export function createSearchKeyNav<T>(items: readonly T[]): SearchKeyNav<T> {
  const list = Object.freeze([...items]);
  const state = Object.freeze({
    items: list,
    activeIndex: -1,
    moveDown() {
      const next =
        this.activeIndex < this.items.length - 1 ? this.activeIndex + 1 : this.activeIndex;
      return createSearchKeyNavWithIndex(this.items, next);
    },
    moveUp() {
      const next = this.activeIndex > 0 ? this.activeIndex - 1 : this.activeIndex;
      return createSearchKeyNavWithIndex(this.items, next);
    },
    reset(nextItems: readonly T[]) {
      return createSearchKeyNav(nextItems);
    },
    getActive() {
      return this.activeIndex >= 0 && this.activeIndex < this.items.length
        ? (this.items[this.activeIndex] ?? null)
        : null;
    },
  });
  return state;
}

function createSearchKeyNavWithIndex<T>(items: readonly T[], activeIndex: number): SearchKeyNav<T> {
  const list = Object.freeze([...items]);
  return Object.freeze({
    items: list,
    activeIndex,
    moveDown() {
      const next = activeIndex < list.length - 1 ? activeIndex + 1 : activeIndex;
      return createSearchKeyNavWithIndex(list, next);
    },
    moveUp() {
      const next = activeIndex > 0 ? activeIndex - 1 : activeIndex;
      return createSearchKeyNavWithIndex(list, next);
    },
    reset(nextItems: readonly T[]) {
      return createSearchKeyNav(nextItems);
    },
    getActive() {
      return activeIndex >= 0 && activeIndex < list.length ? (list[activeIndex] ?? null) : null;
    },
  });
}
