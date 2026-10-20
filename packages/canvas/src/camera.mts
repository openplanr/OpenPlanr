import type { Camera, Point, Rect } from './types.mjs';

export function invalid(field: string, value: unknown): never {
  throw new TypeError(`${field}: invalid value ${String(value)}`);
}

export function finite(field: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(field, value);
}

export function positive(field: string, value: unknown): asserts value is number {
  finite(field, value);
  if (value <= 0) invalid(field, value);
}

export function nonnegative(field: string, value: unknown): asserts value is number {
  finite(field, value);
  if (value < 0) invalid(field, value);
}

export function point(field: string, value: Point): void {
  if (!value || typeof value !== 'object') invalid(field, value);
  finite(`${field}.x`, value.x);
  finite(`${field}.y`, value.y);
}

export function rect(field: string, value: Rect): void {
  point(field, value);
  nonnegative(`${field}.width`, value.width);
  nonnegative(`${field}.height`, value.height);
}

export function validateCamera(camera: Camera): void {
  point('camera', camera);
  positive('camera.zoom', camera.zoom);
}

export function worldToScreen(camera: Camera, value: Point): Point {
  return { x: (value.x - camera.x) * camera.zoom, y: (value.y - camera.y) * camera.zoom };
}

export function screenToWorld(camera: Camera, value: Point): Point {
  return { x: value.x / camera.zoom + camera.x, y: value.y / camera.zoom + camera.y };
}

export function cameraFromScreenTranslate(
  translate: Readonly<{ x: number; y: number; scale: number }>,
): Camera {
  point('translate', translate);
  positive('translate.scale', translate.scale);
  return {
    x: -translate.x / translate.scale,
    y: -translate.y / translate.scale,
    zoom: translate.scale,
  };
}

export function cameraToScreenTranslate(
  camera: Camera,
): Readonly<{ x: number; y: number; scale: number }> {
  validateCamera(camera);
  return { x: -camera.x * camera.zoom, y: -camera.y * camera.zoom, scale: camera.zoom };
}
