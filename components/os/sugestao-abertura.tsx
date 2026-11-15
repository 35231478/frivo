"use client";

import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { JANELA_MESES, notaDaSugestao } from "@/lib/os/sugestoes";

export interface SugestoesAbertura {
  janelaMeses: number;
  tipoOs: { id: string; nome: string; vezes: number } | null;
  executor: { tipo: "tecnico" | "equipe"; id: string; nome: string; vezes: number } | null;
}

const VAZIO: SugestoesAbertura = { janelaMeses: JANELA_MESES, tipoOs: null, executor: null };

/**
 * O que o histórico deste cliente sugere para a abertura da OS (Princípio 9). Sem cliente, ou com
 * histórico fino, vem vazio — e a tela não mostra nada. Nunca preenche sozinha: quem decide é quem
 * clica em "Usar".
 */
export function useSugestoesAbertura(clienteId: string): SugestoesAbertura {
  const [s, setS] = useState<SugestoesAbertura>(VAZIO);
  useEffect(() => {
    if (!clienteId) { setS(VAZIO); return; }
    let vivo = true;
    fetch(`/api/ordens/sugestoes?clienteId=${encodeURIComponent(clienteId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : VAZIO))
      .then((d) => { if (vivo) setS(d && typeof d === "object" ? d : VAZIO); })
      .catch(() => { if (vivo) setS(VAZIO); }); // sugestão é um extra: falhar não atrapalha a abertura
    return () => { vivo = false; };
  }, [clienteId]);
  return s;
}

/**
 * A linha da sugestão embaixo do campo: o que é, de onde veio, e o botão de usar. Some depois de
 * usada (`escondida`) ou quando a pessoa dispensa.
 */
export function Sugestao({ oQue, nome, vezes, escondida, onUsar, atributo }: {
  /** "tipo" ou "executor" — muda só o texto de onde veio */
  oQue: "tipo" | "executor";
  nome: string;
  vezes: number;
  escondida?: boolean;
  onUsar: () => void;
  atributo: string;
}) {
  const [dispensada, setDispensada] = useState(false);
  if (escondida || dispensada) return null;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted" data-sugestao={atributo}>
      <Lightbulb className="w-3.5 h-3.5 text-ink-subtle shrink-0" aria-hidden />
      <span>
        Sugestão: <span className="font-medium text-ink">{nome}</span>. {notaDaSugestao(vezes, oQue)}
      </span>
      <button type="button" onClick={onUsar} className="font-semibold text-primary-600 hover:text-primary-700" data-usar-sugestao={atributo}>Usar</button>
      <button type="button" onClick={() => setDispensada(true)} className="text-ink-subtle hover:text-ink-muted" data-dispensar-sugestao={atributo}>Dispensar</button>
    </p>
  );
}
