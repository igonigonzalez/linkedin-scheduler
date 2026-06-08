"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import type { Account, Post } from "@/lib/types";

const POST_LIMIT = 3000;
const COMMENT_LIMIT = 1250;
const TOAST_MS = 4500;
const BODY_PREVIEW_LINES = 4;

type Selected = { file: File; preview: string; type: "image" | "video" | "document" };

// Classify a picked file. PDFs (and other office docs) become LinkedIn "documents".
function mediaTypeOf(file: File): "image" | "video" | "document" {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || /\.(pdf|docx?|pptx?)$/.test(name)) return "document";
  return file.type.startsWith("video") ? "video" : "image";
}
type Toast = { id: number; kind: "ok" | "err"; text: string };

let toastId = 0;

/* ── SVG Icons ── */
const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

const ComposeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>
);

const QueueIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);

const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const ExternalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

function relativeTime(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const past = diff < 0;
  if (abs < 60_000) return past ? "hace un momento" : "ahora";
  if (abs < 3600_000) {
    const m = Math.round(abs / 60_000);
    return past ? `hace ${m}m` : `en ${m}m`;
  }
  if (abs < 86_400_000) {
    const h = Math.round(abs / 3600_000);
    return past ? `hace ${h}h` : `en ${h}h`;
  }
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function defaultSchedule() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CharBar({ value, limit }: { value: number; limit: number }) {
  const pct = Math.min((value / limit) * 100, 100);
  const over = value > limit;
  return (
    <div className="charbar-wrap">
      <div
        className="charbar-fill"
        style={{
          width: `${pct}%`,
          background: over ? "var(--red)" : pct > 80 ? "var(--amber)" : "var(--gradient-accent)",
        }}
      />
      <span className="charbar-label" style={{ color: over ? "var(--red)" : undefined }}>
        {value}/{limit}
      </span>
    </div>
  );
}

function CollapsibleBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const collapsed = !open && lines.length > BODY_PREVIEW_LINES;
  const shown = collapsed ? lines.slice(0, BODY_PREVIEW_LINES).join("\n") + "…" : text;
  return (
    <div className="post-body">
      <div className="body-text">{shown}</div>
      {lines.length > BODY_PREVIEW_LINES && (
        <button className="expand-btn" onClick={() => setOpen((o) => !o)}>
          {open ? "Ver menos ↑" : "Ver más ↓"}
        </button>
      )}
    </div>
  );
}

// Placeholder thumbnail for documents (PDFs have no inline preview).
function DocThumb({ name }: { name?: string | null }) {
  return (
    <div className="doc-thumb">
      <span className="doc-thumb-icon">📄</span>
      {name && <span className="doc-thumb-name">{name}</span>}
    </div>
  );
}

