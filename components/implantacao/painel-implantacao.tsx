"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Download, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { useModulos } from "@/components/providers/modulos-provider";
import { ImportarPlanilha } from "@/components/importacao/importar-planilha";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";
import { familiaDe, IMPORTACOES, MODULO_DA_IMPORTACAO, PERMISSOES_IMPORTACAO, type EntidadeImportacao } from "@/lib/importacao/entidades";
import type { Etapa, EtapaId, Progresso } from "@/lib/implantacao/etapas";

const titulo = (e: EntidadeImportacao) => IMPORTACOES[e].plural[0].toUpperCase() + IMPORTACOES[e].plural.slice(1);

/**
 * Implantação: o passo a passo com o que já existe no cadastro (contado no servidor). Cada etapa traz os
 * atalhos de importação e o modelo da planilha — só os que a pessoa pode usar e cujo módulo está ligado.
 * Importar algo recarrega a tela (as contagens andam sozinhas). Etapa ainda não feita pode ser marcada
 * "Não se aplica / fazer depois" (conta como concluída) e reaberta depois.
 */
export function PainelImplantacao({ etapas, progresso }: { etapas: Etapa[]; progresso: Progresso }) {
  const { pode } = usePermissoes();
  const modulos = useModulos();
  const roteador = useRouter();
  const podeMarcar = pode("configuracoes", "gerenciar");
  const [salvando, setSalvando] = useState<EtapaId | null>(null);
  const [erro, setErro] = useState("");
  async function marcar(etapa: EtapaId, dispensada: boolean) {
    setSalvando(etapa); setErro("");
    try {
      const r = await fetch("/api/implantacao/etapas", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etapa, dispensada }) });
      if (!r.ok) throw new Error();
      roteador.refresh();
    } catch {
      setErro("Não foi possível salvar. Tente de novo.");
    } finally {
      setSalvando(null);
    }
  }
  const nDepois = etapas.filter((e) => e.dispensada).length;
  const podeImportar = (e: EntidadeImportacao) =>
    (!PERMISSOES_IMPORTACAO[e].criar || PERMISSOES_IMPORTACAO[e].criar!.some(([m, a]) => pode(m, a))) && (!MODULO_DA_IMPORTACAO[e] || modulos.tem(MODULO_DA_IMPORTACAO[e]!));

  return (
    <div className="space-y-4" data-implantacao>
      <section className="card-padded space-y-2" data-implantacao-progresso={progresso.pct}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink">
            {progresso.completa ? "Implantação concluída" : `${progresso.feitas} de ${progresso.total} etapas`}
            {nDepois > 0 && <span className="font-normal text-ink-muted" data-n-depois={nDepois}> · {nDepois} para depois</span>}
          </p>
          <p className="text-sm font-bold tabular-nums text-primary-700">{progresso.pct}%</p>
        </div>
        <div className="h-2 rounded-full bg-surface-alt overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progresso.pct} aria-label="Progresso da implantação">
          <div className={cn("h-full rounded-full transition-all", progresso.completa ? "bg-success-600" : "bg-primary-500")} style={{ width: `${progresso.pct}%` }} />
        </div>
        <p className="text-xs text-ink-muted">
          {progresso.completa
            ? "Tudo no lugar. Esta tela continua aqui para novas importações; o destaque no painel saiu."
            : <>Siga a ordem: cada planilha se apoia na anterior. Próxima etapa: <strong>{progresso.proxima?.titulo}</strong>.</>}
        </p>
        {erro && <p className="text-xs text-atrasado" role="alert">{erro}</p>}
      </section>

      <ol className="space-y-3">
        {etapas.map((e) => {
          const principais = e.importacoes.filter((x, i) => i === 0 || !familiaDe(e.importacoes[0]).includes(x));
          const botoes = principais.filter(podeImportar);
          const modelos = e.importacoes.filter(podeImportar);
          return (
            <li key={e.id} className={cn("bg-white rounded-card border shadow-card p-4 space-y-3", e.feita ? "border-surface-border" : progresso.proxima?.id === e.id ? "border-primary-300" : "border-surface-border")}
              data-etapa={e.id} data-etapa-feita={e.feita ? "sim" : e.dispensada ? "depois" : "nao"}>
              <div className="flex items-start gap-3">
                <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                  e.feita ? "bg-success-50 text-success-700 border border-success-200" : "bg-surface-alt text-ink-muted border border-surface-border")} aria-hidden>
                  {e.feita ? <Check className="w-4 h-4" /> : e.dispensada ? <Minus className="w-4 h-4" /> : e.numero}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink">{e.titulo}<span className="sr-only">{e.feita ? " (feita)" : e.dispensada ? " (não se aplica / para depois)" : " (a fazer)"}</span></h3>
                  <p className="text-xs text-ink-muted">{e.descricao}</p>
                  {e.dispensada && <p className="text-xs text-ink-muted mt-1" data-etapa-depois>Marcada como <strong>não se aplica / fazer depois</strong>: conta como concluída.</p>}
                </div>
                {!e.feita && podeMarcar && (
                  <button type="button" onClick={() => marcar(e.id, !e.dispensada)} disabled={salvando === e.id}
                    className="shrink-0 text-xs font-medium text-ink-muted hover:text-ink underline-offset-2 hover:underline disabled:opacity-50"
                    data-acao={e.dispensada ? "reabrir-etapa" : "dispensar-etapa"}>
                    {e.dispensada ? "Reabrir" : "Não se aplica / fazer depois"}
                  </button>
                )}
              </div>

              <ul className="flex flex-wrap gap-2 pl-10">
                {e.itens.map((it) => {
                  const ok = typeof it.valor === "boolean" ? it.valor : it.valor > 0;
                  const conteudo = (
                    <>
                      <span className={cn("w-1.5 h-1.5 rounded-full", ok ? "bg-success-600" : "bg-ink-subtle")} aria-hidden />
                      {it.rotulo}
                      <strong className="tabular-nums">{it.texto ?? (typeof it.valor === "boolean" ? (it.valor ? "ok" : "falta") : it.valor.toLocaleString("pt-BR"))}</strong>
                    </>
                  );
                  const cls = "inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-alt/40 px-2.5 py-1 text-xs text-ink";
                  return (
                    <li key={it.rotulo} data-item-etapa={it.rotulo}>
                      {it.secao ? (
                        // Item que leva à tela onde se resolve: tem cara de botão (borda e texto de link, seta,
                        // realce no passar do mouse e foco visível) — o item só informativo fica como etiqueta
                        <Link href={hrefSecaoConfig(it.secao)} scroll={false} title={`Abrir ${it.rotulo} em Configurações`} data-item-clicavel
                          className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-surface px-2.5 py-1 text-xs text-primary-700 shadow-sm transition-colors hover:border-primary-400 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1">
                          {conteudo}<ChevronRight className="w-3.5 h-3.5 -mr-1" aria-hidden />
                        </Link>
                      ) : <span className={cls}>{conteudo}</span>}
                    </li>
                  );
                })}
              </ul>

              {(botoes.length > 0 || modelos.length > 0 || e.href || e.nota) && (
                <div className="pl-10 space-y-2">
                  {e.nota && <p className="text-xs text-ink-muted" data-etapa-nota>{e.nota}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    {botoes.map((x) => (
                      <ImportarPlanilha key={x} entidade={x} rotulo={botoes.length > 1 || principais.length > 1 ? `Importar ${IMPORTACOES[x].plural}` : "Importar planilha"} />
                    ))}
                    {e.href && (
                      <Link href={e.href} className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline px-1" data-abrir-lista={e.id}>
                        Abrir a lista <ChevronRight className="w-4 h-4" aria-hidden />
                      </Link>
                    )}
                  </div>
                  {modelos.length > 0 && (
                    <p className="text-xs text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Modelo:</span>
                      {modelos.map((x) => (
                        <a key={x} href={`/api/importacao/${x}/modelo?formato=xlsx`} className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline" data-modelo={x}>
                          <Download className="w-3.5 h-3.5" aria-hidden /> {titulo(x)}
                        </a>
                      ))}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
