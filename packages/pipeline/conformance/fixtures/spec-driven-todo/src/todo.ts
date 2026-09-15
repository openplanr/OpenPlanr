export function addTodo(list: readonly string[], text: string): string[] {
  return [...list, text];
}
