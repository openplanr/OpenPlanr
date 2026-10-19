import type { WorkerDrawing } from './overview.mjs';
import { drawWorkerOverview } from './overview.mjs';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerDrawing>) => void) | null;
  postMessage(message: { id: number; bitmap: ImageBitmap }, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const input = event.data;
  const canvas = new OffscreenCanvas(
    Math.ceil(input.target.width * input.target.devicePixelRatio),
    Math.ceil(input.target.height * input.target.devicePixelRatio),
  );
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Overview worker canvas 2D context is unavailable');
  drawWorkerOverview(context, input);
  const bitmap = canvas.transferToImageBitmap();
  scope.postMessage({ id: input.id, bitmap }, [bitmap]);
};
