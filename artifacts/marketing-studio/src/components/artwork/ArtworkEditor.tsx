import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer } from "react-konva";
import type Konva from "konva";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Eye, EyeOff, Lock, Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtworkLayers, LayerId, LogoColorMode } from "./types";
import {
  applyPreset, applyTemplate, defaultLayers, DEFAULT_LAYER_ORDER,
  PRESET_LABELS, TEMPLATE_META,
  type PresetId, type TemplateId,
} from "./presets";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CANVAS_SIZE = 1080;
export const CANVAS_DISPLAY = 540;
const SCALE = CANVAS_DISPLAY / CANVAS_SIZE;

const FONT_GROUPS = [
  {
    label: "Elegant",
    fonts: ["Playfair Display", "Lora", "Merriweather", "Georgia", "Times New Roman"],
  },
  {
    label: "Modern",
    fonts: ["Poppins", "Montserrat", "Inter", "Arial", "Verdana"],
  },
  {
    label: "Bold Display",
    fonts: ["Bebas Neue", "Impact", "Trebuchet MS", "Courier New"],
  },
] as const;

const LOGO_COLOR_MODES: Array<{ value: LogoColorMode; label: string }> = [
  { value: "original", label: "Original" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "brand", label: "Brand" },
  { value: "accent", label: "Accent" },
];

const ALIGN_OPTIONS: Array<{ v: "left" | "center" | "right"; label: string }> = [
  { v: "left", label: "L" }, { v: "center", label: "C" }, { v: "right", label: "R" },
];

type TextLayerId = "headline" | "subline" | "supportingLine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useKonvaImage(src: string | null | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) { setImg(null); return; }
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = src;
    return () => { el.onload = null; el.onerror = null; };
  }, [src]);
  return img;
}

function applyTint(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  // Fill with target color, then mask to logo shape using destination-in
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function useTintedLogoImage(
  src: string | null | undefined,
  colorMode: LogoColorMode = "original",
  tintColor = "#ffffff"
): HTMLImageElement | HTMLCanvasElement | null {
  const [result, setResult] = useState<HTMLImageElement | HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!src) { setResult(null); return; }
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.onload = () => {
      if (colorMode === "original") {
        setResult(el);
      } else {
        const color = colorMode === "white" ? "#ffffff"
          : colorMode === "black" ? "#000000"
          : tintColor;
        setResult(applyTint(el, color));
      }
    };
    el.onerror = () => setResult(null);
    el.src = src;
    return () => { el.onload = null; el.onerror = null; };
  }, [src, colorMode, tintColor]);
  return result;
}

function konvaFontStyle(weight: number): string {
  return weight >= 700 ? "bold" : "normal";
}

function hexToOpaque(hex: string): string {
  return hex.startsWith("#") ? hex.slice(0, 7) : hex;
}

function layerLabel(id: string): string {
  return id.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
}

// ---------------------------------------------------------------------------
// Template thumbnails — schematic SVG previews (108×108 canvas units = 1080÷10)
// ---------------------------------------------------------------------------

const W = 108, H = 108;

