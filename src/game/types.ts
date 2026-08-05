export type LobbyPageId = 'home' | 'warzone' | 'loadout' | 'stash' | 'shop';

export interface LobbyPage {
  id: LobbyPageId;
  path: `/${LobbyPageId}`;
  short: string;
  label: string;
}

export interface DuckUiBridge {
  go(path: string): Promise<unknown>;
  current(): string;
  pages: string[];
}

export interface DuckThreePreviewDebug {
  ready: boolean;
  renderer: string;
  revision: string;
  objectCount: number;
  frameCount: number;
  reason?: string;
}

export interface ItemDefinition {
  name: string;
  icon: string;
  category: string;
  desc: string;
  [property: string]: string | number | boolean | undefined;
}

export interface MapDefinition {
  id: string;
  name: string;
  subtitle: string;
  thumbClass: string;
  palette: Record<string, string>;
  world: { w: number; h: number };
  spawn: { x: number; y: number };
  extraction: { x: number; y: number; w: number; h: number };
  roads: Array<{ x: number; y: number; w: number; h: number }>;
  waterZones: Array<{ x: number; y: number; rx: number; ry: number }>;
  buildingSpecs: Array<Record<string, string | number | boolean>>;
}

declare global {
  interface Window {
    __duckUi: DuckUiBridge;
    __duckThreePreview: DuckThreePreviewDebug;
  }
}
