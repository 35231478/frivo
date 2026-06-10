"use client";

import { useEffect, useState } from "react";
import { FrivoMark } from "@/components/layout/frivo-logo";

/**
 * Splash screen mostrada no boot do app instalado (standalone). Cobre a tela com
 * o fundo da identidade e a logo, e some assim que a aplicação hidrata.
 */
export function SplashScreen() {
  const [visivel, setVisivel] = useState(true);

  useEffect(() => {
    // Só faz sentido quando aberto como app instalado
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (!standalone) {
      setVisivel(false);
      return;
    }
    const t = setTimeout(() => setVisivel(false), 900);
    return () => clearTimeout(t);
  }, []);

  if (!visivel) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-sidebar anim-splash-out">
      <FrivoMark size={88} />
      <div className="flex flex-col items-center leading-none">
        <span className="text-3xl font-bold tracking-tight lowercase text-white">frivo</span>
        <span className="text-[11px] mt-1 tracking-wide text-slate-300">by Termofrio</span>
      </div>
    </div>
  );
}
