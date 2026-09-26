// CI runs these checks as required jobs, and its own commits (the version PR) must not run a
// developer hook.
if (process.env.CI === 'true') process.exit(0);

const { default: husky } = await import('husky');
process.stdout.write(husky());
