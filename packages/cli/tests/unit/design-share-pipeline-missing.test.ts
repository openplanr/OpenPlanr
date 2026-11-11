import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/pipeline-package-service.js', () => ({
  resolvePipelinePackage: () => null,
}));

const {
  prepareDesignHandoff,
  readDesignShareRuntime,
  runDesignFeedback,
  runDesignHandoffAction,
  runDesignShareAction,
} = await import('../../src/services/design-artifact-service.js');

describe('design sharing without the optional workflow package', () => {
  const missing = {
    code: 'E_DESIGN_SHARE_PIPELINE_MISSING',
    fix: expect.stringContaining('--omit=optional'),
  };

  it('reports the missing package for every sharing entry point', async () => {
    await expect(readDesignShareRuntime('0.0.0')).rejects.toMatchObject(missing);
    await expect(runDesignShareAction('/design-document.json', 'status')).rejects.toMatchObject(
      missing,
    );
    await expect(runDesignFeedback('/design-document.json', 'inspect', {})).rejects.toMatchObject(
      missing,
    );
    await expect(runDesignHandoffAction('/design-document.json', 'inspect')).rejects.toMatchObject(
      missing,
    );
    await expect(prepareDesignHandoff('/design-document.json')).rejects.toMatchObject(missing);
  });
});
