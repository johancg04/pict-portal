"use client";

import { RefObject, useEffect } from "react";

/**
 * Behaviour shared by the small floating panels (design picker, scoring help,
 * sound panel): move focus into the panel when it opens, and close it on Esc
 * (returning focus to its button) or on a press outside it.
 */
export function useSheet(
  open: boolean,
  close: () => void,
  buttonRef: RefObject<HTMLElement | null>,
  sheetRef: RefObject<HTMLElement | null>,
  focusSelector = "button",
) {
  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>(focusSelector)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!sheetRef.current?.contains(t) && !buttonRef.current?.contains(t)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
    // `close` is a stable setter wrapper in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
