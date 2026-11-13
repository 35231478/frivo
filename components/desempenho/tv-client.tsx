"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { horaBR } from "@/lib/fuso";
import { formatarEscore, rotuloCompetencia } from "@/lib/desempenho/regras";
import type { PainelTv } from "@/lib/desempenho/painel";
import { posicaoTexto } from "./comum";
import { PremioEmDisputa } from "./painel-client";

/** De quanto em quanto tempo a TV busca o ranking de novo */
export const INTERVALO_TV_MS = 60_000;

/**
 * Modo TV: o ranking do mês e o prêmio em disputa, em tela cheia, só leitura. Atualiza sozinho. Só
 * tem posição, nome, escore e faixa — o servidor não manda valor em reais para esta tela.
 */
export function PainelDaTv({ token, inicial }: { token: string; inicial: PainelTv }) {
  const [painel, setPainel] = useState(inicial);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    const buscar = async () => {
      try {
        const r = await fetch(`/api/publico/desempenho/${token}`, { cache: "no-store" });
        if (!vivo) return;
        if (!r.ok) { setFalhou(true); return; }
        setPainel(await r.json()); setFalhou(false);
      } catch { if (vivo) setFalhou(true); }
    };
    const relogio = setInterval(buscar, INTERVALO_TV_MS);
    return () => { vivo = false; clearInterval(relogio); };
  }, [token]);

  return (
    <main className="min-h-screen bg-slate-950 text-white px-4 py-5 sm:px-8 sm:py-7 space-y-5" data-painel-tv data-atualizado={painel.atualizadoEm}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-white/60" data-tv-empresa>{painel.empresa}</p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight flex items-center gap-3">
            <Trophy className="w-8 h-8 text-amber-400 shrink-0" aria-hidden /> <span>Ranking de <span className="first-letter:uppercase inline-block" data-tv-mes>{rotuloCompetencia(painel.competencia)}</span></span>
          </h1>
        </div>
        <p className="text-sm text-white/60" data-tv-atualizado>{falhou ? "Sem conexão · " : ""}Atualizado às {horaBR(painel.atualizadoEm)}</p>
      </header>

      {painel.premiacoes.length > 0 && <PremioEmDisputa premiacoes={painel.premiacoes} escuro urlDaImagem={(id) => `/api/publico/desempenho/${token}/premiacoes/${id}/imagem`} />}

      {painel.grupos.length === 0 ? <p className="text-white/60 text-lg py-10 text-center" data-tv-vazio>Nenhum colaborador no ranking ainda.</p> : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {painel.grupos.map((g) => (
            <section key={g.perfil} className="rounded-xl border border-white/15 bg-white/5 overflow-hidden" data-tv-grupo={g.perfil}>
              <h2 className="px-4 py-3 text-lg font-semibold border-b border-white/10">{g.perfil}</h2>
              <ol className="divide-y divide-white/10">
                {g.linhas.map((l, i) => (
                  <li key={`${l.nome}-${i}`} className="flex items-center gap-3 px-4 py-3" data-tv-linha={l.nome}>
                    <span className={cn("w-12 text-2xl font-bold tabular-nums", l.posicao === 1 ? "text-amber-400" : "text-white/60")} data-tv-posicao>{posicaoTexto(l.posicao)}</span>
                    <span className="flex-1 min-w-0 text-xl font-medium truncate">{l.nome}</span>
                    {l.faixa && <span className="rounded-full bg-emerald-500/20 text-emerald-300 text-sm font-medium px-2.5 py-0.5" data-tv-faixa>{l.faixa}</span>}
                    <span className="w-24 text-right text-2xl font-bold tabular-nums" data-tv-escore>{formatarEscore(l.escore)}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
