"use client";

import Link from "next/link";
import { Download, Headset, Timer, Users } from "lucide-react";
import { BarraFiltros } from "@/components/listagem/barra-filtros";
import { BarraPeriodo, type PeriodoTela } from "@/components/listagem/periodo-cards";
import { FiltroSelectUrl, useListaUrl } from "@/components/listagem/lista-url";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import type { Opcao } from "@/components/listagem/listagem-ui";
import { Dica } from "@/components/ui/dica";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { PLANILHA } from "@/lib/planilha";
import { cn, formatarData } from "@/lib/utils";
import {
  AJUDA_PRAZO, ESTADOS, LEGENDA_ESTADO, NOTA_SEM_REGISTRO, PRAZOS, ROTULO_ESTADO, ROTULO_PRAZO,
  medidos, textoDaContagem, textoPercentual,
  type Contagem, type EstadoCumprimento, type LinhaCumprimento, type PrazoRelatado, type ResumoCumprimento,
} from "@/lib/prazos/cumprimento";

/** A cor diz o estado; a palavra, sozinha, já basta (a cor reforça, não substitui). */
const PILULA: Record<EstadoCumprimento, string> = {
  CUMPRIDO: "pill-ok", DESCUMPRIDO: "pill-atrasado", SEM_REGISTRO: "pill-previsto",
};
const ICONE: Record<PrazoRelatado, typeof Headset> = { comparecer: Headset, resolver: Users, execucao: Timer };

/** O estado de um prazo na célula; sem estado, um traço (o contrato não promete, ou ainda corre). */
function Selo({ estado }: { estado: EstadoCumprimento | null }) {
  if (!estado) return <span className={PLANILHA.apagado}>—</span>;
  return <span className={cn(PILULA[estado], "text-[11px] px-2")} data-estado={estado}>{ROTULO_ESTADO[estado]}</span>;
}

/** Um prazo prometido, com o percentual grande e o que ficou de fora logo abaixo. */
function QuadroPrazo({ prazo, contagem }: { prazo: PrazoRelatado; contagem: Contagem }) {
  const Icone = ICONE[prazo];
  const semMedida = medidos(contagem) === 0;
  return (
    <div className="card p-4" data-quadro-prazo={prazo}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink-muted truncate">{ROTULO_PRAZO[prazo]}</p>
        <div className="flex items-center gap-1 shrink-0">
          <Icone className="w-4 h-4 text-ink-subtle" aria-hidden />
          <Dica texto={AJUDA_PRAZO[prazo]} rotulo={ROTULO_PRAZO[prazo]} lado="esquerda" />
        </div>
      </div>
      <p className={cn("text-2xl font-bold mt-1 tabular-nums leading-tight", semMedida ? "text-ink-subtle" : "text-ink")} data-percentual>
        {textoPercentual(contagem)}
      </p>
      <p className="text-[11px] text-ink-subtle mt-0.5" data-detalhe>{textoDaContagem(contagem)}</p>
    </div>
  );
}

const COLUNAS: ColunaPro[] = [
  { id: "numero", titulo: "Nº", largura: 120, obrigatoria: true },
  { id: "cliente", titulo: "Cliente", largura: 220, classe: "truncate" },
  { id: "contrato", titulo: "Contrato", largura: 120, oculta: true },
  { id: "abertura", titulo: "Abertura", largura: 110 },
  { id: "comparecer", titulo: "Comparecer", largura: 130 },
  { id: "resolver", titulo: "Resolver", largura: 130 },
  { id: "execucao", titulo: "Prazo de execução", largura: 150 },
];

/**
 * CUMPRIMENTO DE PRAZOS — o relatório do período. A lista e as contas vêm do servidor (as regras
 * únicas de lib/prazos/cumprimento); aqui só se escolhe o período e o recorte, e se lê.
 *
 * Os três estados estão na tabela, no resumo e na legenda — com o "sem registro" sempre FORA do
 * percentual e dito em voz alta, porque é ele que o gestor usa para cobrar o uso do "Cheguei".
 */
