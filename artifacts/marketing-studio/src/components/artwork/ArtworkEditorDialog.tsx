import { useRef, useState } from "react";
import type Konva from "konva";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import ArtworkEditor, { CANVAS_SIZE, CANVAS_DISPLAY } from "./ArtworkEditor";
import type { ArtworkLayers } from "./types";
import { applyTemplate, defaultLayers, DEFAULT_LAYER_ORDER, type TemplateId } from "./presets";

interface PostLike {
  id: string;
  contentSchema?: unknown;
  selectedImageUrl?: string | null;
  topic?: string | null;
}

function asRecord(val: unknown): Record<string, any> {
  return val && typeof val === "object" && !Array.isArray(val) ? val as Record<string, any> : {};
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function isTemplateId(value: unknown): value is TemplateId {
  return ["festival_greeting", "product_highlight", "quote_thought", "announcement", "minimal_brand", "carousel_cover"].includes(String(value));
}

function cleanPalette(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(String)
    .map((color) => color.trim())
    .filter((color) => /^#[0-9a-f]{6}$/i.test(color))
    .slice(0, 4);
}

function applyPalette(layers: ArtworkLayers, palette: string[]): ArtworkLayers {
  if (!palette.length) return layers;
  const [primary, secondary, accent] = palette;
  return {
    ...layers,
    panel: primary ? { ...layers.panel, color: primary } : layers.panel,
    frame: accent ? { ...layers.frame, color: accent, enabled: layers.frame.enabled } : layers.frame,
    headline: secondary ? { ...layers.headline, color: secondary } : layers.headline,
    subline: secondary ? { ...layers.subline, color: `${secondary}cc` } : layers.subline,
    supportingLine: secondary ? { ...layers.supportingLine, color: `${secondary}99` } : layers.supportingLine,
  };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/png";
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export interface ArtworkEditorDialogProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientLogoUrl?: string | null;
  post: PostLike | null;
  onSave: (blob: Blob, layers: ArtworkLayers) => Promise<void>;
}

function EditorContent({
  post,
  clientLogoUrl,
  onSave,
  onClose,
}: {
  post: PostLike;
  clientLogoUrl?: string | null;
  onSave: (blob: Blob, layers: ArtworkLayers) => Promise<void>;
  onClose: () => void;
}) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const [saving, setSaving] = useState(false);

  const schema = asRecord(post.contentSchema);
  const existingLayers = asRecord(schema.artworkLayers);
  const artworkSuggestion = asRecord(schema.artworkSuggestion);
  const recommendedTemplate = firstString(schema.recommendedTemplate, artworkSuggestion.layoutSuggestion);
  const recommendedPalette = cleanPalette(schema.recommendedPalette ?? artworkSuggestion.recommendedPalette ?? schema.brandColorsUsed);
  const hasAiPreparedLayout = schema.aiPreparedArtworkLayout === true || !!schema.artworkSuggestion;

  const initialBgUrl =
    firstString(schema.backgroundImageUrl, post.selectedImageUrl, schema.imageUrl) ?? "";

  // Logo resolution: saved layers → contentSchema fields → actual client logo
  const initialLogoUrl =
    firstString(
      typeof existingLayers.logo === "object" ? existingLayers.logo?.url : null,
      schema.logoUrl,
      schema.brandLogoUrl,
      clientLogoUrl
    ) ?? "";

  const initialHeadline =
    firstString(
      typeof existingLayers.headline === "object"
        ? existingLayers.headline?.text
        : existingLayers.headline,
      schema.headline,
      artworkSuggestion.headline,
      post.topic
    ) ?? "";

  const initialSubline =
    firstString(
      typeof existingLayers.subline === "object"
        ? existingLayers.subline?.text
        : existingLayers.subline,
      schema.subline,
      artworkSuggestion.subline
    ) ?? "";

  const initialSupportingLine =
    firstString(
      typeof existingLayers.supportingLine === "object"
        ? existingLayers.supportingLine?.text
        : existingLayers.supportingLine,
      schema.supportingLine,
      artworkSuggestion.supportingLine
    ) ?? "";

  // Use saved full layers if they include the new structure; else build from defaults
  const hasFullLayers =
    existingLayers.background &&
    typeof existingLayers.headline === "object" &&
    existingLayers.headline?.text !== undefined &&
    existingLayers.supportingLine !== undefined;

  const [layers, setLayers] = useState<ArtworkLayers>(() => {
    if (hasFullLayers) {
      // Migrate: ensure supportingLine exists (older saves won't have it)
      const saved = existingLayers as unknown as ArtworkLayers;
      let migrated = { ...saved };
      const hasSupportingLine = migrated.supportingLine &&
        typeof migrated.supportingLine === "object" &&
        "text" in migrated.supportingLine;
      if (!hasSupportingLine) {
        const fresh = defaultLayers({ backgroundUrl: initialBgUrl, logoUrl: initialLogoUrl, headline: initialHeadline, subline: initialSubline });
        migrated = { ...migrated, supportingLine: fresh.supportingLine };
      }
      if (!migrated.layerOrder || migrated.layerOrder.length === 0) {
        migrated = { ...migrated, layerOrder: [...DEFAULT_LAYER_ORDER] };
      }
      // Also inject client logo if the saved logo url is empty
      if (!migrated.logo?.url && initialLogoUrl) {
        migrated = { ...migrated, logo: { ...migrated.logo, url: initialLogoUrl, enabled: true } };
      }
      return migrated;
    }
    const fresh = defaultLayers({
      backgroundUrl: initialBgUrl,
      logoUrl: initialLogoUrl,
      headline: initialHeadline,
      subline: initialSubline,
      supportingLine: initialSupportingLine,
    });
    const templated = isTemplateId(recommendedTemplate) ? applyTemplate(recommendedTemplate, fresh) : fresh;
    return applyPalette(templated, recommendedPalette);
  });

  const handleSave = async () => {
    if (!stageRef.current) return;
    setSaving(true);
    try {
      const stage = stageRef.current;

      // --- Clean export: hide transformer handles + selection strokes ---
      const transformers = stage.find("Transformer");
      transformers.forEach((t: any) => t.hide());

      // Save and clear any selection stroke on Image nodes (bg selection ring)
      const images = stage.find("Image");
      const savedStrokes: Array<{ node: any; stroke: string | undefined; sw: number }> = [];
      images.forEach((img: any) => {
        const s = img.stroke();
        if (s) {
          savedStrokes.push({ node: img, stroke: s, sw: img.strokeWidth() });
          img.stroke(undefined);
          img.strokeWidth(0);
        }
      });

      await document.fonts.ready;
      stage.draw(); // synchronous redraw without selection

      const dataUrl = stage.toDataURL({ pixelRatio: CANVAS_SIZE / CANVAS_DISPLAY });

      // Restore
      transformers.forEach((t: any) => t.show());
      savedStrokes.forEach(({ node, stroke, sw }) => {
        node.stroke(stroke);
        node.strokeWidth(sw);
      });
      stage.draw();
      // --- End clean export ---

      const blob = dataUrlToBlob(dataUrl);
      await onSave(blob, layers);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ArtworkEditor
        layers={layers}
        onChange={setLayers}
        stageRef={stageRef}
        initialHeadline={initialHeadline}
        initialSubline={initialSubline}
        initialSupportingLine={initialSupportingLine}
        initialBgUrl={initialBgUrl}
        initialLogoUrl={initialLogoUrl}
      />
      {hasAiPreparedLayout && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">AI prepared this artwork layout</Badge>
          {isTemplateId(recommendedTemplate) && <span>Template: {recommendedTemplate.replace(/_/g, " ")}</span>}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rendering…</>
          ) : (
            "Save Final Artwork"
          )}
        </Button>
      </div>
    </>
  );
}

export default function ArtworkEditorDialog({
  open,
  onClose,
  clientLogoUrl,
  post,
  onSave,
}: ArtworkEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[960px] w-full overflow-auto max-h-[95vh]">
        <DialogHeader>
          <DialogTitle>Edit Artwork</DialogTitle>
        </DialogHeader>
        {post && (
          <EditorContent
            key={post.id}
            post={post}
            clientLogoUrl={clientLogoUrl}
            onSave={onSave}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
