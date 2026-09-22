/** Small DOM helpers keep authored labels out of HTML strings. */
export function element(document, tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'className') node.className = value;
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(document, text, action, options = {}) {
  return element(document, 'button', { type: 'button', 'data-action': action, ...options }, text);
}
export function field(document, name, value, { type = 'text', choices, multiline = false, ...attributes } = {}) {
  const label = element(document, 'label', { className: 'de-field' });
  label.append(element(document, 'span', {}, name));
  const input = element(document, choices ? 'select' : multiline ? 'textarea' : 'input', { 'aria-label': name, ...(!choices && !multiline ? { type } : {}), ...attributes });
  if (choices) for (const choice of choices) {
    const [id, title] = Array.isArray(choice) ? choice : [choice, choice];
    input.append(element(document, 'option', { value: id }, title));
  }
  if (type === 'checkbox') input.checked = value === true;
  else input.value = value ?? '';
  label.append(input);
  return { label, input };
}
export function downloadJson(document, value, filename) {
  const window = document.defaultView;
  const url = window.URL.createObjectURL(new window.Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = element(document, 'a', { href: url, download: filename });
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
