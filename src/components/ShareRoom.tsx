"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { buildRoomLink } from "@/lib/room";
import { useSheet } from "@/lib/useSheet";

// "Invitar" button + a sheet with the room link, a copy button and a QR code.
// The link is <origin>/?sala=CODE; opening it lands on the join form prefilled.
export default function ShareRoom({ roomCode }: { roomCode: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useSheet(open, () => setOpen(false), btnRef, sheetRef);

  const link = typeof window === "undefined" ? "" : buildRoomLink(roomCode, window.location.origin);

  useEffect(() => {
    if (!open || !link) return;
    let alive = true;
    QRCode.toDataURL(link, { width: 480, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [open, link]);

  async function copy(text: string, what: "link" | "code") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard blocked: the link is selectable in the field below */
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: "Pict-Portal", text: `Únete a mi sala ${roomCode}`, url: link });
    } catch {
      /* cancelled */
    }
  }

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Invitar con link o QR"
        className={`pp-btn flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-edge px-2.5 text-xs font-semibold text-fg/70 hover:bg-fg/5 hover:text-fg/90 ${
          open ? "border-accent text-accent" : ""
        }`}
      >
        <span aria-hidden="true">🔗</span> Invitar
      </button>

      {open &&
        createPortal(
          <div
            ref={sheetRef}
            role="dialog"
            aria-label="Invitar a la sala"
            className="pp-skin-sheet fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-edge bg-panel p-4 text-fg shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:w-[360px] sm:rounded-2xl"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Invitar a la sala</h2>
                <p className="text-xs text-fg/60">Comparte el link o muestra el QR.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge text-fg/70 hover:bg-fg/5"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid place-items-center">
              {qr ? (
                // White background + margin: QR needs contrast in every skin/theme.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr}
                  alt={`Código QR para unirse a la sala ${roomCode}`}
                  className="h-48 w-48 rounded-xl bg-white p-2"
                />
              ) : (
                <div className="h-48 w-48 animate-pulse rounded-xl bg-fg/10" />
              )}
              <p className="mt-3 font-mono text-2xl font-bold tracking-[0.3em]">{roomCode}</p>
            </div>

            <input
              readOnly
              value={link}
              aria-label="Link de la sala"
              onFocus={(e) => e.currentTarget.select()}
              className="mt-4 w-full rounded-xl border border-edge bg-ink px-3 py-2 text-xs text-fg/80 outline-none focus:border-accent"
            />

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => copy(link, "link")}
                className="pp-btn-primary flex-1 rounded-xl bg-gradient-to-r from-accent to-purple-500 px-3 py-2 text-sm font-semibold text-white hover:brightness-110"
              >
                {copied === "link" ? "✓ Link copiado" : "Copiar link"}
              </button>
              <button
                type="button"
                onClick={() => copy(roomCode, "code")}
                className="rounded-xl border border-edge px-3 py-2 text-sm font-semibold text-fg/80 hover:bg-fg/5"
              >
                {copied === "code" ? "✓ Copiado" : "Copiar código"}
              </button>
            </div>
            {canShare && (
              <button
                type="button"
                onClick={nativeShare}
                className="mt-2 w-full rounded-xl border border-edge px-3 py-2 text-sm font-semibold text-fg/80 hover:bg-fg/5"
              >
                Compartir…
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
