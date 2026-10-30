import { SelecaoMassaProvider, CheckboxLinha, CheckboxPagina } from "@/components/acoes-massa/selecao";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";
import { temAcaoMassa } from "@/lib/acoes-massa/acoes";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CARDS_PERIODO_ORCAMENTOS, condCardPeriodoOrcamentos, condPeriodoCriacao, whereListaOrcamentos } from "@/lib/listas/filtros";
import { lerPeriodo } from "@/lib/periodo";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";
import { PeriodoCardsOrcamentos, VerTodoPeriodo, type ResumoOrcamentos } from "@/components/orcamento/orcamentos-periodo";
import { cn, formatarData, formatarMoeda, LABELS_TIPO_ORCAMENTO, CLASSE_TIPO_ORCAMENTO } from "@/lib/utils";
import { LABELS_ETAPA, bloqueioEnvio, dataDaEtapa, etapaCiclo } from "@/lib/orcamentos/ciclo";
import { AcoesLinhaOrcamento } from "@/components/orcamento/acoes-linha-orcamento";
import { pode } from "@/lib/permissoes";
import { PilulaEtapa } from "@/components/orcamento/ciclo-orcamento";
import Link from "next/link";
import { Calculator, Plus, X } from "lucide-react";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import type { Prisma } from "@prisma/client";
import { janela, lerOrdem, lerPaginacao, ordemPrisma, paginaValida } from "@/lib/listagem";
import { ORDEM_ORCAMENTOS, ORDEM_PADRAO_ORCAMENTOS } from "@/lib/listas/ordenacao";
import { BuscaUrl, ConteudoUrl, FiltroCheckUrl, FiltroSelectUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl, ThOrdUrl } from "@/components/listagem/lista-url";

export const metadata: Metadata = { title: "Orçamentos" };

