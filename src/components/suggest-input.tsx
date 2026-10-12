"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

// A text box that lists suggestions under it as you type. Pick one with a tap or the arrow keys
// and Enter; typing anything else is still allowed.

export type Suggestion = { value: string; label: string; hint?: string };

export function SuggestInput({
  id,
  name,
  required,
  placeholder,
  minChars = 1,
  suggest,
  onPick,
}: {
  id: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  minChars?: number;
  /** Suggestions for the text so far; may be async (it is called after a short pause) */
  suggest: (text: string) => Suggestion[] | Promise<Suggestion[]>;
  onPick?: (s: Suggestion) => void;
}) {
  const [value, setValue] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const latest = useRef(0);

  useEffect(() => {
    const text = value.trim();
    const ticket = ++latest.current;
    if (text.length < minChars) return;
    const t = setTimeout(async () => {
      try {
        const found = await suggest(text);
        if (ticket === latest.current) {
          setItems(found);
          setActive(-1);
        }
      } catch {
        if (ticket === latest.current) setItems([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value, minChars, suggest]);

  // Too little typed: show nothing, whatever an older search found
  const shown = value.trim().length >= minChars ? items : [];

  const pick = (s: Suggestion) => {
    setValue(s.value);
    setOpen(false);
    setItems([]);
    latest.current++;
    onPick?.(s);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        required={required}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || shown.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % shown.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? shown.length - 1 : a - 1)); }
          else if (e.key === "Enter" && active >= 0 && shown[active]) { e.preventDefault(); pick(shown[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && shown.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg">
          {shown.map((s, i) => (
            <li
              key={`${s.value}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className={`cursor-pointer rounded-md px-2.5 py-2 ${i === active ? "bg-muted" : "hover:bg-muted/60"}`}
            >
              <span className="block font-medium">{s.label}</span>
              {s.hint && <span className="block text-xs text-muted-foreground">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
