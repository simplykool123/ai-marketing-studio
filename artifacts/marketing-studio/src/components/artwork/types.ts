export interface BackgroundLayer {
  url: string;
  /** Offset from cover-centered position in canvas units (1080). 0 = centered. */
  x: number;
  y: number;
  /** Zoom multiplier on top of cover-fit. 1 = fill canvas edge-to-edge. */
  scale: number;
  /** Fallback fill when no image URL. */
  color: string;
}

export interface TextLayer {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontFamily: string;
  /** CSS font-weight number: 400=normal, 700=bold. */
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
}

export type LogoColorMode = "original" | "white" | "black" | "brand" | "accent";

export interface LogoLayer {
  url: string;
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** How to render the logo color. Default: "original". */
  colorMode?: LogoColorMode;
  /** Custom tint hex used when colorMode is "brand" or "accent". */
  tintColor?: string;
}

export interface PanelLayer {
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
}

export interface FrameLayer {
  enabled: boolean;
  color: string;
  width: number;
}

export interface ArtworkLayers {
  background: BackgroundLayer;
  headline: TextLayer;
  subline: TextLayer;
  supportingLine: TextLayer;
  logo: LogoLayer;
  panel: PanelLayer;
  frame: FrameLayer;
  /** Z-order from bottom to top. Optional — falls back to DEFAULT_LAYER_ORDER. */
  layerOrder?: string[];
  /** Layer IDs that are currently hidden (not rendered to canvas). */
  hiddenLayers?: string[];
  /** Layer IDs that are locked (no drag). */
  lockedLayers?: string[];
}

export type LayerId = "background" | "panel" | "headline" | "subline" | "supportingLine" | "logo" | "frame";
