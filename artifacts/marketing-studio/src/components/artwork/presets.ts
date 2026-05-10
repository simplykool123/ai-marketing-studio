import type { ArtworkLayers } from "./types";

const S = 1080;

/** Canonical bottom-to-top render order used when no layerOrder is stored. */
export const DEFAULT_LAYER_ORDER = [
  "background",
  "panel",
  "frame",
  "headline",
  "subline",
  "supportingLine",
  "logo",
] as const;

export function defaultLayers(opts: {
  backgroundUrl?: string;
  logoUrl?: string;
  headline?: string;
  subline?: string;
  supportingLine?: string;
}): ArtworkLayers {
  return {
    background: { url: opts.backgroundUrl ?? "", x: 0, y: 0, scale: 1, color: "#1e293b" },
    headline: {
      text: opts.headline ?? "Headline",
      x: 80, y: 740, width: 700,
      fontSize: 52, fontFamily: "Georgia", fontWeight: 700,
      color: "#ffffff", align: "left",
    },
    subline: {
      text: opts.subline ?? "Supporting text",
      x: 80, y: 830, width: 700,
      fontSize: 26, fontFamily: "Georgia", fontWeight: 400,
      color: "#ffffffcc", align: "left",
    },
    supportingLine: {
      text: opts.supportingLine ?? "",
      x: 80, y: 890, width: 700,
      fontSize: 18, fontFamily: "Georgia", fontWeight: 400,
      color: "#ffffff99", align: "left",
    },
    logo: { url: opts.logoUrl ?? "", enabled: !!opts.logoUrl, x: 80, y: 72, width: 160, height: 56, colorMode: "original" },
    panel: { enabled: true, x: 0, y: 690, width: S, height: 390, color: "#0f172a", opacity: 0.85 },
    frame: { enabled: false, color: "#f59e0b", width: 12 },
    layerOrder: [...DEFAULT_LAYER_ORDER],
  };
}

export type PresetId = "bottom_panel" | "top_panel" | "center_panel" | "minimal" | "logo_top";

export const PRESET_LABELS: Record<PresetId, string> = {
  bottom_panel: "Bottom panel",
  top_panel: "Top panel",
  center_panel: "Center panel",
  minimal: "Minimal",
  logo_top: "Logo top",
};

export function applyPreset(id: PresetId, layers: ArtworkLayers): ArtworkLayers {
  switch (id) {
    case "bottom_panel":
      return {
        ...layers,
        panel: { ...layers.panel, enabled: true, x: 0, y: 660, width: S, height: 420 },
        headline: { ...layers.headline, x: 80, y: 720 },
        subline: { ...layers.subline, x: 80, y: 810 },
        supportingLine: { ...layers.supportingLine, x: 80, y: 870 },
        logo: { ...layers.logo, x: 80, y: 80 },
      };
    case "top_panel":
      return {
        ...layers,
        panel: { ...layers.panel, enabled: true, x: 0, y: 0, width: S, height: 420 },
        headline: { ...layers.headline, x: 80, y: 80 },
        subline: { ...layers.subline, x: 80, y: 170 },
        supportingLine: { ...layers.supportingLine, x: 80, y: 226 },
        logo: { ...layers.logo, x: 840, y: 340, width: 140, height: 50 },
      };
    case "center_panel":
      return {
        ...layers,
        panel: { ...layers.panel, enabled: true, x: 60, y: 310, width: 960, height: 460 },
        headline: { ...layers.headline, x: 100, y: 370, width: 880, align: "center" },
        subline: { ...layers.subline, x: 100, y: 462, width: 880, align: "center" },
        supportingLine: { ...layers.supportingLine, x: 100, y: 516, width: 880, align: "center" },
        logo: { ...layers.logo, x: 80, y: 80 },
      };
    case "minimal":
      return {
        ...layers,
        panel: { ...layers.panel, enabled: false },
        headline: { ...layers.headline, x: 80, y: 800, color: "#ffffff" },
        subline: { ...layers.subline, x: 80, y: 890, color: "#ffffffcc" },
        supportingLine: { ...layers.supportingLine, x: 80, y: 940, color: "#ffffff99" },
        logo: { ...layers.logo, x: 80, y: 80 },
      };
    case "logo_top":
      return {
        ...layers,
        panel: { ...layers.panel, enabled: true, x: 0, y: 700, width: S, height: 380 },
        headline: { ...layers.headline, x: 80, y: 760 },
        subline: { ...layers.subline, x: 80, y: 850 },
        supportingLine: { ...layers.supportingLine, x: 80, y: 906 },
        logo: { ...layers.logo, x: S / 2 - 80, y: 80, width: 160, height: 60 },
      };
    default:
      return layers;
  }
}
