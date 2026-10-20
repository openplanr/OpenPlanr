export const palettes = {
  dark: {
    bg: '#08080c',
    panel: '#0e0e14',
    card: '#141420',
    raised: '#1a1a2a',
    line: '#222236',
    'line-strong': '#606c7f',
    text: '#f4f4fa',
    heading: '#e8e8f0',
    body: '#9999b8',
    muted: '#a4adbc',
    dim: '#858d99',
    accent: '#5eead4',
    'accent-soft': '#153a32',
    'on-accent': '#08080c',
    info: '#78aef8',
    danger: '#f87171',
    warning: '#e7b85c',
    addressed: '#b498ef',
    'type-spec': '#c084fc',
    'type-us': '#60a5fa',
    'type-t': '#22d3ee',
    'type-bl': '#fbbf24',
    'type-adr': '#f472b6',
    'type-epic': '#4ade80',
    'type-sprint': '#5eead4',
    'type-qt': '#a4adbc',
  },
  light: {
    bg: '#f5f7f7',
    panel: '#ffffff',
    card: '#ffffff',
    raised: '#e9efed',
    line: '#dce3e1',
    'line-strong': '#c7cdd5',
    text: '#17191d',
    heading: '#17191d',
    body: '#4a525d',
    muted: '#5c6470',
    dim: '#5d6470',
    accent: '#206e67',
    'accent-soft': '#e3f3ed',
    'on-accent': '#ffffff',
    info: '#2664ac',
    danger: '#b83142',
    warning: '#8b5813',
    addressed: '#6e53b0',
    'type-spec': '#7833ec',
    'type-us': '#1556e5',
    'type-t': '#0d6c86',
    'type-bl': '#8e5706',
    'type-adr': '#be185d',
    'type-epic': '#137237',
    'type-sprint': '#206e67',
    'type-qt': '#5c6470',
  },
};

export const statuses = {
  outstanding: 'info',
  'in-progress': 'accent',
  blocked: 'danger',
  addressed: 'addressed',
  done: 'dim',
  quiet: 'warning',
};
export const types = ['spec', 'us', 't', 'bl', 'adr', 'epic', 'sprint', 'qt'];
export const surfaces = ['bg', 'panel', 'card', 'raised'];
export const fontPins = {
  '@fontsource/outfit': '5.3.0',
  '@fontsource-variable/dm-sans': '5.3.0',
  '@fontsource/source-code-pro': '5.3.1',
};
export const tintRatios = {
  light: [
    [4.9753, 5.336, 5.336, 4.6071],
    [4.9728, 5.3321, 5.3321, 4.6067],
    [4.9813, 5.3405, 5.3405, 4.6159],
    [4.9777, 5.3373, 5.3373, 4.611],
    [4.9301, 5.2897, 5.2897, 4.5627],
    [5.0044, 5.3653, 5.3653, 4.6374],
    [5.0193, 5.381, 5.381, 4.6511],
    [5.0061, 5.3667, 5.3667, 4.6386],
    [4.9969, 5.3571, 5.3571, 4.63],
    [5.0193, 5.381, 5.381, 4.6511],
    [4.873, 5.2268, 5.2268, 4.5117],
    [4.9713, 5.3299, 5.3299, 4.6055],
    [4.9922, 5.3517, 5.3517, 4.6257],
    [4.9996, 5.3607, 5.3607, 4.6315],
  ],
  dark: [
    [6.9606, 6.5962, 6.1707, 5.7405],
    [7.2185, 6.8381, 6.3953, 5.948],
    [9.979, 9.4329, 8.8076, 8.1805],
    [10.7168, 10.1188, 9.4539, 8.7805],
    [6.9686, 6.6109, 6.1942, 5.7691],
    [10.3121, 9.743, 9.1014, 8.4539],
    [11.976, 11.2879, 10.516, 9.7478],
    [8.04, 7.6046, 7.1063, 6.6033],
    [7.9882, 7.5575, 7.0603, 6.5603],
    [11.976, 11.2879, 10.516, 9.7478],
    [6.6958, 6.3576, 5.9647, 5.5606],
    [7.5517, 7.1478, 6.6805, 6.2096],
    [5.5509, 5.2708, 4.9433, 4.6072],
    [9.7686, 9.2271, 8.6196, 8.0054],
  ],
};

export function rgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

export function tint(foreground, base) {
  return foreground.map((channel, index) => channel * 0.08 + base[index] * 0.92);
}

export function contrast(a, b) {
  const luminance = (channels) =>
    channels
      .map((channel) => {
        const srgb = channel / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
