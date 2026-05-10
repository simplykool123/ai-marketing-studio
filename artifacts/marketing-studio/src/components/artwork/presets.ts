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

// ---------------------------------------------------------------------------
// Templates — purpose-driven presets with font + style opinions
// ---------------------------------------------------------------------------

export type TemplateId =
  | "festival_greeting"
  | "product_highlight"
  | "quote_thought"
  | "announcement"
  | "minimal_brand"
  | "carousel_cover";

export const TEMPLATE_META: Record<TemplateId, { label: string; description: string }> = {
  festival_greeting: { label: "Festival Greeting", description: "Elegant centered panel, Playfair Display, gold frame" },
  product_highlight: { label: "Product Highlight", description: "Bottom bar, bold Poppins headline, logo top-right" },
  quote_thought:     { label: "Quote / Thought",   description: "No panel, large centered Lora quote, logo bottom" },
  announcement:      { label: "Announcement",       description: "Top bar, strong Montserrat headline, accent frame" },
  minimal_brand:     { label: "Minimal Brand",      description: "No panel, bottom-left text, logo anchored top" },
  carousel_cover:    { label: "Carousel Cover",     description: "Full overlay, Bebas Neue display, white frame" },
};

export function applyTemplate(id: TemplateId, layers: ArtworkLayers): ArtworkLayers {
  // All templates: reset hidden/locked so the layout is immediately visible
  const base = { ...layers, hiddenLayers: [] as string[], lockedLayers: [] as string[], layerOrder: [...DEFAULT_LAYER_ORDER] };

  switch (id) {
    case "festival_greeting":
      return {
        ...base,
        panel: { ...base.panel, enabled: true, x: 60, y: 280, width: S - 120, height: 520, opacity: 0.88 },
        headline: { ...base.headline, x: 100, y: 330, width: S - 200, fontSize: 72, fontFamily: "Playfair Display", fontWeight: 700, align: "center" },
        subline: { ...base.subline, x: 100, y: 452, width: S - 200, fontSize: 32, fontFamily: "Playfair Display", fontWeight: 400, align: "center" },
        supportingLine: { ...base.supportingLine, x: 100, y: 638, width: S - 200, fontSize: 22, fontFamily: "Georgia", fontWeight: 400, align: "center" },
        logo: { ...base.logo, x: S / 2 - 80, y: 78, width: 160, height: 56 },
        frame: { enabled: true, color: "#d4af37", width: 20 },
      };
    case "product_highlight":
      return {
        ...base,
        panel: { ...base.panel, enabled: true, x: 0, y: 680, width: S, height: 400, opacity: 0.92 },
        headline: { ...base.headline, x: 60, y: 710, width: 880, fontSize: 64, fontFamily: "Poppins", fontWeight: 700, align: "left" },
        subline: { ...base.subline, x: 60, y: 802, width: 880, fontSize: 28, fontFamily: "Poppins", fontWeight: 400, align: "left" },
        supportingLine: { ...base.supportingLine, x: 60, y: 852, width: 700, fontSize: 20, fontFamily: "Poppins", fontWeight: 400, align: "left" },
        logo: { ...base.logo, x: 880, y: 60, width: 140, height: 50 },
        frame: { ...base.frame, enabled: false },
      };
    case "quote_thought":
      return {
        ...base,
        panel: { ...base.panel, enabled: false },
        headline: { ...base.headline, x: 80, y: 340, width: S - 160, fontSize: 60, fontFamily: "Lora", fontWeight: 400, align: "center" },
        subline: { ...base.subline, x: 80, y: 462, width: S - 160, fontSize: 24, fontFamily: "Lora", fontWeight: 400, align: "center" },
        supportingLine: { ...base.supportingLine, x: 80, y: 504, width: S - 160, fontSize: 18, fontFamily: "Georgia", fontWeight: 400, align: "center" },
        logo: { ...base.logo, x: S / 2 - 70, y: 940, width: 140, height: 50 },
        frame: { ...base.frame, enabled: false },
      };
    case "announcement":
      return {
        ...base,
        panel: { ...base.panel, enabled: true, x: 0, y: 0, width: S, height: 480, opacity: 0.92 },
        headline: { ...base.headline, x: 60, y: 80, width: S - 120, fontSize: 76, fontFamily: "Montserrat", fontWeight: 700, align: "left" },
        subline: { ...base.subline, x: 60, y: 198, width: S - 120, fontSize: 34, fontFamily: "Montserrat", fontWeight: 400, align: "left" },
        supportingLine: { ...base.supportingLine, x: 60, y: 254, width: S - 200, fontSize: 22, fontFamily: "Montserrat", fontWeight: 400, align: "left" },
        logo: { ...base.logo, x: 880, y: S - 120, width: 140, height: 50 },
        frame: { enabled: true, color: "#6366f1", width: 12 },
      };
    case "minimal_brand":
      return {
        ...base,
        panel: { ...base.panel, enabled: false },
        headline: { ...base.headline, x: 60, y: 820, width: 820, fontSize: 56, fontFamily: "Montserrat", fontWeight: 700, align: "left" },
        subline: { ...base.subline, x: 60, y: 904, width: 820, fontSize: 26, fontFamily: "Montserrat", fontWeight: 400, align: "left" },
        supportingLine: { ...base.supportingLine, x: 60, y: 950, width: 700, fontSize: 18, fontFamily: "Montserrat", fontWeight: 400, align: "left" },
        logo: { ...base.logo, x: 60, y: 60, width: 150, height: 54 },
        frame: { ...base.frame, enabled: false },
      };
    case "carousel_cover":
      return {
        ...base,
        panel: { ...base.panel, enabled: true, x: 0, y: 0, width: S, height: S, opacity: 0.72 },
        headline: { ...base.headline, x: 60, y: 310, width: S - 120, fontSize: 108, fontFamily: "Bebas Neue", fontWeight: 400, align: "center" },
        subline: { ...base.subline, x: 60, y: 440, width: S - 120, fontSize: 38, fontFamily: "Poppins", fontWeight: 700, align: "center" },
        supportingLine: { ...base.supportingLine, x: 60, y: 498, width: S - 120, fontSize: 24, fontFamily: "Poppins", fontWeight: 400, align: "center" },
        logo: { ...base.logo, x: S / 2 - 80, y: 80, width: 160, height: 60 },
        frame: { enabled: true, color: "#ffffff", width: 12 },
      };
    default:
      return base;
  }
}
