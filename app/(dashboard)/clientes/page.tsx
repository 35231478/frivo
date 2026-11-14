import { SelecaoMassaProvider, CheckboxLinha, CheckboxPagina } from "@/components/acoes-massa/selecao";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";
import { temAcaoMassa } from "@/lib/acoes-massa/acoes";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { whereClientes } from "@/lib/listas/filtros";
import { formatarCpfCnpj, cn, LABELS_SEGMENTO } from "@/lib/utils";
import {
  calcularStatusFinanceiroEmLote, LABELS_STATUS_FINANCEIRO_CALC, COR_STATUS_FINANCEIRO_CALC,
  type StatusFinanceiroCalc,
} from "@/lib/status-financeiro";
import { Prisma } from "@prisma/client";
import Link from "next/link";
import { Users, Plus, FileCheck, Star } from "lucide-react";
import { ClienteAcoes } from "@/components/clientes/cliente-acoes";
import { ImportarClientes } from "@/components/clientes/importar-clientes";
import { BaixarPlanilha } from "@/components/importacao/baixar-planilha";
import { janela, lerOrdem, lerPaginacao, ordemPrisma, paginaValida } from "@/lib/listagem";
import { ORDEM_CLIENTES, ORDEM_PADRAO_CLIENTES } from "@/lib/listas/ordenacao";
import { BuscaUrl, ConteudoUrl, FiltroCheckUrl, FiltroSelectUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl, TabelaProUrl } from "@/components/listagem/lista-url";
import { PLANILHA } from "@/lib/planilha";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { busca = "", status = "", segmento = "", inativos = "" } = sp;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const podeCriar = pode(session!.user!.permissoes, "clientes", "criar", session!.user!.role);
  const massa = temAcaoMassa(session!.user!.permissoes, session!.user!.role, "clientes");
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const orderBy = ordemPrisma(lerOrdem(sp, ORDEM_CLIENTES), ORDEM_CLIENTES, ORDEM_PADRAO_CLIENTES) as Prisma.ClienteOrderByWithRelationInput[];

  // O status financeiro é calculado (não é mais coluna filtrável no banco): vem à parte.
  const { where, statusFiltro } = whereClientes(empresaId, { busca, status, segmento, inativos });

  const incluir = {
    _count: { select: { unidades: true, ordensServico: true, contratos: { where: { status: "ATIVO" } } } },
    responsavelTecnico: { select: { nome: true } },
  } satisfies Prisma.ClienteInclude;

  type ClienteRow = Prisma.ClienteGetPayload<{ include: typeof incluir }>;
  let clientes: ClienteRow[] = [];
  let total = 0;
  let pagina = 1;
  let statusFinanceiroMap: Record<string, StatusFinanceiroCalc> = {};

  if (statusFiltro) {
    // Filtro por status calculado: avalia todos os clientes que batem nos demais
    // filtros, calcula o status real e pagina sobre o subconjunto resultante.
    const todos = await prisma.cliente.findMany({ where, select: { id: true }, orderBy });
    statusFinanceiroMap = await calcularStatusFinanceiroEmLote(empresaId, todos.map((c) => c.id));
    const idsFiltrados = todos
      .filter((c) => (statusFinanceiroMap[c.id] ?? "SEM_HISTORICO") === statusFiltro)
      .map((c) => c.id);
    total = idsFiltrados.length;
    pagina = paginaValida(paginaPedida, porPagina, total);
    const { skip, take } = janela(pagina, porPagina);
    const idsPagina = idsFiltrados.slice(skip, skip + take);
    clientes = idsPagina.length
      ? await prisma.cliente.findMany({ where: { id: { in: idsPagina } }, include: incluir, orderBy })
      : [];
  } else {
    total = await prisma.cliente.count({ where });
    pagina = paginaValida(paginaPedida, porPagina, total);
    clientes = total ? await prisma.cliente.findMany({ where, include: incluir, orderBy, ...janela(pagina, porPagina) }) : [];
    statusFinanceiroMap = await calcularStatusFinanceiroEmLote(empresaId, clientes.map((c) => c.id));
  }

  function estrelas(n: number | null) {
    if (!n) return null;
    return (
      <span className="inline-flex items-center gap-0.5" title={`${n} de 5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={cn("w-3 h-3", i < n ? "text-atencao-texto fill-atencao" : "text-surface-border")} />
        ))}
      </span>
    );
  }

  return (
    <SelecaoMassaProvider entidade="clientes" idsPagina={clientes.map((c) => c.id)} total={total}>
    <ListaUrl chave="clientes" paramBusca="busca" qAtual={busca}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-alt rounded-lg"><Users className="w-5 h-5 text-ink-muted" aria-hidden /></div>
          <h1 className="page-title">Clientes</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        {/* No celular: Baixar | Importar numa linha e "Novo cliente" embaixo, na largura toda */}
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <BaixarPlanilha entidade="clientes" className="flex-1 sm:flex-none" />
        {podeCriar && (
          <>
            <ImportarClientes className="flex-1 sm:flex-none" />
            <Link
              href="/clientes/novo"
              data-novo-cliente
              className="basis-full sm:basis-auto inline-flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
            >
              <Plus className="w-4 h-4" aria-hidden /> Novo cliente
            </Link>
          </>
        )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Busca ao vivo + filtros (mudam a URL; o servidor devolve a página nova) */}
        <div className="p-4 border-b border-surface-border flex flex-wrap items-center gap-2 bg-surface-alt/40">
          <div className="flex-1 min-w-[220px]">
            <BuscaUrl lista="clientes" placeholder="Pesquisar por nome, fantasia ou CPF/CNPJ" rotulo="Pesquisar clientes" />
          </div>
          <FiltroSelectUrl param="status" vazio="Status financeiro" opcoes={Object.entries(LABELS_STATUS_FINANCEIRO_CALC).map(([value, label]) => ({ value, label }))} />
          <FiltroSelectUrl param="segmento" vazio="Segmento" opcoes={Object.entries(LABELS_SEGMENTO).map(([value, label]) => ({ value, label }))} />
          <FiltroCheckUrl param="inativos" rotulo="Mostrar inativos" />
        </div>

        <ConteudoUrl>
        {clientes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
            <p className="text-sm font-medium text-ink">Nenhum cliente encontrado</p>
            {busca && <p className="text-xs text-ink-muted">Nada combina com “{busca}”.</p>}
            <LimparBuscaUrl />
          </div>
        ) : (
        <>
        {/* Celular: um cartão por cliente */}
        <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
          {clientes.map((c) => {
            const sf = statusFinanceiroMap[c.id] ?? "SEM_HISTORICO";
            return (
              <li key={c.id} data-cartao={c.id} className={cn("flex items-start gap-3 px-4 py-3", !c.ativo && "opacity-60")}>
                {massa && <span className="pt-0.5"><CheckboxLinha id={c.id} rotulo={c.nomeFantasia ?? c.nome} /></span>}
                <div className="min-w-0 flex-1">
                  <Link href={`/clientes/${c.id}/editar`} className="font-semibold text-ink hover:text-primary-600 block truncate">{c.nomeFantasia ?? c.nome}</Link>
                  <p className="text-xs text-ink-muted truncate">{formatarCpfCnpj(c.cpfCnpj)}{c.segmento ? ` · ${LABELS_SEGMENTO[c.segmento] ?? c.segmento}` : ""}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={cn("font-semibold px-2 py-0.5 rounded-full", COR_STATUS_FINANCEIRO_CALC[sf])}>{LABELS_STATUS_FINANCEIRO_CALC[sf]}</span>
                    <span className="text-ink-subtle">{c._count.unidades} {c._count.unidades === 1 ? "endereço" : "endereços"} · {c._count.ordensServico} OS</span>
                    {!c.ativo && <span className="font-bold bg-surface-linha text-ink-muted px-2 py-0.5 rounded-full">Inativo</span>}
                  </div>
                </div>
                <ClienteAcoes id={c.id} nome={c.nomeFantasia ?? c.nome} ativo={c.ativo} />
              </li>
            );
          })}
        </ul>
        <TabelaProUrl
          tela="clientes" padrao="nome" atributos={{ "data-tabela-clientes": true }}
          barra={<span>{total === 1 ? "1 cliente" : `${total} clientes`}</span>}
          colunas={[
            ...(massa ? [{ id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: <CheckboxPagina />, classe: "pl-3" }] : []),
            { id: "nome", titulo: "Nome", ordenar: "nome", obrigatoria: true, minimo: 220 },
            { id: "documento", titulo: "CPF/CNPJ", largura: 152, ordenar: "documento" },
            { id: "segmento", titulo: "Segmento", largura: 140, ordenar: "segmento", classe: "truncate" },
            { id: "satisfacao", titulo: "Satisfação", largura: 100, ordenar: "satisfacao" },
            { id: "unidades", titulo: "Endereços", largura: 116, alinhar: "centro", ordenar: "unidades" },
            { id: "os", titulo: "OS", largura: 60, alinhar: "centro", ordenar: "os" },
            { id: "status", titulo: "Status financeiro", largura: 148 },
            { id: "acoes", titulo: "Ações", fixa: true, semTitulo: true, largura: 80, alinhar: "direita", classe: "py-0.5" },
          ]}
          linhas={clientes.map((c) => {
            const nome = c.nomeFantasia ?? c.nome;
            const sf = statusFinanceiroMap[c.id] ?? "SEM_HISTORICO";
            return {
              id: c.id, atributos: { "data-cliente": c.id }, classe: c.ativo ? undefined : "opacity-60",
              // A razão social (quando há fantasia) aparece inteira ao passar o mouse
              titulos: { nome: c.nomeFantasia ? `${c.nomeFantasia} · ${c.nome}` : c.nome, segmento: c.segmento ? (LABELS_SEGMENTO[c.segmento] ?? c.segmento) : undefined },
              celulas: {
                sel: massa ? <CheckboxLinha id={c.id} rotulo={nome} /> : null,
                nome: (
                  <span className="flex items-center gap-2 min-w-0">
                    <Link href={`/clientes/${c.id}/editar`} className={cn(PLANILHA.nome, "truncate hover:text-primary-600")}>{nome}</Link>
                    {!c.ativo && <span className="text-[10px] font-bold bg-surface-linha text-ink-muted px-2 py-0.5 rounded-full whitespace-nowrap">Inativo</span>}
                    {c._count.contratos > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-ok-claro text-ok-texto px-2 py-0.5 rounded-full whitespace-nowrap" title="Tem contrato ativo">
                        <FileCheck className="w-2.5 h-2.5" aria-hidden /> Contrato
                      </span>
                    )}
                  </span>
                ),
                documento: <span className={cn(PLANILHA.apagado, "whitespace-nowrap tabular-nums")}>{formatarCpfCnpj(c.cpfCnpj)}</span>,
                segmento: c.segmento ? <span className={PLANILHA.apagado}>{LABELS_SEGMENTO[c.segmento] ?? c.segmento}</span> : <span className="text-ink-subtle">—</span>,
                satisfacao: estrelas(c.satisfacao) ?? <span className="text-ink-subtle">—</span>,
                unidades: <span className={cn(PLANILHA.apagado, "tabular-nums")}>{c._count.unidades}</span>,
                os: <span className={cn(PLANILHA.apagado, "tabular-nums")}>{c._count.ordensServico}</span>,
                status: <span className={cn("text-[10px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap", COR_STATUS_FINANCEIRO_CALC[sf])}>{LABELS_STATUS_FINANCEIRO_CALC[sf]}</span>,
                acoes: <ClienteAcoes id={c.id} nome={nome} ativo={c.ativo} />,
              },
            };
          })}
        />
        </>
        )}
        </ConteudoUrl>
        <div className="px-4 py-3 border-t border-surface-border">
          <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="clientes" />
        </div>
      </div>
    </div>
    </ListaUrl>
    <BarraAcoesMassa />
    </SelecaoMassaProvider>
  );
}
