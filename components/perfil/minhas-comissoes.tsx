"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn, formatarMoeda } from "@/lib/utils";
import type { VendaNoExtrato } from "@/lib/comissoes/servidor";

// A venda (vendedor) ou a OS (técnico, COM-2): o mesmo formato do extrato do servidor
type Venda = VendaNoExtrato;
interface Extrato { vendas: Venda[]; totais: { prevista: number; liberada: number; paga: number } }

const SITUACOES = [
  { id: "prevista", rotulo: "Prevista", dica: "Venda aprovada; ainda não liberada" },
  { id: "liberada", rotulo: "Liberada", dica: "Devida; entra no próximo fechamento do mês" },
  { id: "paga", rotulo: "Paga", dica: "Já entrou num fechamento do mês" },
] as const;

/**
 * COM-1 — "Minhas comissões" (Meu perfil e app do técnico): o extrato da PRÓPRIA pessoa por orçamento/OS —
 * prevista, liberada e paga. Só valores de comissão: nunca custo, margem nem a base em reais.
 */
export function MinhasComissoes() {
  const [dados, setDados] = useState<Extrato | null>(null);
  const [erro, setErro] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/perfil/comissoes").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { if (vivo) setDados(d); }).catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, []);

  if (erro) return <p className="text-sm text-atrasado-texto" role="alert">Não foi possível carregar as comissões.</p>;
  if (!dados) return <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>;

  return (
    <div className="space-y-4" data-minhas-comissoes>
      <div className="grid grid-cols-3 gap-2" data-totais-comissao>
        {SITUACOES.map((s) => (
          <div key={s.id} className="rounded-xl border border-surface-border bg-white px-3 py-2" title={s.dica} data-total={s.id}>
            <p className="text-xs text-ink-muted">{s.rotulo}</p>
            <p className="text-sm sm:text-base font-semibold text-ink tabular-nums">{formatarMoeda(dados.totais[s.id])}</p>
          </div>
        ))}
      </div>

      {dados.vendas.length === 0 ? (
        <p className="text-sm text-ink-muted" data-sem-comissao>Nenhuma comissão ainda. Ela nasce quando um orçamento seu é aprovado.</p>
      ) : (
        <ul className="rounded-xl border border-surface-border bg-white divide-y divide-surface-border" data-lista-comissoes>
          {dados.vendas.map((v) => {
            const aberto = aberta === v.chave;
            return (
              <li key={v.chave} data-venda-comissao={v.chave}>
                <button type="button" onClick={() => setAberta(aberto ? null : v.chave)} aria-expanded={aberto}
                  className="w-full min-h-[44px] px-3 py-3 flex items-start justify-between gap-3 text-left hover:bg-surface-alt/60">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink truncate">{v.codigo} · {v.nome}</span>
                    <span className="block text-xs text-ink-muted truncate">{v.cliente}{v.osNumero ? ` · ${v.osNumero}` : ""}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-right text-xs tabular-nums">
                      {v.prevista > 0 && <span className="block text-ink-muted">Prevista {formatarMoeda(v.prevista)}</span>}
                      {v.liberada > 0 && <span className="block text-ink">Liberada {formatarMoeda(v.liberada)}</span>}
                      {v.paga > 0 && <span className="block text-ok-texto">Paga {formatarMoeda(v.paga)}</span>}
                    </span>
                    <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", aberto && "rotate-180")} aria-hidden />
                  </span>
                </button>
                {aberto && (
                  <ul className="px-3 pb-3 space-y-1" data-itens-comissao>
                    {v.itens.map((i, n) => (
                      <li key={n} className="flex items-start justify-between gap-3 text-xs">
                        <span className="min-w-0">
                          <span className="text-ink">{i.descricao}</span>
                          <span className="block text-ink-muted">{i.regra}</span>
                          {i.emRevisao && <span className="mt-0.5 inline-block rounded-full bg-atencao-claro px-1.5 py-0.5 text-[10px] font-semibold text-atencao-texto" data-item-em-revisao>Em revisão: retorno no equipamento</span>}
                        </span>
                        <span className="tabular-nums text-ink shrink-0">{formatarMoeda(i.valor)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
