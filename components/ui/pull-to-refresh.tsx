"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

const LIMITE = 70; // px para disparar o refresh

/**
 * Pull-to-refresh para o container de scroll do dashboard no mobile.
 * Recebe o id do elemento rolável; quando puxado para baixo a partir do topo,
 * chama router.refresh().
 */
export function PullToRefresh({ scrollTargetId }: { scrollTargetId: string }) {
  const router = useRouter();
  const [dist, setDist] = useState(0);
  const [atualizando, setAtualizando] = useState(false);
  const inicioY = useRef<number | null>(null);
  const ativo = useRef(false);

  useEffect(() => {
    const alvo = document.getElementById(scrollTargetId);
    if (!alvo) return;

    function onStart(e: TouchEvent) {
      if (window.innerWidth >= 1024 || alvo!.scrollTop > 0) return;
      inicioY.current = e.touches[0].clientY;
      ativo.current = true;
    }
    function onMove(e: TouchEvent) {
      if (!ativo.current || inicioY.current == null) return;
      const dy = e.touches[0].clientY - inicioY.current;
      if (dy <= 0) { setDist(0); return; }
      // resistência
      setDist(Math.min(LIMITE * 1.5, dy * 0.5));
    }
    async function onEnd() {
      if (!ativo.current) return;
      ativo.current = false;
      inicioY.current = null;
      if (dist >= LIMITE && !atualizando) {
        setAtualizando(true);
        setDist(LIMITE);
        router.refresh();
        setTimeout(() => { setAtualizando(false); setDist(0); }, 700);
      } else {
        setDist(0);
      }
    }

    alvo.addEventListener("touchstart", onStart, { passive: true });
    alvo.addEventListener("touchmove", onMove, { passive: true });
    alvo.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      alvo.removeEventListener("touchstart", onStart);
      alvo.removeEventListener("touchmove", onMove);
      alvo.removeEventListener("touchend", onEnd);
    };
  }, [scrollTargetId, dist, atualizando, router]);

  if (dist === 0 && !atualizando) return null;

  return (
    <div
      className="lg:hidden absolute top-0 inset-x-0 z-20 flex items-center justify-center pointer-events-none"
      style={{ height: dist, opacity: Math.min(1, dist / LIMITE) }}
    >
      <div className="mt-2 bg-white border border-surface-border rounded-full p-2 shadow-card">
        <RotateCw className={cn("w-4 h-4 text-primary-600", atualizando ? "animate-spin" : "transition-transform")} style={{ transform: atualizando ? undefined : `rotate(${dist * 3}deg)` }} />
      </div>
    </div>
  );
}