function TemplateThumbnail({ id }: { id: TemplateId }) {
  switch (id) {
    case "festival_greeting":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
          <rect width={W} height={H} fill="#1e293b" />
          {/* center panel */}
          <rect x="6" y="28" width="96" height="52" fill="#0f172a" opacity="0.88" rx="2" />
          {/* logo centered top */}
          <rect x="46" y="8" width="16" height="5" fill="white" opacity="0.55" rx="1" />
          {/* headline */}
          <rect x="18" y="35" width="72" height="7" fill="white" opacity="0.9" rx="1" />
          {/* subline */}
          <rect x="26" y="46" width="56" height="4" fill="white" opacity="0.6" rx="1" />
          {/* supporting */}
          <rect x="34" y="64" width="40" height="3" fill="white" opacity="0.38" rx="1" />
          {/* gold frame */}
          <rect x="2" y="2" width="104" height="104" fill="none" stroke="#d4af37" strokeWidth="2" />
        </svg>
      );
    case "product_highlight":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
          <rect width={W} height={H} fill="#1e293b" />
          {/* logo top-right */}
          <rect x="88" y="6" width="14" height="5" fill="white" opacity="0.55" rx="1" />
          {/* bottom panel */}
          <rect x="0" y="68" width="108" height="40" fill="#0f172a" opacity="0.92" />
          {/* headline */}
          <rect x="6" y="71" width="76" height="7" fill="white" opacity="0.9" rx="1" />
          {/* subline */}
          <rect x="6" y="81" width="56" height="4" fill="white" opacity="0.6" rx="1" />
          {/* supporting */}
          <rect x="6" y="88" width="40" height="3" fill="white" opacity="0.38" rx="1" />
        </svg>
      );
    case "quote_thought":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
          <rect width={W} height={H} fill="#1e293b" />
          {/* large headline centered — no panel */}
          <rect x="8" y="34" width="92" height="8" fill="white" opacity="0.9" rx="1" />
          {/* subline */}
          <rect x="16" y="46" width="76" height="4" fill="white" opacity="0.6" rx="1" />
          {/* supporting */}
          <rect x="28" y="53" width="52" height="3" fill="white" opacity="0.38" rx="1" />
          {/* logo bottom center */}
          <rect x="34" y="94" width="40" height="5" fill="white" opacity="0.5" rx="1" />
        </svg>
      );
    case "announcement":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
          <rect width={W} height={H} fill="#1e293b" />
          {/* top panel */}
          <rect x="0" y="0" width="108" height="48" fill="#0f172a" opacity="0.92" />
          {/* headline */}
          <rect x="6" y="8" width="96" height="9" fill="white" opacity="0.9" rx="1" />
          {/* subline */}
          <rect x="6" y="21" width="80" height="4" fill="white" opacity="0.6" rx="1" />
          {/* supporting */}
          <rect x="6" y="28" width="60" height="3" fill="white" opacity="0.38" rx="1" />
          {/* logo bottom-right */}
          <rect x="88" y="92" width="14" height="5" fill="white" opacity="0.5" rx="1" />
          {/* indigo frame */}
          <rect x="1.5" y="1.5" width="105" height="105" fill="none" stroke="#6366f1" strokeWidth="1.5" />
        </svg>
      );
    case "minimal_brand":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
          <rect width={W} height={H} fill="#1e293b" />
          {/* logo top-left */}
          <rect x="6" y="6" width="15" height="5" fill="white" opacity="0.55" rx="1" />
          {/* headline bottom-left */}
          <rect x="6" y="82" width="72" height="8" fill="white" opacity="0.9" rx="1" />
          {/* subline */}
          <rect x="6" y="93" width="56" height="4" fill="white" opacity="0.6" rx="1" />
          {/* supporting */}
          <rect x="6" y="100" width="44" height="3" fill="white" opacity="0.38" rx="1" />
        </svg>
      );
    case "carousel_cover":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
          <rect width={W} height={H} fill="#1e293b" />
          {/* full overlay */}
          <rect width={W} height={H} fill="#0f172a" opacity="0.72" />
          {/* logo centered top */}
          <rect x="44" y="8" width="20" height="6" fill="white" opacity="0.55" rx="1" />
          {/* big display headline */}
          <rect x="6" y="31" width="96" height="14" fill="white" opacity="0.9" rx="1" />
          {/* subline */}
          <rect x="16" y="48" width="76" height="5" fill="white" opacity="0.7" rx="1" />
          {/* supporting */}
          <rect x="26" y="56" width="56" height="3" fill="white" opacity="0.38" rx="1" />
          {/* white frame */}
          <rect x="1.5" y="1.5" width="105" height="105" fill="none" stroke="white" strokeWidth="1.5" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Sidebar primitives
// ---------------------------------------------------------------------------

function SidebarSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      {title && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      )}
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs w-16 shrink-0 text-muted-foreground">{label}</Label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = hexToOpaque(value);
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={e => onChange(e.target.value)}
          className="h-7 w-10 rounded border cursor-pointer flex-none"
        />
        <span className="text-[10px] font-mono text-muted-foreground uppercase">{hex.slice(1)}</span>
      </div>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ArtworkEditorProps {
  layers: ArtworkLayers;
  onChange: (layers: ArtworkLayers) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
  initialHeadline?: string;
  initialSubline?: string;
  initialSupportingLine?: string;
  initialBgUrl?: string;
  initialLogoUrl?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ArtworkEditor({
  layers,
  onChange,
  stageRef,
  initialHeadline = "",
  initialSubline = "",
  initialSupportingLine = "",
  initialBgUrl = "",
  initialLogoUrl = "",
}: ArtworkEditorProps) {
  const [selectedId, setSelectedId] = useState<LayerId | null>(null);

  // Node refs
  const bgRef = useRef<Konva.Image>(null);
  const bgFallbackRef = useRef<Konva.Rect>(null);
  const panelRef = useRef<Konva.Rect>(null);
  const headlineRef = useRef<Konva.Text>(null);
  const sublineRef = useRef<Konva.Text>(null);
  const supportingLineRef = useRef<Konva.Text>(null);
  const logoRef = useRef<Konva.Image | null>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const [textEdit, setTextEdit] = useState<{
    layerId: TextLayerId;
    top: number; left: number; width: number; fontSize: number; color: string;
  } | null>(null);

  // Derived order + visibility sets
  const effectiveOrder: string[] = (layers.layerOrder && layers.layerOrder.length > 0)
    ? layers.layerOrder
    : [...DEFAULT_LAYER_ORDER];
  const hiddenSet = new Set(layers.hiddenLayers ?? []);
  const lockedSet = new Set(layers.lockedLayers ?? []);

  // Images
  const bgImage = useKonvaImage(layers.background.url || null);
  const logoImage = useTintedLogoImage(
    layers.logo.enabled ? (layers.logo.url || null) : null,
    layers.logo.colorMode ?? "original",
    layers.logo.tintColor ?? "#ffffff"
  );

  // Background geometry
  const bgFitScale = bgImage
    ? Math.max(CANVAS_SIZE / bgImage.naturalWidth, CANVAS_SIZE / bgImage.naturalHeight)
    : 1;
  const bgTotalScale = bgFitScale * layers.background.scale;
  const bgW = (bgImage ? (bgImage as HTMLImageElement).naturalWidth ?? CANVAS_SIZE : CANVAS_SIZE) * bgTotalScale;
  const bgH = (bgImage ? (bgImage as HTMLImageElement).naturalHeight ?? CANVAS_SIZE : CANVAS_SIZE) * bgTotalScale;
  const bgX = (CANVAS_SIZE - bgW) / 2 + layers.background.x;
  const bgY = (CANVAS_SIZE - bgH) / 2 + layers.background.y;

  // Updaters
  const upd = useCallback(<K extends keyof ArtworkLayers>(key: K, val: Partial<ArtworkLayers[K]>) => {
    onChange({ ...layers, [key]: { ...layers[key], ...val } } as ArtworkLayers);
  }, [layers, onChange]);

  // Layer order helpers
  function reorder(newOrder: string[]) {
    onChange({ ...layers, layerOrder: newOrder });
  }

  function bringForward(id: string) {
    const o = [...effectiveOrder];
    const i = o.indexOf(id);
    if (i < o.length - 1) { [o[i], o[i + 1]] = [o[i + 1], o[i]]; reorder(o); }
  }
  function sendBackward(id: string) {
    const o = [...effectiveOrder];
    const i = o.indexOf(id);
    if (i > 0) { [o[i], o[i - 1]] = [o[i - 1], o[i]]; reorder(o); }
  }
  function bringToFront(id: string) {
    reorder([...effectiveOrder.filter(x => x !== id), id]);
  }
  function sendToBack(id: string) {
    reorder([id, ...effectiveOrder.filter(x => x !== id)]);
  }
  function toggleHidden(id: string) {
    const s = new Set(hiddenSet);
    s.has(id) ? s.delete(id) : s.add(id);
    onChange({ ...layers, hiddenLayers: [...s] });
  }
  function toggleLocked(id: string) {
    const s = new Set(lockedSet);
    s.has(id) ? s.delete(id) : s.add(id);
    onChange({ ...layers, lockedLayers: [...s] });
  }

  // Transformer — attach to selected node
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const nodeMap: Partial<Record<LayerId, Konva.Node | null>> = {
      panel: panelRef.current,
      headline: headlineRef.current,
      subline: sublineRef.current,
      supportingLine: supportingLineRef.current,
      logo: logoRef.current,
      background: bgRef.current ?? bgFallbackRef.current,
    };
    const node = selectedId ? nodeMap[selectedId] : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId]);

  // Text editing
  function startTextEdit(layerId: TextLayerId) {
    if (lockedSet.has(layerId)) return;
    const nodeRef = layerId === "headline" ? headlineRef : layerId === "subline" ? sublineRef : supportingLineRef;
    const node = nodeRef.current;
    const stage = stageRef.current;
    if (!node || !stage) return;
    const rect = node.getClientRect({ relativeTo: stage });
    const stageDom = stage.container().getBoundingClientRect();
    const tl = layers[layerId];
    setTextEdit({
      layerId,
      top: stageDom.top + rect.y,
      left: stageDom.left + rect.x,
      width: rect.width,
      fontSize: tl.fontSize * SCALE,
      color: hexToOpaque(tl.color),
    });
    node.visible(false);
    stage.batchDraw();
  }

  function commitTextEdit(value: string) {
    if (!textEdit) return;
    upd(textEdit.layerId, { text: value });
    const nodeRef = textEdit.layerId === "headline" ? headlineRef : textEdit.layerId === "subline" ? sublineRef : supportingLineRef;
    nodeRef.current?.visible(true);
    stageRef.current?.batchDraw();
    setTextEdit(null);
  }

  // Drag handlers
  function onBgDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    upd("background", {
      x: e.target.x() - (CANVAS_SIZE - bgW) / 2,
      y: e.target.y() - (CANVAS_SIZE - bgH) / 2,
    });
  }
  function onPanelDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    upd("panel", { x: e.target.x(), y: e.target.y() });
  }
  function onTextDragEnd(id: TextLayerId, e: Konva.KonvaEventObject<DragEvent>) {
    upd(id, { x: e.target.x(), y: e.target.y() });
  }
  function onLogoDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    upd("logo", { x: e.target.x(), y: e.target.y() });
  }

  // Transform handlers
  function onPanelTransformEnd() {
    const n = panelRef.current;
    if (!n) return;
    const sx = n.scaleX(), sy = n.scaleY();
    n.scaleX(1); n.scaleY(1);
    upd("panel", { x: n.x(), y: n.y(), width: Math.max(40, n.width() * sx), height: Math.max(20, n.height() * sy) });
  }
  function onTextTransformEnd(id: TextLayerId) {
    const n = (id === "headline" ? headlineRef : id === "subline" ? sublineRef : supportingLineRef).current;
    if (!n) return;
    const sx = n.scaleX();
    n.scaleX(1);
    upd(id, { x: n.x(), y: n.y(), width: Math.max(80, n.width() * sx) });
  }
  function onLogoTransformEnd() {
    const n = logoRef.current;
    if (!n) return;
    const sx = n.scaleX(), sy = n.scaleY();
    n.scaleX(1); n.scaleY(1);
    upd("logo", { x: n.x(), y: n.y(), width: Math.max(40, n.width() * sx), height: Math.max(20, n.height() * sy) });
  }

  function onStageClick(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.target === e.target.getStage()) setSelectedId(null);
  }

  // ---------------------------------------------------------------------------
  // Canvas layer nodes — rendered in effectiveOrder
  // ---------------------------------------------------------------------------

  function renderLayerNode(id: string): React.ReactNode {
    const hidden = hiddenSet.has(id);
    const locked = lockedSet.has(id);
    const drag = !locked;

    if (id === "background") {
      return (
        <>
          <Rect
            ref={bgFallbackRef}
            x={0} y={0}
            width={CANVAS_SIZE} height={CANVAS_SIZE}
            fill={layers.background.color}
            visible={!hidden}
            onClick={() => !locked && setSelectedId("background")}
            draggable={drag && !bgImage}
          />
          {bgImage && (
            <KonvaImage
              ref={bgRef}
              image={bgImage as HTMLImageElement}
              x={bgX} y={bgY}
              width={bgW / bgTotalScale}
              height={bgH / bgTotalScale}
              scaleX={bgTotalScale}
              scaleY={bgTotalScale}
              draggable={drag}
              visible={!hidden}
              onClick={() => !locked && setSelectedId("background")}
              onDragEnd={onBgDragEnd}
              stroke={selectedId === "background" ? "#6366f1" : undefined}
              strokeWidth={selectedId === "background" ? 4 / SCALE : 0}
            />
          )}
        </>
      );
    }

    if (id === "panel") {
      return (
        <Rect
          ref={panelRef}
          x={layers.panel.x}
          y={layers.panel.y}
          width={layers.panel.width}
          height={layers.panel.height}
          fill={hexToOpaque(layers.panel.color)}
          opacity={layers.panel.opacity}
          visible={!hidden && layers.panel.enabled}
          draggable={drag}
          onClick={() => !locked && setSelectedId("panel")}
          onDragEnd={onPanelDragEnd}
          onTransformEnd={onPanelTransformEnd}
        />
      );
    }

    if (id === "frame") {
      return (
        <Rect
          x={layers.frame.width / 2}
          y={layers.frame.width / 2}
          width={CANVAS_SIZE - layers.frame.width}
          height={CANVAS_SIZE - layers.frame.width}
          stroke={hexToOpaque(layers.frame.color)}
          strokeWidth={layers.frame.width}
          visible={!hidden && layers.frame.enabled}
          listening={false}
        />
      );
    }

    if (id === "headline" || id === "subline" || id === "supportingLine") {
      const tl = layers[id as TextLayerId];
      const ref = id === "headline" ? headlineRef : id === "subline" ? sublineRef : supportingLineRef;
      const placeholder = id === "headline" ? "Headline" : id === "subline" ? "Supporting text" : "";
      const showNode = !!tl.text || selectedId === id || id !== "supportingLine";
      if (!showNode) return null;
      return (
        <Text
          ref={ref}
          x={tl.x} y={tl.y}
          width={tl.width}
          text={tl.text || placeholder}
          fontSize={tl.fontSize}
          fontFamily={tl.fontFamily}
          fontStyle={konvaFontStyle(tl.fontWeight)}
          fill={hexToOpaque(tl.color)}
          align={tl.align}
          draggable={drag}
          visible={!hidden}
          onClick={() => !locked && setSelectedId(id as LayerId)}
          onDblClick={() => startTextEdit(id as TextLayerId)}
          onDragEnd={e => onTextDragEnd(id as TextLayerId, e)}
          onTransformEnd={() => onTextTransformEnd(id as TextLayerId)}
        />
      );
    }

    if (id === "logo") {
      return (
        <>
          {layers.logo.enabled && logoImage && (
            <KonvaImage
              ref={(node) => { (logoRef as React.MutableRefObject<Konva.Image | null>).current = node; }}
              image={logoImage as HTMLImageElement}
              x={layers.logo.x}
              y={layers.logo.y}
              width={layers.logo.width}
              height={layers.logo.height}
              draggable={drag}
              visible={!hidden}
              onClick={() => !locked && setSelectedId("logo")}
              onDragEnd={onLogoDragEnd}
              onTransformEnd={onLogoTransformEnd}
            />
          )}
          {layers.logo.enabled && !logoImage && (
            <Text
              x={layers.logo.x}
              y={layers.logo.y}
              text="LOGO"
              fontSize={28}
              fontFamily="Inter"
              fontStyle="bold"
              fill="#ffffff"
              opacity={0.5}
              draggable={drag}
              visible={!hidden}
              onClick={() => !locked && setSelectedId("logo")}
              onDragEnd={onLogoDragEnd}
            />
          )}
        </>
      );
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Sidebar
  // ---------------------------------------------------------------------------

  function OrderBar({ id }: { id: string }) {
    const idx = effectiveOrder.indexOf(id);
    const isHidden = hiddenSet.has(id);
    const isLocked = lockedSet.has(id);
    return (
      <div className="flex items-center gap-2 mb-3 pb-2.5 border-b">
        <span className="text-[11px] font-semibold flex-1 text-foreground min-w-0 truncate">{layerLabel(id)}</span>
        {/* Z-order group */}
        <div className="flex gap-0.5 items-center">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" title="Send to back"
            disabled={idx === 0} onClick={() => sendToBack(id)}>
            <ChevronsDown className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" title="Send backward"
            disabled={idx === 0} onClick={() => sendBackward(id)}>
            <ChevronDown className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" title="Bring forward"
            disabled={idx === effectiveOrder.length - 1} onClick={() => bringForward(id)}>
            <ChevronUp className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" title="Bring to front"
            disabled={idx === effectiveOrder.length - 1} onClick={() => bringToFront(id)}>
            <ChevronsUp className="w-3 h-3" />
          </Button>
        </div>
        {/* Divider */}
        <div className="w-px h-4 bg-border flex-none" />
        {/* Visibility + lock */}
        <div className="flex gap-0.5 items-center">
          <Button size="sm" variant="ghost"
            className={cn("h-6 w-6 p-0", isHidden ? "text-muted-foreground/40" : "text-muted-foreground hover:text-foreground")}
            title={isHidden ? "Show layer" : "Hide layer"} onClick={() => toggleHidden(id)}>
            {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </Button>
          <Button size="sm" variant="ghost"
            className={cn("h-6 w-6 p-0", isLocked ? "text-amber-500" : "text-muted-foreground hover:text-foreground")}
            title={isLocked ? "Unlock layer" : "Lock layer"} onClick={() => toggleLocked(id)}>
            {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          </Button>
        </div>
      </div>
    );
  }

  function renderTextControls(id: TextLayerId) {
    const tl = layers[id];
    return (
      <SidebarSection>
        <OrderBar id={id} />
        <Row label="Text">
          <textarea
            value={tl.text}
            onChange={e => upd(id, { text: e.target.value })}
            rows={2}
            className="w-full text-xs border border-input rounded-md px-2 py-1.5 resize-none bg-background text-foreground"
          />
        </Row>
        <Row label="Font">
          <Select value={tl.fontFamily} onValueChange={v => upd(id, { fontFamily: v })}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_GROUPS.map(group => (
                <SelectGroup key={group.label}>
                  <SelectLabel className="text-[10px] uppercase tracking-wider">{group.label}</SelectLabel>
                  {group.fonts.map(f => (
                    <SelectItem key={f} value={f} style={{ fontFamily: f, fontSize: 13 }}>{f}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Size">
          <div className="flex items-center gap-2">
            <Slider min={12} max={120} step={2} value={[tl.fontSize]}
              onValueChange={([v]) => upd(id, { fontSize: v })} className="flex-1" />
            <span className="text-xs w-7 text-right tabular-nums font-medium">{tl.fontSize}</span>
          </div>
        </Row>
        <Row label="Style">
          <div className="flex gap-1">
            {([400, 700] as const).map(w => (
              <Button key={w} size="sm" variant={tl.fontWeight === w ? "default" : "outline"}
                className="h-7 text-xs flex-1" style={{ fontWeight: w }}
                onClick={() => upd(id, { fontWeight: w })}>
                {w === 400 ? "Regular" : "Bold"}
              </Button>
            ))}
            <div className="flex gap-1">
              {ALIGN_OPTIONS.map(({ v, label: al }) => (
                <Button key={v} size="sm" variant={tl.align === v ? "default" : "outline"}
                  className="h-7 w-8 text-xs" onClick={() => upd(id, { align: v })}>
                  {al}
                </Button>
              ))}
            </div>
          </div>
        </Row>
        <ColorRow label="Color" value={tl.color} onChange={v => upd(id, { color: v })} />
        <p className="text-[10px] text-muted-foreground pt-0.5">
          Double-click canvas to edit in place · Drag side handles to resize
        </p>
      </SidebarSection>
    );
  }

  function renderSidebar() {
    if (!selectedId) {
      return (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-muted-foreground space-y-1">
          <p className="text-xs font-medium text-foreground/70">Select a layer to edit</p>
          <p className="text-[10px] leading-relaxed">
            Click on the canvas or use a tab above.<br />
            Or choose a template below to start fresh.
          </p>
        </div>
      );
    }

    if (selectedId === "background") {
      return (
        <SidebarSection>
          <OrderBar id="background" />
          <Row label="URL">
            <Input value={layers.background.url}
              onChange={e => upd("background", { url: e.target.value })}
              placeholder="https://…" className="text-xs h-7" />
          </Row>
          <ColorRow label="Fill" value={layers.background.color}
            onChange={v => upd("background", { color: v })} />
          <Row label="Zoom">
            <div className="flex items-center gap-2">
              <Slider min={80} max={300} step={5}
                value={[Math.round(layers.background.scale * 100)]}
                onValueChange={([v]) => upd("background", { scale: v / 100 })}
                className="flex-1" />
              <span className="text-xs w-9 text-right tabular-nums font-medium">
                {Math.round(layers.background.scale * 100)}%
              </span>
            </div>
          </Row>
          <Button variant="outline" size="sm" className="w-full h-7 text-xs"
            onClick={() => upd("background", { x: 0, y: 0, scale: 1 })}>
            Center &amp; reset zoom
          </Button>
        </SidebarSection>
      );
    }

    if (selectedId === "panel") {
      return (
        <SidebarSection>
          <OrderBar id="panel" />
          <Row label="Visible">
            <Switch checked={layers.panel.enabled} onCheckedChange={v => upd("panel", { enabled: v })} />
          </Row>
          <ColorRow label="Color" value={layers.panel.color}
            onChange={v => upd("panel", { color: v })} />
          <Row label="Opacity">
            <div className="flex items-center gap-2">
              <Slider min={0} max={100} step={1}
                value={[Math.round(layers.panel.opacity * 100)]}
                onValueChange={([v]) => upd("panel", { opacity: v / 100 })}
                className="flex-1" />
              <span className="text-xs w-9 text-right tabular-nums font-medium">
                {Math.round(layers.panel.opacity * 100)}%
              </span>
            </div>
          </Row>
          <p className="text-[10px] text-muted-foreground">Drag to move · Corner handles to resize</p>
        </SidebarSection>
      );
    }

    if (selectedId === "frame") {
      return (
        <SidebarSection>
          <OrderBar id="frame" />
          <Row label="Visible">
            <Switch checked={layers.frame.enabled} onCheckedChange={v => upd("frame", { enabled: v })} />
          </Row>
          <ColorRow label="Color" value={layers.frame.color}
            onChange={v => upd("frame", { color: v })} />
          <Row label="Width">
            <Select value={String(layers.frame.width)} onValueChange={v => upd("frame", { width: Number(v) })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[4, 8, 12, 20, 32].map(w => (
                  <SelectItem key={w} value={String(w)}>{w}px</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </SidebarSection>
      );
    }

    if (selectedId === "headline") return renderTextControls("headline");
    if (selectedId === "subline") return renderTextControls("subline");
    if (selectedId === "supportingLine") return renderTextControls("supportingLine");

    if (selectedId === "logo") {
      const { logo } = layers;
      const colorMode = logo.colorMode ?? "original";
      return (
        <SidebarSection>
          <OrderBar id="logo" />
          <Row label="Visible">
            <Switch checked={logo.enabled} onCheckedChange={v => upd("logo", { enabled: v })} />
          </Row>
          <Row label="URL">
            <Input value={logo.url} onChange={e => upd("logo", { url: e.target.value })}
              placeholder="https://…" className="text-xs h-7" />
          </Row>
          <Row label="Color">
            <div className="flex flex-wrap gap-1">
              {LOGO_COLOR_MODES.map(m => (
                <Button key={m.value} size="sm"
                  variant={colorMode === m.value ? "default" : "outline"}
                  className="h-6 text-[10px] px-2 flex-1"
                  onClick={() => upd("logo", { colorMode: m.value })}>
                  {m.label}
                </Button>
              ))}
            </div>
          </Row>
          {(colorMode === "brand" || colorMode === "accent") && (
            <ColorRow label="Tint" value={logo.tintColor ?? "#6366f1"}
              onChange={v => upd("logo", { tintColor: v })} />
          )}
          <p className="text-[10px] text-muted-foreground">Drag to move · Handles to resize</p>
        </SidebarSection>
      );
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const LAYER_TABS: Array<{ id: LayerId; label: string; title: string }> = [
    { id: "background",    label: "BG",       title: "Background image" },
    { id: "panel",         label: "Panel",    title: "Overlay panel" },
    { id: "frame",         label: "Frame",    title: "Border frame" },
    { id: "headline",      label: "Headline", title: "Primary headline text" },
    { id: "subline",       label: "Subline",  title: "Secondary text" },
    { id: "supportingLine",label: "Caption",  title: "Caption / supporting text" },
    { id: "logo",          label: "Logo",     title: "Logo image" },
  ];

  return (
    <div className="flex gap-5 items-start">
      {/* ── Canvas column ── */}
      <div className="flex-none space-y-2.5">
        {/* Canvas */}
        <div
          className="border border-border rounded-xl overflow-hidden shadow-lg ring-1 ring-black/5"
          style={{ width: CANVAS_DISPLAY, height: CANVAS_DISPLAY }}
        >
          <Stage
            ref={stageRef}
            width={CANVAS_DISPLAY}
            height={CANVAS_DISPLAY}
            scaleX={SCALE}
            scaleY={SCALE}
            onClick={onStageClick}
          >
            <Layer>
              {effectiveOrder.map(id => (
                <Fragment key={id}>{renderLayerNode(id)}</Fragment>
              ))}
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                keepRatio={false}
                enabledAnchors={
                  selectedId === "headline" || selectedId === "subline" || selectedId === "supportingLine"
                    ? ["middle-left", "middle-right"]
                    : ["top-left", "top-right", "bottom-left", "bottom-right",
                       "middle-left", "middle-right", "top-center", "bottom-center"]
                }
                boundBoxFunc={(_, newBox) => ({
                  ...newBox,
                  width: Math.max(40, newBox.width),
                  height: Math.max(10, newBox.height),
                })}
              />
            </Layer>
          </Stage>
        </div>

        {/* Frame quick-toggle */}
        <div className="flex items-center gap-2.5 px-0.5">
          <Switch id="frame-toggle" checked={layers.frame.enabled}
            onCheckedChange={v => upd("frame", { enabled: v })} />
          <Label htmlFor="frame-toggle" className="text-xs cursor-pointer text-muted-foreground">
            Frame border
          </Label>
          {layers.frame.enabled && (
            <>
              <input type="color" value={hexToOpaque(layers.frame.color)}
                onChange={e => upd("frame", { color: e.target.value })}
                className="h-6 w-8 rounded border cursor-pointer flex-none" />
              <Select value={String(layers.frame.width)}
                onValueChange={v => upd("frame", { width: Number(v) })}>
                <SelectTrigger className="h-6 text-xs w-16"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[4, 8, 12, 20, 32].map(w => (
                    <SelectItem key={w} value={String(w)}>{w}px</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 pt-0.5">

        {/* Layer selector tabs */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Layer
          </p>
          <div className="flex flex-wrap gap-1.5">
            {LAYER_TABS.map(({ id, label, title }) => {
              const isHidden = hiddenSet.has(id);
              const isLocked = lockedSet.has(id);
              return (
                <Button
                  key={id}
                  size="sm"
                  title={title}
                  variant={selectedId === id ? "default" : "outline"}
                  className={cn(
                    "h-7 text-[11px] px-2.5 transition-all",
                    selectedId === id && "shadow-sm",
                    isHidden && "opacity-40",
                    isLocked && "border-amber-400/80",
                  )}
                  onClick={() => setSelectedId(id)}
                >
                  {label}
                  {isLocked && <span className="ml-1 opacity-60">·</span>}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Layer-specific controls */}
        <div className="min-h-[80px]">
          {renderSidebar()}
        </div>

        {/* ── Divider ── */}
        <div className="border-t border-border/60" />

        {/* Template grid */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Templates
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TEMPLATE_META) as TemplateId[]).map(tid => (
              <button
                key={tid}
                title={TEMPLATE_META[tid].description}
                onClick={() => onChange(applyTemplate(tid, layers))}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border border-border p-1.5",
                  "hover:border-primary/60 hover:bg-accent/50 hover:shadow-sm",
                  "active:scale-[0.97] transition-all cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                )}
              >
                <div className="w-full aspect-square rounded-lg overflow-hidden bg-slate-900 shadow-sm">
                  <TemplateThumbnail id={tid} />
                </div>
                <span className="text-[10px] font-medium text-center leading-tight text-foreground/80 w-full">
                  {TEMPLATE_META[tid].label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Layout adjustments */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Adjust layout
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PRESET_LABELS) as PresetId[]).map(pid => (
              <Button key={pid} size="sm" variant="outline" className="h-7 text-[11px] px-2.5"
                onClick={() => onChange(applyPreset(pid, layers))}>
                {PRESET_LABELS[pid]}
              </Button>
            ))}
            <Button
              size="sm" variant="ghost"
              className="h-7 text-[11px] px-2.5 text-muted-foreground ml-auto"
              onClick={() => onChange(defaultLayers({
                backgroundUrl: initialBgUrl, logoUrl: initialLogoUrl,
                headline: initialHeadline, subline: initialSubline, supportingLine: initialSupportingLine,
              }))}>
              Reset all
            </Button>
          </div>
        </div>

      </div>

      {/* Floating textarea for in-canvas text editing */}
      {textEdit && (
        <textarea
          autoFocus
          defaultValue={layers[textEdit.layerId].text}
          style={{
            position: "fixed",
            top: textEdit.top,
            left: textEdit.left,
            width: textEdit.width,
            minHeight: 32,
            fontSize: textEdit.fontSize,
            color: textEdit.color,
            background: "rgba(0,0,0,0.3)",
            border: "1.5px dashed rgba(255,255,255,0.7)",
            outline: "none",
            padding: "2px 6px",
            zIndex: 9999,
            fontFamily: layers[textEdit.layerId].fontFamily,
            resize: "none",
            lineHeight: 1.3,
            borderRadius: 4,
          }}
          onBlur={e => commitTextEdit(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === "Escape") commitTextEdit(e.currentTarget.value); }}
        />
      )}
    </div>
  );
}
