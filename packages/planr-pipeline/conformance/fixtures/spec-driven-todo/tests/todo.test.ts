import { describe, expect, it } from 'vitest';

import { addTodo } from '../src/todo.js';

describe('addTodo', () => {
  it('appends to an empty list', () => {
    expect(addTodo([], 'buy milk')).toEqual(['buy milk']);
  });

  it('appends to an existing list', () => {
    expect(addTodo(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input list reference', () => {
    const before = ['a', 'b'];
    const copy = [...before];
    addTodo(before, 'c');
    expect(before).toEqual(copy);
  });
});
