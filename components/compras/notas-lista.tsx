"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Eye } from "lucide-react";
import { BarraFiltros } from "@/components/listagem/barra-filtros";
import { BarraPeriodo } from "@/components/listagem/periodo-cards";
import { BuscaUrl, ConteudoUrl, FiltroSelectUrl, TabelaProUrl, useListaUrl } from "@/components/listagem/lista-url";
import { CopiarCodigo } from "@/components/financeiro/copiar-codigo";
import { GavetaNota } from "@/components/compras/gaveta-nota";
import { cn, formatarCpfCnpj, formatarData, formatarMoeda } from "@/lib/utils";
import { COR_STATUS_NOTA, LABEL_STATUS_NOTA } from "@/lib/compras/rotulos";
import { PLANILHA } from "@/lib/planilha";
import type { ColunaPro } from "@/components/listagem/tabela-pro";
import type { NotaDaLista } from "@/lib/compras/notas";
import type { PeriodoTela } from "@/lib/periodo";

/**
 * As colunas da lista de notas. O padrão continua enxuto (NF, Fornecedor, Emissão, Valor, Itens, Situação);
 * as outras o usuário liga e reordena no menu "Colunas" (a preferência é dele, em todas as telas iguais).
 */
export const COLUNAS_NOTAS: ColunaPro[] = [
  { id: "nf", titulo: "NF", largura: 110, obrigatoria: true },
  { id: "serie", titulo: "Série", largura: 64, oculta: true },
  { id: "chave", titulo: "Chave de acesso", largura: 230, oculta: true },
  { id: "fornecedor", titulo: "Fornecedor", minimo: 200, obrigatoria: true, classe: "truncate" },
  { id: "cnpj", titulo: "CNPJ do fornecedor", largura: 156, oculta: true },
  { id: "emissao", titulo: "Emissão", largura: 104 },
  { id: "entrada", titulo: "Entrada", largura: 104, oculta: true },
  { id: "valor", titulo: "Valor (R$)", alinhar: "direita", largura: 120, obrigatoria: true },
  { id: "produtos", titulo: "Produtos (R$)", alinhar: "direita", largura: 120, oculta: true },
  { id: "frete", titulo: "Frete (R$)", alinhar: "direita", largura: 100, oculta: true },
  { id: "desconto", titulo: "Desconto (R$)", alinhar: "direita", largura: 110, oculta: true },
  { id: "icms", titulo: "ICMS (R$)", alinhar: "direita", largura: 100, oculta: true },
  { id: "icmsSt", titulo: "ICMS-ST (R$)", alinhar: "direita", largura: 110, oculta: true },
  { id: "ipi", titulo: "IPI (R$)", alinhar: "direita", largura: 100, oculta: true },
  { id: "itens", titulo: "Itens", alinhar: "direita", largura: 72 },
  { id: "pedido", titulo: "Pedido de compra", largura: 130, oculta: true },
  { id: "lancadoPor", titulo: "Lançada por", largura: 150, oculta: true, classe: "truncate" },
  { id: "situacao", titulo: "Situação", largura: 140 },
  { id: "ver", titulo: "Visualizar", semTitulo: true, fixa: true, largura: 48, alinhar: "centro" },
];

const reais = (n: number | null | undefined) => (n == null ? <span className={PLANILHA.apagado}>—</span> : <span className={PLANILHA.numero}>{formatarMoeda(n).replace("R$", "").trim()}</span>);