function DropZone({
  selected,
  onPick,
  onRemove,
}: {
  selected: Selected[];
  onPick: (files: FileList | null) => void;
  onRemove: (i: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      onPick(e.dataTransfer.files);
    },
    [onPick]
  );

  return (
    <div
      className={`dropzone${dragging ? " dragging" : ""}${selected.length ? " has-files" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,application/pdf,.pdf,.doc,.docx,.ppt,.pptx"
        multiple
        style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files)}
      />
      {selected.length === 0 ? (
        <div className="dz-placeholder">
          <span className="dz-icon">📸</span>
          <span className="dz-text">Arrastra o haz clic para añadir media</span>
          <span className="dz-hint">JPG, PNG, MP4, GIF, PDF · Máx. 1 vídeo o PDF (sin mezclar)</span>
        </div>
      ) : (
        <div className="thumbs" onClick={(e) => e.stopPropagation()}>
          {selected.map((s, i) => (
            <div className="thumb" key={i}>
              {s.type === "video" ? <video src={s.preview} />
                : s.type === "document" ? <DocThumb name={s.file.name} />
                : <img src={s.preview} alt="" />}
              <span className="tag">{s.type === "document" ? "PDF" : s.type}</span>
              <button
                className="x"
                onClick={(e) => { e.stopPropagation(); onRemove(i); }}
                type="button"
              >×</button>
            </div>
          ))}
          <div className="dz-add-more">+ añadir</div>
        </div>
      )}
    </div>
  );
}

function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="del-confirm">
      <span>¿Eliminar?</span>
      <button className="btn-inline danger" onClick={onConfirm}>Sí</button>
      <button className="btn-inline" onClick={onCancel}>No</button>
    </div>
  );
}

type View = "compose" | "queue" | "calendar";

function QueueCard({
  posts,
  pendingDel,
  setPendingDel,
  del,
  onEdit,
}: {
  posts: Post[];
  pendingDel: string | null;
  setPendingDel: (id: string | null) => void;
  del: (id: string) => void;
  onEdit: (p: Post) => void;
}) {
  return (
    <div className="card queue-card">
      <div className="card-title">
        <QueueIcon />
        Cola
        {posts.length > 0 && <span className="queue-count">{posts.length}</span>}
      </div>

      {posts.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <div className="empty-title">No hay posts programados</div>
          <div className="empty-hint">Escribe tu primer post y dale a Programar.</div>
        </div>
      )}

      <div className="post-list">
        {posts.map((p) => (
          <div key={p.id} className={`post-card status-${p.status}`}>
            <div className="post-meta">
              <span className={`badge badge-${p.status}`}>
                {p.status === "scheduled" ? "programado"
                  : p.status === "publishing" ? "publicando…"
                  : p.status === "published" ? "publicado"
                  : "error"}
              </span>
              <span className="post-time" title={new Date(p.scheduled_at).toLocaleString("es-ES")}>
                {relativeTime(p.scheduled_at)}
              </span>
              <div className="spacer" />
              <div className="post-actions">
                {p.post_urn && (
                  <a
                    className="action-link"
                    href={`https://www.linkedin.com/feed/update/${p.post_urn}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalIcon /> Ver
                  </a>
                )}
                {(p.status === "scheduled" || p.status === "failed") && pendingDel !== p.id && (
                  <button className="action-edit" onClick={() => onEdit(p)} title="Editar">✎</button>
                )}
                {pendingDel === p.id ? (
                  <DeleteConfirm onConfirm={() => del(p.id)} onCancel={() => setPendingDel(null)} />
                ) : (
                  <button className="action-del" onClick={() => setPendingDel(p.id)} title="Eliminar">✕</button>
                )}
              </div>
            </div>

            <CollapsibleBody text={p.body} />

            {p.media?.length > 0 && (
              <div className="thumbs" style={{ marginTop: 10 }}>
                {p.media.map((m) => (
                  <div className="thumb" key={m.id}>
                    {m.type === "video" ? <video src={m.url} />
                      : m.type === "document" ? <DocThumb name={m.title} />
                      : <img src={m.url} alt="" />}
                    <span className="tag">{m.type === "document" ? "PDF" : m.type}</span>
                  </div>
                ))}
              </div>
            )}

            {p.first_comment && (
              <div className="first-comment">
                <span className="fc-icon">💬</span>
                <span>{p.first_comment}</span>
              </div>
            )}

            {p.error && <div className="post-error">⚠ {p.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarView({
  posts,
  onChipClick,
  onCreate,
}: {
  posts: Post[];
  onChipClick: (p: Post) => void;
  onCreate: (prefill?: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const pad = (n: number) => String(n).padStart(2, "0");
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthName = cursor.toLocaleString("es-ES", { month: "long", year: "numeric" });
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-based
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay: Record<string, Post[]> = {};
  for (const p of posts) {
    const d = new Date(p.scheduled_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    (byDay[key] ||= []).push(p);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const t = new Date();
  const todayKey = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
  const weekdays = ["L", "M", "X", "J", "V", "S", "D"];

  return (
    <div className="card calendar-card">
      <div className="cal-header">
        <button className="cal-nav" onClick={() => setCursor(new Date(year, month - 1, 1))}>‹</button>
        <div className="cal-month">{monthName}</div>
        <button className="cal-nav" onClick={() => setCursor(new Date(year, month + 1, 1))}>›</button>
        <button className="cal-today" onClick={() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setCursor(d); }}>
          Hoy
        </button>
        <button className="cal-new" onClick={() => onCreate()}>+ Nuevo post</button>
      </div>

      <div className="cal-grid cal-weekdays">
        {weekdays.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
      </div>

      <div className="cal-grid">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="cal-cell empty" />;
          const key = `${year}-${month}-${d}`;
          const dayPosts = (byDay[key] || []).sort(
            (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
          );
          const prefill = `${year}-${pad(month + 1)}-${pad(d)}T09:00`;
          return (
            <div
              key={i}
              className={`cal-cell${key === todayKey ? " today" : ""}`}
              onClick={() => onCreate(prefill)}
              title="Clic para programar un post este día"
            >
              <div className="cal-cell-head">
                <span className="cal-daynum">{d}</span>
                <span className="cal-add">+</span>
              </div>
              <div className="cal-posts">
                {dayPosts.slice(0, 3).map((p) => (
                  <div
                    key={p.id}
                    className={`cal-chip status-${p.status}`}
                    title={p.body}
                    onClick={(e) => { e.stopPropagation(); onChipClick(p); }}
                  >
                    <span className="cal-chip-time">
                      {new Date(p.scheduled_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="cal-chip-text">{p.body.slice(0, 22)}</span>
                  </div>
                ))}
                {dayPosts.length > 3 && <div className="cal-more">+{dayPosts.length - 3} más</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PostEditorModal({
  post,
  prefill,
  account,
  onClose,
  onSaved,
  toast,
}: {
  post?: Post | null;
  prefill?: string;
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
  toast: (k: "ok" | "err", t: string) => void;
}) {
  const isEdit = !!post;
  const [body, setBody] = useState(post?.body ?? "");
  const [firstComment, setFirstComment] = useState(post?.first_comment ?? "");
  const [scheduledAt, setScheduledAt] = useState(
    post ? toLocalInput(post.scheduled_at) : prefill ?? defaultSchedule()
  );
  const [kept, setKept] = useState(post?.media ?? []);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Guardando…");

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function onPick(files: FileList | null) {
    if (!files) return;
    const next = [...selected];
    for (const file of Array.from(files)) {
      const type = mediaTypeOf(file);
      next.push({ file, preview: type === "document" ? "" : URL.createObjectURL(file), type });
    }
    // A video or document must go alone, counting media already kept on the post.
    const isExclusive = (t: string) => t === "video" || t === "document";
    const exclusiveCount =
      kept.filter((m) => isExclusive(m.type)).length + next.filter((s) => isExclusive(s.type)).length;
    const totalCount = kept.length + next.length;
    if (exclusiveCount > 1 || (exclusiveCount === 1 && totalCount > 1)) {
      toast("err", "Un vídeo o PDF va solo: uno por post y sin mezclar con imágenes.");
      return;
    }
    setSelected(next);
  }

  async function save() {
    if (!body.trim()) { toast("err", "Escribe el texto del post."); return; }
    if (body.length > POST_LIMIT) { toast("err", `El post supera los ${POST_LIMIT} caracteres.`); return; }
    setBusy(true);
    setBusyLabel("Subiendo…");
    try {
      const uploaded: { type: "image" | "video" | "document"; path: string; url: string; title?: string }[] = [];
      for (let i = 0; i < selected.length; i++) {
        const s = selected[i];
        setBusyLabel(`Subiendo media ${i + 1}/${selected.length}…`);
        const signRes = await fetch("/api/upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: s.file.name }),
        });
        const sign = await signRes.json();
        if (!signRes.ok) throw new Error(sign.error || "Fallo al subir media");
        const { error } = await supabaseBrowser.storage.from("media").uploadToSignedUrl(sign.path, sign.token, s.file);
        if (error) throw new Error(error.message);
        uploaded.push({ type: s.type, path: sign.path, url: sign.url, ...(s.type === "document" ? { title: s.file.name } : {}) });
      }
      const media = [
        ...kept.map((m) => ({ type: m.type, path: m.path, url: m.url, ...(m.title ? { title: m.title } : {}) })),
        ...uploaded,
      ];
      const payload = {
        body,
        first_comment: firstComment,
        scheduled_at: new Date(scheduledAt).toISOString(),
        media,
      };
      setBusyLabel(isEdit ? "Guardando…" : "Programando…");
      const res = isEdit
        ? await fetch(`/api/posts/${post!.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, status: "scheduled" }),
          })
        : await fetch("/api/posts", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al guardar");
      toast("ok", isEdit ? "Post actualizado ✓" : "Post programado ✓");
      onSaved();
      onClose();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            {isEdit ? <ComposeIcon /> : <ComposeIcon />}
            {isEdit ? "Editar post" : "Nuevo post"}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Texto del post</label>
            <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="¿Qué quieres compartir?" />
            <CharBar value={body.length} limit={POST_LIMIT} />
          </div>

          <div className="field">
            <label>Primer comentario <span className="label-hint">opcional · ideal para el enlace</span></label>
            <textarea rows={2} value={firstComment} onChange={(e) => setFirstComment(e.target.value)} placeholder="Se publica justo después del post." />
            <CharBar value={firstComment.length} limit={COMMENT_LIMIT} />
          </div>

          <div className="field">
            <label>Media</label>
            {kept.length > 0 && (
              <div className="thumbs" style={{ marginBottom: 8 }}>
                {kept.map((m) => (
                  <div className="thumb" key={m.id}>
                    {m.type === "video" ? <video src={m.url} />
                      : m.type === "document" ? <DocThumb name={m.title} />
                      : <img src={m.url} alt="" />}
                    <span className="tag">{m.type === "document" ? "PDF" : m.type}</span>
                    <button className="x" type="button" onClick={() => setKept((k) => k.filter((x) => x.id !== m.id))}>×</button>
                  </div>
                ))}
              </div>
            )}
            <DropZone selected={selected} onPick={onPick} onRemove={(i) => setSelected((s) => s.filter((_, idx) => idx !== i))} />
          </div>

          <div className="field">
            <label>Programar para</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
        </div>

        <div className="modal-foot">
          {!account && <span className="warn-sm">Conecta LinkedIn primero</span>}
          <div className="spacer" />
          <button className="btn-pill ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-pill primary" onClick={save} disabled={busy || !account}>
            {busy ? <><span className="spinner" />{busyLabel}</> : isEdit ? "Guardar cambios" : "Programar post"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ account, initialPosts }: { account: Account | null; initialPosts: Post[] }) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [body, setBody] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [scheduledAt, setScheduledAt] = useState(defaultSchedule());
  const [publishNow, setPublishNow] = useState(false);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Subiendo…");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingDel, setPendingDel] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<View>("compose");
  const [editor, setEditor] = useState<{ post?: Post | null; prefill?: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  function go(v: View) {
    setView(v);
    setSidebarOpen(false);
  }

  function toast(kind: "ok" | "err", text: string) {
    const id = ++toastId;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
  }

  // Auto-grow textarea
  function growTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected")) toast("ok", "Cuenta de LinkedIn conectada.");
    else if (p.get("error")) toast("err", `Error de conexión: ${p.get("error")}`);
    if (p.get("connected") || p.get("error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const expiryWarn = useMemo(() => {
    if (!account?.expires_at) return null;
    const days = Math.round((new Date(account.expires_at).getTime() - Date.now()) / 86400000);
    return days <= 7 ? `Token caduca en ${days}d — reconecta` : null;
  }, [account]);

  function onPick(files: FileList | null) {
    if (!files) return;
    const next = [...selected];
    for (const file of Array.from(files)) {
      const type = mediaTypeOf(file);
      next.push({ file, preview: type === "document" ? "" : URL.createObjectURL(file), type });
    }
    // A video or a document must go alone: one per post, never mixed with anything else.
    const exclusive = next.filter((s) => s.type === "video" || s.type === "document");
    if (exclusive.length > 1 || (exclusive.length === 1 && next.length > 1)) {
      toast("err", "Un vídeo o PDF va solo: uno por post y sin mezclar con imágenes.");
      return;
    }
    setSelected(next);
  }

  async function refresh() {
    const res = await fetch("/api/posts");
    const json = await res.json();
    if (json.posts) setPosts(json.posts);
  }

  async function uploadSelected() {
    const media: { type: "image" | "video" | "document"; path: string; url: string; title?: string }[] = [];
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i];
      setBusyLabel(`Subiendo media ${i + 1}/${selected.length}…`);
      const signRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: s.file.name }),
      });
      const sign = await signRes.json();
      if (!signRes.ok) throw new Error(sign.error || "Fallo al pedir URL de subida");
      const { error } = await supabaseBrowser.storage.from("media").uploadToSignedUrl(sign.path, sign.token, s.file);
      if (error) throw new Error(error.message);
      media.push({ type: s.type, path: sign.path, url: sign.url, ...(s.type === "document" ? { title: s.file.name } : {}) });
    }
    return media;
  }

  async function submit() {
    if (!body.trim()) { toast("err", "Escribe el texto del post."); return; }
    if (body.length > POST_LIMIT) { toast("err", `El post supera los ${POST_LIMIT} caracteres.`); return; }
    setBusy(true);
    setBusyLabel("Procesando…");
    try {
      const media = await uploadSelected();
      setBusyLabel("Publicando…");
      const scheduled_at = publishNow ? new Date().toISOString() : new Date(scheduledAt).toISOString();
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, first_comment: firstComment, scheduled_at, media }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Fallo al programar");
      setBody(""); setFirstComment(""); setSelected([]); setPublishNow(false); setScheduledAt(defaultSchedule());
      if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
      if (commentRef.current) { commentRef.current.style.height = "auto"; }
      toast("ok", publishNow ? "En cola — saldrá en ≤ 5 min." : "Post programado ✓");
      await refresh();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    await fetch(`/api/posts/${id}`, { method: "DELETE" });
    setPendingDel(null);
    await refresh();
  }

  const canSubmit = !busy && !!account && body.trim().length > 0 && body.length <= POST_LIMIT;

  const scheduledCount = posts.filter(p => p.status === "scheduled").length;
  const publishedCount = posts.filter(p => p.status === "published").length;

  return (
    <div className="app-layout">
      {/* ── Mobile sidebar toggle ── */}
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? <CloseIcon /> : <MenuIcon />}
      </button>

      {/* ── Sidebar overlay (mobile) ── */}
      <div
        className={`sidebar-overlay${sidebarOpen ? " open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ── Sidebar ── */}
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sidebar-inner">
          {/* Brand */}
          <div className="brand">
            <div className="brand-icon">
              <span className="brand-in">in</span>
            </div>
            <div className="brand-text">
              <h1>Scheduler</h1>
              <div className="sub">Posts · Comentarios · Media</div>
            </div>
          </div>

          {/* Nav */}
          <nav className="sidebar-nav">
            <button className={`nav-item${view === "compose" ? " active" : ""}`} onClick={() => go("compose")}>
              <ComposeIcon />
              <span>Compositor</span>
            </button>
            <button className={`nav-item${view === "queue" ? " active" : ""}`} onClick={() => go("queue")}>
              <QueueIcon />
              <span>Cola ({posts.length})</span>
            </button>
            <button className={`nav-item${view === "calendar" ? " active" : ""}`} onClick={() => go("calendar")}>
              <CalendarIcon />
              <span>Calendario</span>
            </button>
          </nav>

          {/* Stats mini */}
          <div style={{ marginTop: 'auto', paddingTop: 16 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
              marginBottom: 16,
            }}>
              <div style={{
                background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
                padding: '12px', textAlign: 'center',
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-bright)' }}>
                  {scheduledCount}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Pendientes
                </div>
              </div>
              <div style={{
                background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
                padding: '12px', textAlign: 'center',
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>
                  {publishedCount}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Publicados
                </div>
              </div>
            </div>
          </div>

          {/* Account (bottom) */}
          <div className="sidebar-account">
            {account ? (
              <>
                <div className="account-card">
                  {account.picture
                    ? <img src={account.picture} alt="" />
                    : <div className="avatar-placeholder">{account.name?.[0] ?? "?"}</div>
                  }
                  <div className="account-info">
                    <div className="account-name">{account.name ?? "Conectado"}</div>
                    {expiryWarn
                      ? <div className="warn-sm">{expiryWarn}</div>
                      : <div className="account-status">Conectado</div>
                    }
                  </div>
                </div>
                <a className="reconnect-btn" href="/api/auth/linkedin">
                  <RefreshIcon /> Reconectar
                </a>
              </>
            ) : (
              <div className="connect-cta">
                <p>Conecta tu cuenta para empezar</p>
                <a className="btn-connect" href="/api/auth/linkedin">
                  <LinkedInIcon /> Conectar LinkedIn
                </a>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="main-content">
        {/* Toasts */}
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              {t.kind === "ok" ? "✓" : "⚠"} {t.text}
            </div>
          ))}
        </div>

        {/* Page header */}
        <div className="page-header">
          <div className="page-title">
            <div className="page-title-icon">
              {view === "calendar" ? <CalendarIcon /> : view === "queue" ? <QueueIcon /> : <ComposeIcon />}
            </div>
            {view === "calendar" ? "Calendario" : view === "queue" ? "Cola" : "Compositor"}
          </div>
          <div className="page-subtitle">
            {view === "calendar"
              ? "Vista mensual de tus posts programados"
              : view === "queue"
              ? "Todos tus posts: programados, publicados y errores"
              : "Crea, programa y gestiona tus posts de LinkedIn"}
          </div>
        </div>

        {/* Views */}
        {view === "calendar" && (
          <CalendarView
            posts={posts}
            onChipClick={(p) => setEditor({ post: p })}
            onCreate={(prefill) => setEditor({ prefill })}
          />
        )}

        {view === "queue" && (
          <QueueCard posts={posts} pendingDel={pendingDel} setPendingDel={setPendingDel} del={del} onEdit={(p) => setEditor({ post: p })} />
        )}

        {view === "compose" && (
        <div className="grid">
          {/* ── Composer ── */}
          <div className="card">
            <div className="card-title">
              <ComposeIcon />
              Nuevo post
            </div>

            <div className="field">
              <label>Texto del post</label>
              <textarea
                ref={textareaRef}
                className="auto-grow"
                rows={6}
                value={body}
                onChange={(e) => { setBody(e.target.value); growTextarea(e.currentTarget); }}
                placeholder="¿Qué quieres compartir hoy?"
              />
              <CharBar value={body.length} limit={POST_LIMIT} />
            </div>

            <div className="field">
              <label>
                Primer comentario
                <span className="label-hint">opcional · ideal para el enlace</span>
              </label>
              <textarea
                ref={commentRef}
                className="auto-grow"
                rows={2}
                value={firstComment}
                onChange={(e) => { setFirstComment(e.target.value); growTextarea(e.currentTarget); }}
                placeholder="Se publica justo después del post."
              />
              <CharBar value={firstComment.length} limit={COMMENT_LIMIT} />
            </div>

            <div className="field">
              <label>Media</label>
              <DropZone selected={selected} onPick={onPick} onRemove={(i) => setSelected((s) => s.filter((_, idx) => idx !== i))} />
            </div>

            <div className="field">
              <div className="schedule-row">
                <label style={{ margin: 0 }}>Programar para</label>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    className="toggle-input"
                    checked={publishNow}
                    onChange={(e) => setPublishNow(e.target.checked)}
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span className="toggle-text">Ahora</span>
                </label>
              </div>
              <input
                type="datetime-local"
                value={scheduledAt}
                disabled={publishNow}
                onChange={(e) => setScheduledAt(e.target.value)}
                style={{ marginTop: 8, opacity: publishNow ? 0.4 : 1, transition: "opacity .2s" }}
              />
            </div>

            <div className="submit-row">
              {!account && <span className="warn-sm">Conecta LinkedIn primero</span>}
              <button className="btn-pill primary submit-btn" onClick={submit} disabled={!canSubmit}>
                {busy
                  ? <><span className="spinner" />{busyLabel}</>
                  : publishNow ? "Publicar ahora" : "Programar post"
                }
              </button>
            </div>
          </div>

          <QueueCard posts={posts} pendingDel={pendingDel} setPendingDel={setPendingDel} del={del} onEdit={(p) => setEditor({ post: p })} />
        </div>
        )}
      </main>

      {editor && (
        <PostEditorModal
          post={editor.post}
          prefill={editor.prefill}
          account={account}
          onClose={() => setEditor(null)}
          onSaved={refresh}
          toast={toast}
        />
      )}
    </div>
  );
}
