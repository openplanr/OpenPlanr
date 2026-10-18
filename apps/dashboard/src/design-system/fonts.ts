const FONT_REQUESTS = [
  ...[400, 500, 600, 700, 800].map((weight) => `${weight} 14px Outfit`),
  ...[400, 500, 600].map((weight) => `${weight} 14px "DM Sans Variable"`),
  ...[400, 500, 600].map((weight) => `${weight} 12px "Source Code Pro"`),
];

export async function loadDashboardFonts(fonts: FontFaceSet): Promise<void> {
  // Mount with final metrics so a cold local font cache cannot move the interface.
  await Promise.all(
    FONT_REQUESTS.map(async (font) => {
      const faces = await fonts.load(font);
      if (faces.length === 0) throw new Error(`Dashboard font is unavailable: ${font}.`);
    }),
  );
}
