"use client";

import Link from "next/link";
import { Check, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { useModulos } from "@/components/providers/modulos-provider";
import { ImportarPlanilha } from "@/components/importacao/importar-planilha";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";
import { familiaDe, IMPORTACOES, MODULO_DA_IMPORTACAO, PERMISSOES_IMPORTACAO, type EntidadeImportacao } from "@/lib/importacao/entidades";
import type { Etapa, Progresso } from "@/lib/implantacao/etapas";

const titulo = (e: EntidadeImportacao) => IMPORTACOES[e].plural[0].toUpperCase() + IMPORTACOES[e].plural.slice(1);

/**
 * Implantação: o passo a passo com o que já existe no cadastro (contado no servidor). Cada etapa traz os
 * atalhos de importação e o modelo da planilha — só os que a pessoa pode usar e cujo módulo está ligado.
 * Importar algo recarrega a tela (as contagens andam sozinhas).
 */
export function PainelImplantacao({ etapas, progresso }: { etapas: Etapa[]; progresso: Progresso }) {
  const { pode } = usePermissoes();
  const modulos = useModulos();
  const podeImportar = (e: EntidadeImportacao) =>
    (!PERMISSOES_IMPORTACAO[e].criar || PERMISSOES_IMPORTACAO[e].criar!.some(([m, a]) => pode(m, a))) && (!MODULO_DA_IMPORTACAO[e] || modulos.tem(MODULO_DA_IMPORTACAO[e]!));

  return (
    <div className="space-y-4" data-implantacao>
      <section className="card-padded space-y-2" data-implantacao-progresso={progresso.pct}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink">
            {progresso.completa ? "Implantação concluída" : `${progresso.feitas} de ${progresso.total} etapas`}
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
      </section>

      <ol className="space-y-3">
        {etapas.map((e) => {
          const principais = e.importacoes.filter((x, i) => i === 0 || !familiaDe(e.importacoes[0]).includes(x));
          const botoes = principais.filter(podeImportar);
          const modelos = e.importacoes.filter(podeImportar);
          return (
            <li key={e.id} className={cn("bg-white rounded-card border shadow-card p-4 space-y-3", e.feita ? "border-surface-border" : progresso.proxima?.id === e.id ? "border-primary-300" : "border-surface-border")}
              data-etapa={e.id} data-etapa-feita={e.feita ? "sim" : "nao"}>
              <div className="flex items-start gap-3">
                <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                  e.feita ? "bg-success-50 text-success-700 border border-success-200" : "bg-surface-alt text-ink-muted border border-surface-border")} aria-hidden>
                  {e.feita ? <Check className="w-4 h-4" /> : e.numero}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink">{e.titulo}<span className="sr-only">{e.feita ? " (feita)" : " (a fazer)"}</span></h3>
                  <p className="text-xs text-ink-muted">{e.descricao}</p>
                </div>
              </div>

              <ul className="flex flex-wrap gap-2 pl-10">
                {e.itens.map((it) => {
                  const ok = typeof it.valor === "boolean" ? it.valor : it.valor > 0;
                  const conteudo = (
                    <>
                      <span className={cn("w-1.5 h-1.5 rounded-full", ok ? "bg-success-600" : "bg-ink-subtle")} aria-hidden />
                      {it.rotulo}
                      <strong className="tabular-nums">{typeof it.valor === "boolean" ? (it.valor ? "ok" : "falta") : it.valor.toLocaleString("pt-BR")}</strong>
                    </>
                  );
                  const cls = "inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-alt/40 px-2.5 py-1 text-xs text-ink";
                  return (
                    <li key={it.rotulo} data-item-etapa={it.rotulo}>
                      {it.secao ? <Link href={hrefSecaoConfig(it.secao)} scroll={false} className={cn(cls, "hover:border-primary-300")}>{conteudo}</Link> : <span className={cls}>{conteudo}</span>}
                    </li>
                  );
                })}
              </ul>

              {(botoes.length > 0 || modelos.length > 0 || e.href || e.semPlanilha) && (
                <div className="pl-10 space-y-2">
                  {e.semPlanilha && <p className="text-xs text-ink-muted">{e.semPlanilha}</p>}
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