export function NotasLista({ notas, periodo, doFinanceiro, vazio, paginacao }: {
  notas: NotaDaLista[]; periodo: PeriodoTela; doFinanceiro: boolean;
  /** O estado vazio (montado na página: nada importado ou nada no filtro) */
  vazio: ReactNode;
  paginacao: ReactNode;
}) {
  const { navegar } = useListaUrl();
  const sp = useSearchParams();
  const [aberta, setAberta] = useState<string | null>(null);
  const hrefNota = (id: string) => `/estoque/notas/${id}${doFinanceiro ? "?de=contas-pagar" : ""}`;
  const porEntrada = sp.get("data") === "entrada";
  const olho = (n: NotaDaLista, extra?: string) => (
    <button type="button" onClick={() => setAberta(n.id)} data-ver-nota={n.numero} aria-label={`Visualizar a NF ${n.numero}/${n.serie}`}
      title="Visualização rápida" className={cn("inline-flex items-center justify-center w-8 h-8 rounded-lg text-ink-muted hover:text-primary-700 hover:bg-primary-50", extra)}>
      <Eye className="w-4 h-4" aria-hidden />
    </button>
  );

  return (
    <>
      <BarraFiltros
        periodo={<BarraPeriodo rotulo={porEntrada ? "Entrada" : "Emissão"} periodo={periodo} navegar={navegar} permitirTodos
          dica={porEntrada ? "Pela data de entrada (o lançamento no estoque). Nota ainda não lançada não tem entrada." : "Pela data de emissão da nota."} />}
        busca={<BuscaUrl lista="notas-compra" placeholder="Pesquisar nº, fornecedor, CNPJ ou chave" rotulo="Pesquisar notas de compra" />}
        paramBusca="q" navegar={navegar}
        filtros={[
          { id: "status", label: "Situação", params: ["status"], render: () => <FiltroSelectUrl param="status" vazio="Todas as situações" rotulo="Situação" className="w-full"
            opcoes={(["IMPORTADA", "CONCILIADA", "LANCADA"] as const).map((s) => ({ value: s, label: LABEL_STATUS_NOTA[s] }))} /> },
          { id: "data", label: "Data do período", params: ["data"], render: () => <FiltroSelectUrl param="data" vazio="Emissão" rotulo="Data do período" className="w-full"
            opcoes={[{ value: "entrada", label: "Entrada (lançamento)" }]} /> },
        ]}
      />
      <div className="card overflow-hidden mt-4">
        <ConteudoUrl>
        {notas.length === 0 ? vazio : (
          <TabelaProUrl
            tela="notas-compra"
            atributos={{ "data-tabela-notas": true }}
            cartoes={
              <ul className="divide-y divide-surface-border" data-cartoes>
                {notas.map((n) => (
                  <li key={n.id} data-nota={n.id} className="px-4 py-3 flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Link href={hrefNota(n.id)} className="font-semibold text-ink hover:text-primary-600">NF {n.numero}/{n.serie}</Link>
                      <p className="text-xs text-ink-muted truncate">{n.fornecedor}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold tabular-nums">{formatarMoeda(n.valorTotal)}</span>
                        <span className="text-ink-subtle">{formatarData(n.emissao)} · {n.itens} itens</span>
                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", COR_STATUS_NOTA[n.status])}>{LABEL_STATUS_NOTA[n.status]}</span>
                      </div>
                    </div>
                    {olho(n, "shrink-0 -mr-1")}
                  </li>
                ))}
              </ul>
            }
            colunas={COLUNAS_NOTAS}
            linhas={notas.map((n) => ({
              id: n.id,
              atributos: { "data-nota": n.id },
              href: hrefNota(n.id),
              // Clicar na linha abre a visualização rápida; Ctrl/⌘ + clique abre a nota em outra aba
              aoAbrir: () => setAberta(n.id),
              titulos: { fornecedor: n.fornecedor, chave: n.chave, lancadoPor: n.lancadoPor ?? undefined },
              celulas: {
                nf: <Link href={hrefNota(n.id)} className={cn(PLANILHA.codigo, "font-semibold text-ink hover:text-primary-600")}>{n.numero}/{n.serie}</Link>,
                serie: <span className="tabular-nums text-ink-muted">{n.serie}</span>,
                chave: (
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[11px] text-ink-muted truncate">{n.chave}</span>
                    <CopiarCodigo texto={n.chave} rotulo="Copiar" />
                  </span>
                ),
                fornecedor: <span className="text-ink-muted">{n.fornecedor}</span>,
                cnpj: <span className="tabular-nums text-ink-muted">{n.cnpj ? formatarCpfCnpj(n.cnpj) : "—"}</span>,
                emissao: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarData(n.emissao)}</span>,
                entrada: n.entrada ? <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarData(n.entrada)}</span> : <span className={PLANILHA.apagado}>—</span>,
                valor: <span className={cn(PLANILHA.numero, "font-semibold text-ink")}>{formatarMoeda(n.valorTotal)}</span>,
                produtos: reais(n.valores?.produtos),
                frete: reais(n.valores?.frete),
                desconto: reais(n.valores?.desconto),
                icms: reais(n.valores?.icms),
                icmsSt: reais(n.valores?.icmsSt),
                ipi: reais(n.valores?.ipi),
                itens: <span className="tabular-nums text-ink-muted">{n.itens}</span>,
                pedido: n.pedido
                  ? <Link href={`/compras/pedidos/${n.pedido.id}`} className={cn(PLANILHA.codigo, "text-primary-700 hover:underline")}>{n.pedido.numero}</Link>
                  : <span className={PLANILHA.apagado}>—</span>,
                lancadoPor: <span className="text-ink-muted">{n.lancadoPor ?? "—"}</span>,
                situacao: <span className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full", COR_STATUS_NOTA[n.status])}>{LABEL_STATUS_NOTA[n.status]}</span>,
                ver: olho(n),
              },
            }))}
          />
        )}
        </ConteudoUrl>
        <div className="px-4 py-3 border-t border-surface-border">{paginacao}</div>
      </div>
      <GavetaNota notaId={aberta} hrefNota={hrefNota} onFechar={() => setAberta(null)} />
    </>
  );
}
