/** Wait for authored source authentication and finite chrome transitions, without changing UI state. */
export async function settleStudioChrome(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const targets = [
      '.design-toolbar',
      '.planr-workspace',
      '.design-navigator',
      '.planr-review-rail',
    ];
    await Promise.all(
      targets
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .flatMap((node) => node.getAnimations({ subtree: true }))
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

export async function readyPrototypeFrame(page, artifactId) {
  await page.waitForFunction(
    (id) => {
      const frame = [...document.querySelectorAll('[data-planr-artifact-frame]')].find(
        (node) => node.dataset.planrArtifactFrame === id,
      );
      const rect = frame?.getBoundingClientRect();
      return (
        frame?.dataset.planrBridgeTrusted === 'true' &&
        (frame.srcdoc || frame.getAttribute('src')) &&
        rect?.width > 1 &&
        rect?.height > 1 &&
        !frame.closest('[hidden]')
      );
    },
    artifactId,
    { timeout: 15000 },
  );
  await settleStudioChrome(page);
}
