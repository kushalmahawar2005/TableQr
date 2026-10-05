"use client";

import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type SidebarContextValue = { open: boolean; setOpen: (open: boolean) => void };
const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used inside <Sidebar>");
  return context;
}

export function Sidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <SidebarContext.Provider value={{ open, setOpen }}>{children}</SidebarContext.Provider>;
}

export function SidebarBody({ children, className }: { children: ReactNode; className?: string }) {
  return <><DesktopSidebar className={className}>{children}</DesktopSidebar><MobileSidebar className={className}>{children}</MobileSidebar></>;
}

/** Icon rail by default; expands to 300px on hover or keyboard focus. */
function DesktopSidebar({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen } = useSidebar();
  return <motion.aside
    initial={false}
    animate={{ width: open ? 300 : 68 }}
    transition={{ type: "spring", stiffness: 380, damping: 36 }}
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => setOpen(false)}
    onFocus={() => setOpen(true)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    className={cn("sticky top-0 hidden h-svh shrink-0 flex-col overflow-hidden border-r border-border bg-background px-3 py-4 md:flex", className)}
  >{children}</motion.aside>;
}

/** Top bar with a hamburger; opens a full-screen slide-in drawer. */
function MobileSidebar({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen } = useSidebar();
  return <div className="flex h-14 w-full shrink-0 items-center justify-between border-b border-border bg-background px-4 md:hidden">
    <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-hover"><Menu className="size-5" /></button>
    <AnimatePresence>
      {open && <motion.div
        initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        role="dialog" aria-modal="true"
        className={cn("fixed inset-0 z-50 flex flex-col bg-background px-5 py-5", className)}
      >
        <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-4 top-4 grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-hover"><X className="size-5" /></button>
        {children}
      </motion.div>}
    </AnimatePresence>
  </div>;
}

/** Label that only shows while the rail is expanded (always on mobile). */
export function SidebarLabel({ children, className }: { children: ReactNode; className?: string }) {
  const { open } = useSidebar();
  return <motion.span
    initial={false}
    animate={{ opacity: open ? 1 : 0, x: open ? 0 : -6 }}
    transition={{ duration: 0.15 }}
    className={cn("min-w-0 truncate whitespace-nowrap", className)}
  >{children}</motion.span>;
}

export function SidebarLink({ icon, label, active, onClick, className, ...props }: { icon: ReactNode; label: string; active?: boolean; onClick?: () => void } & Omit<ComponentProps<"button">, "onClick">) {
  const { setOpen } = useSidebar();
  return <button
    type="button"
    {...props}
    aria-current={active ? "page" : undefined}
    onClick={() => { onClick?.(); setOpen(false); }}
    className={cn(
      "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium outline-none transition-colors",
      "focus-visible:ring-2 focus-visible:ring-ring",
      active ? "bg-[#5b42f5]/10 text-[#5b42f5]" : "text-muted-foreground hover:bg-hover hover:text-foreground",
      className,
    )}
  >
    <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center">{icon}</span>
    <SidebarLabel>{label}</SidebarLabel>
  </button>;
}
