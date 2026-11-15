const FONT_REQUESTS = [
  ...[400, 500, 600, 700, 800].map((weight) => `${weight} 14px Outfit`),
  ...[400, 500, 600].map((weight) => `${weight} 14px "DM Sans Variable"`),
  ...[400, 500, 600].map((weight) => `${weight} 12px "Source Code Pro"`),
];

export async function loadDashboardFonts(fonts: FontFaceSet): Promise<void> {
  const missing = new Set(FONT_REQUESTS);
  const failures: string[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // Mount with final metrics so a cold local font cache cannot move the interface.
  const loading = Promise.all(
    FONT_REQUESTS.map(async (font) => {
      try {
        const faces = await fonts.load(font);
        if (faces.length > 0) missing.delete(font);
      } catch (error: unknown) {
        failures.push(`${font}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  ).then(() => {
    if (missing.size > 0) {
      throw new Error(
        `Dashboard font is unavailable: ${[...missing].join(', ')}. ${failures.join('; ')}`.trim(),
      );
    }
  });

  try {
    // A stalled local asset must not prevent access to the dashboard.
    await Promise.race([
      loading,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Dashboard fonts timed out after 3000 ms: ${[...missing].join(', ')}.`));
        }, 3000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
