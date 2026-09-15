export type DesignView = 'canvas' | 'prototype' | 'walkthrough';

export interface DesignSource {
  /** Local HTML path relative to the authored document directory. */
  html: string;
  styles?: string[];
  scripts?: string[];
}

export interface DesignFrame {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface DesignScreen {
  id: string;
  title: string;
  description?: string;
  source: DesignSource;
  /** Stable feedback anchors, unique within this screen. */
  anchors?: string[];
}

export interface DesignVariant {
  id: string;
  label: string;
  description?: string;
  status: 'ready' | 'failed';
  /** Required for failed variants. */
  issue?: string;
  /** Sparse screen overrides inherit unchanged sources from screens. */
  sources?: Record<string, DesignSource>;
}

export interface DesignDocument {
  kind: 'openplanr-design-document';
  schemaVersion: '1.0.0';
  id: string;
  title: string;
  brief: {
    text: string;
    source: 'spec' | 'png' | 'describe';
    provenance: 'spec' | 'inferred';
    references?: string[];
  };
  designSystem?: { path?: string; tokens?: string; spacing?: number[] };
  assets?: string[];
  frames: DesignFrame[];
  screens: DesignScreen[];
  screenOrder: string[];
  flows?: { id: string; title: string; screens: string[] }[];
  variants: DesignVariant[];
  selectedVariant: string;
  defaultView: DesignView;
}

export declare const DESIGN_DOCUMENT_VERSION: '1.0.0';
export declare const DESIGN_DOCUMENT_SCHEMA: Readonly<Record<string, unknown>>;
export declare function validateDesignDocument(value: unknown): { ok: boolean; errors: string[] };
export declare function assertDesignDocument(value: unknown): DesignDocument;
