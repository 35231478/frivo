"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { Tabs } from "@/components/ui/tabs";
import { Dica } from "@/components/ui/dica";
import { ROTULO_QUANDO, ROTULO_VISTA, VISTAS, type Vista } from "@/lib/comissoes/regras";
import type { RelatorioComissoes } from "@/lib/comissoes/servidor";

const DICA_VISTA = "Por data de emissão: as vendas aprovadas no mês, com a comissão inteira. Por data de recebimento: a parte da comissão coberta pelo dinheiro que entrou no mês. É só a vista: o fechamento paga pelo que está em Configurações › Comissões.";

/**
 * COM-1 — as comissões do mês no fechamento, vistas por data de emissão ou por data de recebimento (o mesmo conceito
 * do "quando é devida"). Abre na vista da configuração da empresa; trocar a vista não muda o que é pago.
 */
export function RelatorioDeComissoes({ mes }: { mes: string }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [dados, setDados] = useState<RelatorioComissoes | null>(null);
  const [erro, setErro] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setErro(false);
    fetch(`/api/comissoes/relatorio?mes=${mes}${vista ? `&vista=${vista}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: RelatorioComissoes) => {
        if (!vivo) return;
        if (!Array.isArray(d?.pessoas) || !(VISTAS as readonly string[]).includes(d.vista)) { setErro(true); return; }
        setDados(d); if (!vista) setVista(d.vista);
      })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [mes, vista]);

  const atual = vista ?? dados?.vista ?? "RECEBIMENTO";
  return (
    <section className="card space-y-3" data-relatorio-comissoes>
      <div className="flex items-center gap-1.5 px-4 pt-4">
        <h2 className="text-sm font-semibold text-ink">Comissões do mês</h2>
        <Dica rotulo="Por data de emissão ou de recebimento" texto={DICA_VISTA} />
      </div>
      <Tabs tabs={VISTAS.map((v) => ({ id: v, label: ROTULO_VISTA[v] }))} active={atual} onChange={(id) => { setAberta(null); setVista(id as Vista); }}>
        {() => (
          <div className="px-4 pb-4 space-y-2">
            {dados && ROTULO_QUANDO[dados.quando] && <p className="text-xs text-ink-muted" data-paga-por>O fechamento paga {ROTULO_QUANDO[dados.quando].toLowerCase()}.</p>}
            {erro ? (
              <p className="text-sm text-atrasado-texto" role="alert">Não foi possível carregar as comissões do mês.</p>
            ) : !dados || dados.vista !== atual ? (
              <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>
            ) : dados.pessoas.length === 0 ? (
              <p className="text-sm text-ink-muted" data-relatorio-vazio>Nenhuma comissão neste mês por esta data.</p>
            ) : (
              <ul className="divide-y divide-surface-border" data-relatorio-pessoas>
                {dados.pessoas.map((p) => {
                  const k = p.usuarioId ?? p.nome;
                  const aberto = aberta === k;
                  return (
                    <li key={k} data-relatorio-pessoa={k}>
                      <button type="button" onClick={() => setAberta(aberto ? null : k)} aria-expanded={aberto}
                        className="w-full min-h-[44px] py-2 flex items-center justify-between gap-3 text-left">
                        <span className="text-sm font-medium text-ink truncate">{p.nome}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-sm tabular-nums text-ink" data-relatorio-valor>{formatarMoeda(p.valor)}</span>
                          <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", aberto && "rotate-180")} aria-hidden />
                        </span>
                      </button>
                      {aberto && (
                        <ul className="pb-2 space-y-1" data-relatorio-vendas>
                          {p.vendas.map((v) => (
                            <li key={v.orcamentoId} className="flex items-start justify-between gap-3 text-xs">
                              <span className="min-w-0">
                                <span className="text-ink">{v.codigo} · {v.nome}</span>
                                <span className="block text-ink-muted">{v.cliente} · {formatarData(v.data)}</span>
                              </span>
                              <span className="tabular-nums text-ink shrink-0">{formatarMoeda(v.valor)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                <li className="py-2 flex items-center justify-between text-sm font-semibold text-ink">
                  <span>Total</span><span className="tabular-nums" data-relatorio-total>{formatarMoeda(dados.total)}</span>
                </li>
              </ul>
            )}
          </div>
        )}
      </Tabs>
    </section>
  );
}
