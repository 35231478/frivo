"use client";

import { useEffect, useRef } from "react";
import { lacoDe, type RespostaNovidades } from "@/lib/chat/novidades-cliente";

/** Assina o tempo real do chat (um laço por aba, compartilhado). `ligado` false = não assina. */
export function useNovidades(url: string, aoMudar: (r: RespostaNovidades) => void, ligado = true) {
  const cb = useRef(aoMudar);
  cb.current = aoMudar;
  useEffect(() => {
    if (!ligado) return;
    return lacoDe(url).assinar((r) => cb.current(r));
  }, [url, ligado]);
}

/** Pede uma pergunta agora ao laço (depois de enviar, ou quando a notificação chega). */
export const avisarNovidades = (url: string) => lacoDe(url).avisar();
