"use client";

import { useEffect, useState } from "react";

/** O relógio da tela: o que depende da hora ("faltam 3 h", "vence hoje") se atualiza sozinho, a cada meio minuto. */
export function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return agora;
}

/**
 * O mesmo relógio para telas que nascem no SERVIDOR: `null` enquanto a página não montou no
 * navegador. O servidor e o navegador nunca têm o mesmo "agora" — texto que depende da hora ("faltam
 * 34 min") renderizado dos dois lados sai diferente e quebra a hidratação. Quem usa mostra primeiro o
 * que não depende do relógio e completa quando este hook devolve a hora.
 */
export function useAgoraNoNavegador(): number | null {
  const [agora, setAgora] = useState<number | null>(null);
  useEffect(() => {
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}
