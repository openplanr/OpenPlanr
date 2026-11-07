// 13-design-review-experience.js:955 and :1039
var scope = `openplanr.experience.${location.pathname}`;
var read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(`${scope}.${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
};
async function load(url) {
  return fetch(url, { cache: 'no-store' });
}
