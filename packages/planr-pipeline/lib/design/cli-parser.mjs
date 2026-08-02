export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let key, val;
      if (eq !== -1) {
        key = a.slice(2, eq);
        val = a.slice(eq + 1);
      } else {
        key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          val = true;
        } else {
          val = next;
          i++;
        }
      }
      args[key] = val;
    } else {
      args._.push(a);
    }
  }
  return args;
}

export function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}