export function CumprimentoClient({ periodo, resumo, linhas, semPrazo, opcoes, podeExportar, urlPdf }: {
  periodo: PeriodoTela;
  resumo: ResumoCumprimento;
  linhas: LinhaCumprimento[];
  semPrazo: number;
  opcoes: { clientes: Opcao[]; contratos: Opcao[] };
  podeExportar: boolean;
  /** A mesma URL da tela, só que em PDF: o papel é o retrato do que está aqui */
  urlPdf: string;
}) {
  const { navegar } = useListaUrl();
  const { pode } = usePermissoes();
  // A permissão vem do servidor (a tela é dele), mas o botão respeita o provedor como todas as outras
  const exportar = podeExportar && pode("relatorios", "exportar");

  return (
    <>
      <BarraFiltros
        periodo={<BarraPeriodo rotulo="Abertura" periodo={periodo} navegar={navegar} permitirTodos dica="Pela abertura do chamado; sem chamado, pela abertura da OS." />}
        busca={null}
        navegar={navegar}
        extras={exportar ? (
          <a href={urlPdf} className="inline-flex items-center gap-2 bg-white border border-surface-border text-ink hover:bg-surface-alt px-3 py-2 rounded-lg text-sm font-semibold transition-colors" data-baixar-pdf>
            <Download className="w-4 h-4" aria-hidden /> PDF do cliente
          </a>
        ) : undefined}
        filtros={[
          { id: "clienteId", label: "Cliente", params: ["clienteId"], render: () => <FiltroSelectUrl param="clienteId" vazio="Todos os clientes" opcoes={opcoes.clientes} rotulo="Cliente" className="w-full" /> },
          { id: "contratoId", label: "Contrato", params: ["contratoId"], render: () => <FiltroSelectUrl param="contratoId" vazio="Todos os contratos" opcoes={opcoes.contratos} rotulo="Contrato" className="w-full" /> },
        ]}
      />

      {/* O número do período e, ao lado, cada prazo prometido */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-3" data-resumo-cumprimento>
        <div className="card p-4 bg-acento-claro/40 border-acento/20" data-quadro-prazo="geral">
          <p className="text-[11px] text-ink-muted">Cumprimento no período</p>
          <p className={cn("text-3xl font-bold mt-1 tabular-nums leading-tight", medidos(resumo.geral) === 0 ? "text-ink-subtle" : "text-acento")} data-percentual>
            {textoPercentual(resumo.geral)}
          </p>
          <p className="text-[11px] text-ink-subtle mt-0.5" data-detalhe>{textoDaContagem(resumo.geral)}</p>
        </div>
        {PRAZOS.map((p) => <QuadroPrazo key={p} prazo={p} contagem={resumo[p]} />)}
      </div>

      {/* A legenda curta: o que cada palavra quer dizer, e por que o "sem registro" não entra na conta */}
      <div className="card p-4 mt-3" data-legenda-cumprimento>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
          {ESTADOS.map((e) => (
            <p key={e} className="text-xs text-ink-muted flex items-start gap-2 max-w-xl" data-legenda={e}>
              <span className={cn(PILULA[e], "text-[11px] px-2 shrink-0")}>{ROTULO_ESTADO[e]}</span>
              <span>{LEGENDA_ESTADO[e]}</span>
            </p>
          ))}
        </div>
      </div>

      {linhas.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-12 text-center mt-3" data-lista-vazia>
          <p className="text-sm font-medium text-ink">Nenhum prazo a relatar no período</p>
          <p className="text-xs text-ink-muted">
            {semPrazo > 0
              ? `${semPrazo === 1 ? "A OS aberta" : `As ${semPrazo} OS abertas`} no período ainda não ${semPrazo === 1 ? "tem" : "têm"} prazo decidido: sem prazo definido, ou com o prazo ainda correndo.`
              : "Nenhuma OS ou chamado foi aberto neste período."}
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <TabelaPro
            tela="cumprimento-prazos"
            colunas={COLUNAS}
            atributos={{ "data-tabela-cumprimento": "1" }}
            barra={<span className="text-sm text-ink-muted" data-contador>{linhas.length === 1 ? "1 chamado" : `${linhas.length} chamados`}{semPrazo > 0 && ` · ${semPrazo} sem prazo a relatar`}</span>}
            linhas={linhas.map((l) => ({
              id: l.id,
              atributos: { "data-linha-cumprimento": l.numero },
              celulas: {
                numero: <Link href={`/ordens/${l.id}`} className={cn(PLANILHA.codigo, "text-acento hover:underline")}>{l.numero}</Link>,
                cliente: <span className={PLANILHA.nome}>{l.clienteNome}</span>,
                contrato: l.contratoNumero ? <span className={PLANILHA.apagado}>{l.contratoNumero}</span> : <span className={PLANILHA.apagado}>—</span>,
                abertura: <span className={PLANILHA.data}>{formatarData(l.abertura)}</span>,
                comparecer: <Selo estado={l.comparecer} />,
                resolver: <Selo estado={l.resolver} />,
                execucao: (
                  <span className="inline-flex items-center gap-1.5">
                    <Selo estado={l.execucao} />
                    {l.justificativa && <span className="pill-previsto text-[11px] px-2" data-atraso-justificado>Justificado</span>}
                  </span>
                ),
              },
              titulos: { cliente: l.clienteNome },
            }))}
            cartoes={
              <div className="p-3 grid grid-cols-1 gap-2">
                {linhas.map((l) => (
                  <div key={l.id} className="card p-3" data-cartao-cumprimento={l.numero}>
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/ordens/${l.id}`} className={cn(PLANILHA.codigo, "text-acento hover:underline")}>{l.numero}</Link>
                      <span className={cn(PLANILHA.data, "text-xs")}>{formatarData(l.abertura)}</span>
                    </div>
                    <p className="text-sm text-ink mt-0.5 truncate">{l.clienteNome}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                      {PRAZOS.map((p) => {
                        const estado = l[p];
                        if (!estado) return null;
                        return (
                          <span key={p} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
                            {ROTULO_PRAZO[p]} <Selo estado={estado} />
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            }
          />
        </div>
      )}

      <p className="text-xs text-ink-muted mt-3" data-nota-sem-registro>{NOTA_SEM_REGISTRO}</p>
    </>
  );
}
