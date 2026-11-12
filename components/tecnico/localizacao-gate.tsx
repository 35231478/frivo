"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Loader2, Ban } from "lucide-react";

export type EstadoLoc = "verificando" | "ok" | "negada" | "sem-suporte";

/**
 * "Exigir localização ativa": enquanto não há posição do GPS, o app fica travado. Observa a posição
 * (watchPosition) para destravar assim que a localização volta. Desligada, devolve "ok" (sem travar).
 */
export function useLocalizacaoObrigatoria(ativa: boolean): { estado: EstadoLoc; tentar: () => void } {
  const [estado, setEstado] = useState<EstadoLoc>(ativa ? "verificando" : "ok");
  const [tentativa, setTentativa] = useState(0);
  const tentar = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => {
    if (!ativa) { setEstado("ok"); return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) { setEstado("sem-suporte"); return; }
    setEstado("verificando");
    const id = navigator.geolocation.watchPosition(
      () => setEstado("ok"),
      (err) => setEstado(err.code === err.PERMISSION_DENIED ? "negada" : "verificando"),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [ativa, tentativa]);

  return { estado, tentar };
}

/** Tela de bloqueio quando "exigir localização" está ligado e não há GPS. */
export function BloqueioLocalizacao({ estado, onTentar }: { estado: EstadoLoc; onTentar: () => void }) {
  const negada = estado === "negada" || estado === "sem-suporte";
  return (
    <div className="flex flex-col items-center text-center gap-3 py-16 px-4" data-bloqueio-localizacao data-estado={estado}>
      <span className={negada ? "rounded-full bg-atrasado-claro text-atrasado p-4" : "rounded-full bg-primary-50 text-primary-700 p-4"}>
        {estado === "verificando" ? <Loader2 className="w-8 h-8 animate-spin" /> : negada ? <Ban className="w-8 h-8" /> : <MapPin className="w-8 h-8" />}
      </span>
      <h2 className="text-lg font-bold text-ink">
        {estado === "verificando" ? "Procurando sua localização…" : "Localização necessária"}
      </h2>
      <p className="text-sm text-ink-muted max-w-sm">
        {estado === "sem-suporte"
          ? "Este aparelho não informa a localização. Use um celular com GPS para abrir o app."
          : estado === "negada"
            ? "A empresa exige localização para usar o app. Permita o acesso no navegador e tente de novo."
            : "Mantenha o GPS ligado. Assim que a localização for obtida, o app libera sozinho."}
      </p>
      {estado !== "sem-suporte" && (
        <button type="button" onClick={onTentar} className="mt-1 rounded-card bg-primary-600 text-white px-5 py-3 text-sm font-semibold touch-target">
          Permitir localização
        </button>
      )}
    </div>
  );
}
