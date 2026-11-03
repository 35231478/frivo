import { SelecaoMassaProvider, CheckboxLinha, CheckboxPagina } from "@/components/acoes-massa/selecao";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";
import { temAcaoMassa } from "@/lib/acoes-massa/acoes";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CARDS_PERIODO_ORCAMENTOS, condCardPeriodoOrcamentos, condPeriodoCriacao, whereListaOrcamentos } from "@/lib/listas/filtros";
import { lerPeriodo, periodoTela } from "@/lib/periodo";
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
import { ConteudoUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl, TabelaProUrl } from "@/components/listagem/lista-url";

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
      <PeriodoCardsOrcamentos
        periodo={periodoTela(periodo)} resumo={resumo} card={card} resposta={resposta}
        opcoes={{
          tipos: Object.entries(LABELS_TIPO_ORCAMENTO).map(([value, label]) => ({ value, label })),
          status: Object.entries(LABELS_ETAPA).map(([value, label]) => ({ value, label })),
          clientes: clientes.map((c) => ({ value: c.id, label: c.nomeFantasia ?? c.nome })),
        }}
      />

      <div className="card overflow-hidden">
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
        {/* Desktop: a tabela profissional (components/listagem/tabela-pro — colunas redimensionáveis, menu "Colunas", preferência por usuário) */}
        <div data-tabela-orcamentos>
          <TabelaProUrl
            tela="orcamentos" padrao="criado"
            colunas={[
              ...(massa ? [{ id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: <CheckboxPagina />, classe: "pl-3" }] : []),
              { id: "codigo", titulo: "Código", largura: 120, ordenar: "codigo", obrigatoria: true, classe: "truncate" },
              { id: "nome", titulo: "Nome", ordenar: "nome", obrigatoria: true, classe: "truncate" },
              { id: "cliente", titulo: "Cliente", largura: 220, ordenar: "cliente", classe: "truncate" },
              { id: "tipo", titulo: "Tipo", largura: 128, oculta: true, classe: "truncate" },
              { id: "status", titulo: "Status", largura: 136, ordenar: "status" },
              { id: "valor", titulo: "Valor (R$)", alinhar: "direita", largura: 120, ordenar: "valor", obrigatoria: true },
              { id: "validade", titulo: "Validade", largura: 92 },
              { id: "os", titulo: "OS", alinhar: "centro", largura: 48, oculta: true },
              { id: "criado", titulo: "Criado", largura: 92, ordenar: "criado" },
              { id: "acoes", titulo: "Ações", fixa: true, largura: 136, semTitulo: true, alinhar: "direita", classe: "py-0.5" },
            ]}
            linhas={orcamentos.map((o) => {
              const cliente = o.cliente.nomeFantasia ?? o.cliente.nome;
              return {
                id: o.id,
                atributos: { "data-linha-orcamento": o.id },
                titulos: { nome: o.nome, cliente },
                celulas: {
                  sel: massa ? <CheckboxLinha id={o.id} rotulo={o.codigo} /> : null,
                  codigo: <Link href={`/orcamentos/${o.id}`} title={o.codigo} className={cn(PLANILHA.codigo, "text-primary-600 hover:underline")}>{o.codigo}</Link>,
                  // Uma linha só: o texto inteiro aparece no hover
                  nome: <span className={PLANILHA.nome} data-nome-orcamento>{o.nome}</span>,
                  cliente: <span className="text-ink" data-cliente-orcamento>{cliente}</span>,
                  tipo: <span className={CLASSE_TIPO_ORCAMENTO[o.tipo]}>{LABELS_TIPO_ORCAMENTO[o.tipo]}</span>,
                  status: <PilulaEtapa etapa={etapaCiclo(o, agora)} desde={dataDaEtapa(o, agora)} compacta />,
                  valor: <span className={cn(PLANILHA.numero, "font-semibold text-ink")} data-valor>{valorSemMoeda(Number(o.totalGeral))}</span>,
                  validade: <span className={cn(PLANILHA.data, PLANILHA.apagado)} data-validade>{o.validadeEm ? formatarData(o.validadeEm) : "—"}</span>,
                  os: <span className="tabular-nums text-ink-muted">{o._count.ordensServico}</span>,
                  criado: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarData(o.criadoEm)}</span>,
                  acoes: (
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
                  ),
                },
              };
            })}
          />
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
