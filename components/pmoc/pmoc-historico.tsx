"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import type { LinhaHistorico } from "@/lib/pmoc-documento-server";

const quando = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(",", " às");

/** Aba "Histórico": a linha do tempo do plano (envios ao cliente, avisos de vencimento, ART, publicação) */
export function PmocHistorico({ pmocId }: { pmocId: string }) {
  const [linhas, setLinhas] = useState<LinhaHistorico[] | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch(`/api/pmocs/${pmocId}/historico`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (!r.ok) setErro(d.erro ?? "Não foi possível carregar o histórico.");
      else setLinhas(Array.isArray(d.historico) ? d.historico : []);
    }).catch(() => { if (vivo) setErro("Erro de conexão."); });
    return () => { vivo = false; };
  }, [pmocId]);

  return (
    <div className="bg-white border border-surface-border rounded-xl" data-historico-pmoc>
      <div className="px-4 py-3 border-b border-surface-border">
        <h2 className="font-semibold text-ink">Histórico do plano</h2>
        <p className="text-xs text-ink-muted">Envios ao cliente, avisos de vencimento, ART e publicação.</p>
      </div>
      {erro ? <p role="alert" className="text-sm text-atrasado-texto px-4 py-6" data-erro-historico>{erro}</p>
        : !linhas ? <p className="text-sm text-ink-muted px-4 py-6 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>
        : linhas.length === 0 ? <p className="text-sm text-ink-muted text-center px-4 py-8" data-sem-historico>Nada registrado ainda.</p> : (
          <ul className="divide-y divide-surface-border">
            {linhas.map((h) => (
              <li key={h.id} className="px-4 py-3 flex items-start gap-3" data-linha-historico>
                <History className="w-4 h-4 text-ink-subtle mt-0.5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{h.acao}</p>
                  {h.detalhes && <p className="text-sm text-ink-muted break-words">{h.detalhes}</p>}
                  <p className="text-xs text-ink-subtle">{quando(h.criadoEm)}{h.usuario ? ` · ${h.usuario}` : " · automático"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
