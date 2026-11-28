"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROTULO_SEM_OS, type OsDoDia } from "@/lib/chat/regras";

const ROTULO_EM_ANDAMENTO = "Atividade em andamento";

/**
 * CHAT-1 — a OS da mensagem, em 1 toque, acima do campo de texto (escritório e app): as OS da pessoa no dia (a em
 * andamento marcada), "Sem OS" e, quando a tela oferece, "Outra OS" (busca). Começa já na OS padrão; a pessoa troca.
 */
export function SeletorOs({ opcoes, valor, onValor, buscar }: {
  opcoes: OsDoDia[];
  valor: string | null;
  onValor: (osId: string | null, os?: OsDoDia | null) => void;
  /** Busca de outra OS (nº ou cliente); sem ela, não há "Outra OS" */
  buscar?: (q: string) => Promise<OsDoDia[]>;
}) {
  const [buscando, setBuscando] = useState(false);
  const [q, setQ] = useState("");
  const [achadas, setAchadas] = useState<OsDoDia[]>([]);
  const [extra, setExtra] = useState<OsDoDia | null>(null);
  useEffect(() => {
    if (!buscando || !buscar || q.trim().length < 2) { setAchadas([]); return; }
    const t = setTimeout(() => void buscar(q.trim()).then(setAchadas).catch(() => setAchadas([])), 300);
    return () => clearTimeout(t);
  }, [q, buscando, buscar]);

  const lista = extra && !opcoes.some((o) => o.osId === extra.osId) ? [...opcoes, extra] : opcoes;
  const chip = (ativo: boolean) => cn("shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold max-w-[14rem] truncate touch-target",
    ativo ? "bg-primary-600 text-white border-primary-600" : "bg-white text-ink-muted border-surface-border hover:border-primary-300");

  return (
    <div className="space-y-1.5" data-seletor-os>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="radiogroup" aria-label="OS da mensagem">
        {lista.map((o) => (
          <button key={o.osId} type="button" role="radio" aria-checked={valor === o.osId} onClick={() => onValor(o.osId, o)} className={chip(valor === o.osId)}
            title={o.emAndamento ? ROTULO_EM_ANDAMENTO : undefined} data-os-opcao={o.osId} data-em-andamento={o.emAndamento || undefined}
            aria-label={`${o.numero}${o.cliente ? ` · ${o.cliente}` : ""}${o.emAndamento ? ` (${ROTULO_EM_ANDAMENTO.toLowerCase()})` : ""}`}>
            {o.emAndamento && <span className="inline-block w-1.5 h-1.5 rounded-full bg-acento mr-1 align-middle" aria-hidden />}
            {o.numero}{o.cliente ? ` · ${o.cliente}` : ""}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={valor === null} onClick={() => onValor(null, null)} className={chip(valor === null)} data-os-opcao="sem-os">
          {ROTULO_SEM_OS}
        </button>
        {buscar && !buscando && (
          <button type="button" onClick={() => setBuscando(true)} className={cn(chip(false), "inline-flex items-center gap-1")} data-outra-os>
            <Search className="w-3 h-3" aria-hidden /> Outra OS
          </button>
        )}
      </div>
      {/* O ponto: a atividade EM ANDAMENTO (uma OS só tem o ponto — a iniciada por último) */}
      {lista.some((o) => o.emAndamento) && (
        <p className="flex items-center gap-1 px-1 text-[11px] text-ink-subtle" data-legenda-em-andamento>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-acento" aria-hidden /> {ROTULO_EM_ANDAMENTO}
        </p>
      )}
      {buscando && (
        <div className="space-y-1" data-busca-os>
          <label className="relative block">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº da OS ou cliente" aria-label="Pesquisar outra OS"
              className="w-full rounded-full border border-surface-border pl-3 pr-8 py-1.5 text-sm" data-busca-os-texto />
            <button type="button" onClick={() => { setBuscando(false); setQ(""); }} aria-label="Fechar a pesquisa" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle"><X className="w-4 h-4" /></button>
          </label>
          {achadas.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {achadas.map((o) => (
                <button key={o.osId} type="button" onClick={() => { setExtra(o); onValor(o.osId, o); setBuscando(false); setQ(""); }} className={chip(false)} data-os-achada={o.osId}>
                  {o.numero}{o.cliente ? ` · ${o.cliente}` : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