export default async function OrcamentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { busca = "", resposta = "", card = "" } = sp;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const massa = temAcaoMassa(session!.user!.permissoes, session!.user!.role, "orcamentos");
  // Enviar (e-mail/WhatsApp) exige editar orçamentos, como a rota de envio; baixar o PDF basta ver
  const podeEnviar = pode(session!.user!.permissoes, "orcamentos", "editar", session!.user!.role);
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const orderBy = ordemPrisma(lerOrdem(sp, ORDEM_ORCAMENTOS), ORDEM_ORCAMENTOS, ORDEM_PADRAO_ORCAMENTOS) as Prisma.OrcamentoOrderByWithRelationInput[];

  const agora = new Date();
  // Período (padrão da casa) pela DATA DE CRIAÇÃO: mês com ‹ ›, intervalo ou todo o período — na URL.
  // As datas antigas do painel (dataInicio/dataFim) viraram o período.
  const periodo = lerPeriodo(sp, agora, { permitirTodos: true });
  const where = whereListaOrcamentos(empresaId, sp, periodo, agora);
  // Cards de funil: só o período (busca e demais filtros mexem só na lista)
  const noPeriodo = condPeriodoCriacao(periodo);
  const soma = (c: string) => prisma.orcamento.aggregate({
    where: { empresaId, AND: [noPeriodo ?? {}, condCardPeriodoOrcamentos(c, agora) ?? {}] as object[] },
    _sum: { totalGeral: true }, _count: true,
  });

  const [total, clientes, aggCards] = await Promise.all([
    prisma.orcamento.count({ where }),
    prisma.cliente.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
    Promise.all(CARDS_PERIODO_ORCAMENTOS.map(soma)),
  ]);
  const resumo = Object.fromEntries(CARDS_PERIODO_ORCAMENTOS.map((k, i) => {
    const a = aggCards[i] as { _sum?: { totalGeral?: unknown }; _count: number };
    return [k, { v: Number(a._sum?.totalGeral ?? 0), q: a._count }];
  })) as ResumoOrcamentos;
  const pagina = paginaValida(paginaPedida, porPagina, total);
  const orcamentos = total ? await prisma.orcamento.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true, logo: true } },
      _count: { select: { ordensServico: true } },
    },
    orderBy,
    ...janela(pagina, porPagina),
  }) : [];

  return (
    <SelecaoMassaProvider entidade="orcamentos" idsPagina={orcamentos.map((o) => o.id)} total={total}>
    <ListaUrl chave="orcamentos" paramBusca="busca" qAtual={busca}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <Calculator className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Orçamentos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <Link
          href="/orcamentos/novo"
          className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
        >
          <Plus className="w-4 h-4" /> Novo Orçamento
        </Link>
      </div>

      {/* Período (pela criação) + cards de funil do período, clicáveis como filtro — padrão da casa */}
      <PeriodoCardsOrcamentos periodo={{ tipo: periodo.tipo, mes: periodo.mes, de: periodo.de, ate: periodo.ate, rotulo: periodo.rotulo }} resumo={resumo} card={card} />

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[220px]">
              <BuscaUrl lista="orcamentos" placeholder="Buscar por código, nome ou cliente…" rotulo="Buscar orçamentos" />
            </div>
            <FiltroSelectUrl param="tipo" vazio="Todos os tipos" opcoes={Object.entries(LABELS_TIPO_ORCAMENTO).map(([value, label]) => ({ value, label }))} />
            <FiltroSelectUrl param="status" vazio="Todos status" opcoes={Object.entries(LABELS_ETAPA).map(([value, label]) => ({ value, label }))} />
            <FiltroSelectUrl param="clienteId" vazio="Todos clientes" opcoes={clientes.map((c) => ({ value: c.id, label: c.nomeFantasia ?? c.nome }))} />
            <FiltroCheckUrl param="inativos" rotulo="Mostrar cancelados" />
            {resposta === "nova" && (
              <Link href="/orcamentos?periodo=todos" className="inline-flex items-center gap-1.5 rounded-full bg-acento-claro text-acento text-xs font-semibold px-3 py-1.5" data-filtro-resposta>
                Respostas novas do cliente <X className="w-3.5 h-3.5" aria-hidden /><span className="sr-only">Limpar filtro</span>
              </Link>
            )}
          </div>
        </div>

        <ConteudoUrl>
        {orcamentos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
            <p className="text-sm font-medium text-ink">{periodo.tipo === "todos" ? "Nenhum orçamento encontrado" : `Nenhum orçamento em ${periodo.tipo === "mes" ? periodo.rotulo.toLowerCase() : "o período"}`}</p>
            {busca && <p className="text-xs text-ink-muted">Nada combina com “{busca}”.</p>}
            <LimparBuscaUrl />
            {periodo.tipo !== "todos" && <VerTodoPeriodo />}
          </div>
        ) : (
        <>
        {/* Celular: um cartão por orçamento */}
        <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
          {orcamentos.map((o) => (
            <li key={o.id} data-cartao={o.id} className="flex items-start gap-3 px-4 py-3">
              {massa && <span className="pt-0.5"><CheckboxLinha id={o.id} rotulo={o.codigo} /></span>}
              <Link href={`/orcamentos/${o.id}`} className="min-w-0 flex-1">
                <p className="text-sm font-mono font-semibold text-primary-600">{o.codigo}</p>
                <p className="text-sm text-ink font-medium truncate" title={o.nome} data-nome-orcamento>{o.nome}</p>
                <p className="text-xs text-ink-muted truncate">{o.cliente.nomeFantasia ?? o.cliente.nome} · {formatarData(o.criadoEm)}{o.validadeEm && ` · válido até ${formatarData(o.validadeEm)}`}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <PilulaEtapa etapa={etapaCiclo(o, agora)} desde={dataDaEtapa(o, agora)} />
                  <span className="text-sm font-semibold text-ink ml-auto tabular-nums">{formatarMoeda(Number(o.totalGeral))}</span>
                </div>
              </Link>
              <div className="shrink-0 -mr-2">
                <AcoesLinhaOrcamento orcamentoId={o.id} codigo={o.codigo} tokenPublico={o.tokenPublico} podeEnviar={podeEnviar} bloqueio={bloqueioEnvio(o, agora)} />
              </div>
            </li>
          ))}
        </ul>
        {/* Desktop: "cara de planilha" (lib/planilha — o mesmo estilo de Contas a Receber/Pagar e do orçamento) */}
        <div className="overflow-x-auto hidden md:block" data-tabela-orcamentos>
          <table className={cn(PLANILHA.tabela, "table-fixed")} data-tabela-planilha>
            <thead>
              <tr className={PLANILHA.cabecalho}>
                {massa && <th scope="col" className={cn(PLANILHA.th, "w-9 pl-3")}><CheckboxPagina /></th>}
                <ThOrdUrl label="Código" k="codigo" className={cn(PLANILHA.th, "w-[7.5rem]")} />
                <ThOrdUrl label="Nome" k="nome" className={PLANILHA.th} />
                <ThOrdUrl label="Cliente" k="cliente" className={cn(PLANILHA.th, "w-[17%]")} />
                <th scope="col" className={cn(PLANILHA.th, "text-left hidden 2xl:table-cell w-[8rem]")}>Tipo</th>
                <ThOrdUrl label="Status" k="status" className={cn(PLANILHA.th, "w-[8.5rem]")} />
                <ThOrdUrl label="Valor (R$)" k="valor" className={cn(PLANILHA.th, "text-right w-[7.5rem]")} />
                <th scope="col" className={cn(PLANILHA.th, "text-left hidden xl:table-cell w-[5.75rem]")}>Validade</th>
                <th scope="col" className={cn(PLANILHA.th, "text-center hidden 2xl:table-cell w-12")}>OS</th>
                <ThOrdUrl label="Criado" k="criado" padrao="criado" className={cn(PLANILHA.th, "hidden lg:table-cell w-[5.75rem]")} />
                <th scope="col" className={cn(PLANILHA.th, "w-[8.5rem]")}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {orcamentos.map((o) => {
                const cliente = o.cliente.nomeFantasia ?? o.cliente.nome;
                return (
                  <tr key={o.id} data-linha-orcamento={o.id} className={cn(PLANILHA.linha, "hover:bg-primary-50/40")}>
                    {massa && <td className={cn(PLANILHA.td, "align-middle pl-3")}><CheckboxLinha id={o.id} rotulo={o.codigo} /></td>}
                    <td className={cn(PLANILHA.td, "align-middle truncate")}>
                      <Link href={`/orcamentos/${o.id}`} title={o.codigo} className="font-mono text-[12px] font-semibold text-primary-600 hover:underline">{o.codigo}</Link>
                    </td>
                    {/* Uma linha só: o texto inteiro aparece no hover */}
                    <td className={cn(PLANILHA.td, "align-middle truncate font-medium text-ink")} title={o.nome} data-nome-orcamento>{o.nome}</td>
                    <td className={cn(PLANILHA.td, "align-middle truncate text-ink")} title={cliente} data-cliente-orcamento>{cliente}</td>
                    <td className={cn(PLANILHA.td, "align-middle hidden 2xl:table-cell truncate")}>
                      <span className={CLASSE_TIPO_ORCAMENTO[o.tipo]}>{LABELS_TIPO_ORCAMENTO[o.tipo]}</span>
                    </td>
                    <td className={cn(PLANILHA.td, "align-middle")}>
                      <PilulaEtapa etapa={etapaCiclo(o, agora)} desde={dataDaEtapa(o, agora)} compacta />
                    </td>
                    <td className={cn(PLANILHA.td, PLANILHA.numero, "align-middle font-semibold text-ink")} data-valor>{valorSemMoeda(Number(o.totalGeral))}</td>
                    <td className={cn(PLANILHA.td, "align-middle hidden xl:table-cell tabular-nums whitespace-nowrap text-ink-muted")} data-validade>{o.validadeEm ? formatarData(o.validadeEm) : "—"}</td>
                    <td className={cn(PLANILHA.td, "align-middle text-center text-ink-muted hidden 2xl:table-cell tabular-nums")}>{o._count.ordensServico}</td>
                    <td className={cn(PLANILHA.td, "align-middle hidden lg:table-cell tabular-nums whitespace-nowrap text-ink-muted")}>{formatarData(o.criadoEm)}</td>
                    <td className={cn(PLANILHA.td, "align-middle py-0.5 text-right")}>
                      <div className="flex items-center justify-end gap-0.5">
                      <AcoesLinhaOrcamento orcamentoId={o.id} codigo={o.codigo} tokenPublico={o.tokenPublico} podeEnviar={podeEnviar} bloqueio={bloqueioEnvio(o, agora)} />
                      <InativarRegistro
                        url={`/api/orcamentos/${o.id}`} modulo="orcamentos" acaoReativar="editar"
                        ativo={o.status !== "CANCELADO"} nome={o.codigo} entidade="orçamento"
                        rotuloInativar="Cancelar" rotuloReativar="Reabrir" comMotivo={false}
                        textoInativar="Tem certeza? O orçamento passa para Cancelado e sai da lista padrão. Nada é apagado: itens, vínculos e o link público ficam preservados, e ele pode ser reaberto (volta para Rascunho)."
                        textoReativar="O orçamento volta para Rascunho (editável) e reaparece na lista."
                      />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
        )}
        </ConteudoUrl>
        <div className="px-4 py-3 border-t border-surface-border">
          <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="orçamentos" />
        </div>
      </div>
    </div>
    </ListaUrl>
    <BarraAcoesMassa />
    </SelecaoMassaProvider>
  );
}
