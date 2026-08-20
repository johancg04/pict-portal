"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ChatMsg } from "@/lib/types";
import PlayerBadge from "./PlayerBadge";

export type FeedItem = { id: string; content: ChatMsg };

export default function Chat({
  items,
  disabled,
  placeholder,
  onSend,
  onTyping,
}: {
  items: FeedItem[];
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  onTyping?: () => void;
}) {
  const [text, setText] = useState("");
  // The chat's own scroll container. Autoscrolling must go through THIS
  // element only: scrollIntoView() would also walk up and scroll every
  // scrollable ancestor — including the document on mobile, where the layout
  // is one tall column — yanking the canvas out from under a stroke in
  // progress every time a message lands.
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    // Follow new messages only while the reader is already at the bottom;
    // if they scrolled up to re-read guesses, don't rip them back down.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!nearBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [items.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-edge bg-panel">
      <div className="border-b border-edge px-4 py-3 text-sm font-medium text-fg/70">
        Respuestas
      </div>
      <div ref={feedRef} className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3">
        {items.map((it) => (
          <Line key={it.id} msg={it.content} />
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-edge p-3">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) onTyping?.();
          }}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-edge bg-ink px-3 py-2 text-sm outline-none placeholder:text-fg/30 focus:border-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}

function Line({ msg }: { msg: ChatMsg }) {
  if (msg.kind === "system") {
    return <p className="text-center text-xs text-fg/40">{msg.text}</p>;
  }
  if (msg.kind === "correct") {
    return (
      <p className="flex items-center gap-1.5 text-sm font-semibold text-green-400">
        {msg.ai ? "🤖" : <PlayerBadge name={msg.name} />}
        {msg.ai ? "La IA" : msg.name} acertó — «{msg.word}»
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-sm">
      {msg.ai ? (
        <span className="font-semibold text-accent">🤖 IA</span>
      ) : (
        <>
          <PlayerBadge name={msg.name} />
          <span className="font-semibold text-fg/80">{msg.name}</span>
        </>
      )}
      <span className="text-fg/50">:</span>
      <span className="text-fg/90">{msg.text}</span>
    </p>
  );
}
