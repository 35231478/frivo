"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "next-auth";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";

/**
 * Drawer lateral do mobile (lg:hidden). Abre/fecha por:
 * - evento global "frivo:toggle-menu" (hamburguer no Header e "Mais" na bottom nav)
 * - swipe a partir da borda esquerda da tela (abre) e swipe para a esquerda (fecha)
 * - toque no overlay ou em qualquer link do menu
 */
export function MobileShell({ session }: { session: Session }) {
  const [aberto, setAberto] = useState(false);
  const toqueInicio = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    function toggle() { setAberto((v) => !v); }
    function abrir() { setAberto(true); }
    function fechar() { setAberto(false); }
    window.addEventListener("frivo:toggle-menu", toggle);
    window.addEventListener("frivo:open-menu", abrir);
    window.addEventListener("frivo:close-menu", fechar);
    return () => {
      window.removeEventListener("frivo:toggle-menu", toggle);
      window.removeEventListener("frivo:open-menu", abrir);
      window.removeEventListener("frivo:close-menu", fechar);
    };
  }, []);

  // Bloqueia o scroll do body enquanto o drawer está aberto
  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [aberto]);

  // Gestos de swipe (somente telas pequenas)
  useEffect(() => {
    function onStart(e: TouchEvent) {
      const t = e.touches[0];
      toqueInicio.current = { x: t.clientX, y: t.clientY };
    }
    function onEnd(e: TouchEvent) {
      const ini = toqueInicio.current;
      if (!ini || window.innerWidth >= 1024) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - ini.x;
      const dy = t.clientY - ini.y;
      if (Math.abs(dx) < 60 || Math.abs(dy) > 50) return;
      if (dx > 0 && ini.x < 28 && !aberto) setAberto(true);      // swipe da borda esquerda → abre
      else if (dx < 0 && aberto) setAberto(false);                // swipe à esquerda → fecha
      toqueInicio.current = null;
    }
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [aberto]);

  return (
    <div className="lg:hidden">
      {/* Overlay */}
      <div
        onClick={() => setAberto(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          aberto ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!aberto}
      />
      {/* Painel deslizante */}
      <div
        onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setAberto(false); }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out",
          aberto ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar session={session} variant="mobile" />
      </div>
    </div>
  );
}
