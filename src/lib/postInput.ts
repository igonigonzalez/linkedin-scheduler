import { COMMENT_LIMIT, POST_LIMIT } from "@/lib/limits";

export type MediaIn = {
  type: "image" | "video" | "document";
  path: string;
  url: string;
  title?: string;
};

const MEDIA_TYPES = new Set<MediaIn["type"]>(["image", "video", "document"]);

export function normalizeComment(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function validateContent(body: string, firstComment: string | null): string | null {
  if (!body.trim()) return "El texto del post es obligatorio";
  if (body.length > POST_LIMIT) return `El post supera los ${POST_LIMIT} caracteres`;
  if (firstComment && firstComment.length > COMMENT_LIMIT) {
    return `El primer comentario supera los ${COMMENT_LIMIT} caracteres`;
  }
  return null;
}

export function validateSchedule(scheduledAt: string): string | null {
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) return "Fecha de programación no válida";
  return null;
}

export function validateMedia(media: MediaIn[] | undefined): string | null {
  if (!media?.length) return null;
  for (const item of media) {
    if (!MEDIA_TYPES.has(item.type) || !item.path || !item.url) return "Media no válido";
    if (item.path.includes("..") || item.path.startsWith("/") || item.path.includes("\\")) {
      return "Ruta de media no válida";
    }
  }
  const exclusive = media.filter((item) => item.type === "video" || item.type === "document");
  if (exclusive.length > 1 || (exclusive.length === 1 && media.length > 1)) {
    return "Un vídeo o documento va solo: uno por post y sin mezclar con imágenes";
  }
  return null;
}
