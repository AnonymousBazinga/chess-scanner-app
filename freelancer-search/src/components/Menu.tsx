import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  /** The trigger's contents; `className` styles the trigger button. */
  trigger: ReactNode;
  className?: string;
  label?: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}

/** A trigger and a floating panel. Closes on outside click or Escape. */
export default function Menu({ trigger, className = "ghost-button", label, align = "left", children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className={className} aria-label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu-panel ${align === "right" ? "right" : ""}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
