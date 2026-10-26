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
import { janela, lerOrdem, lerPaginacao, ordemPrisma, paginaValida } from "@/lib/listagem";
import { ORDEM_CLIENTES, ORDEM_PADRAO_CLIENTES } from "@/lib/listas/ordenacao";
import { BuscaUrl, ConteudoUrl, FiltroCheckUrl, FiltroSelectUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl, ThOrdUrl } from "@/components/listagem/lista-url";

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
          <div className="p-2 bg-primary-50 rounded-lg">
            <Users className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Clientes</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        {podeCriar && (
          <div className="flex items-center gap-2">
            <ImportarClientes />
            <Link
              href="/clientes/novo"
              className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
            >
              <Plus className="w-4 h-4" /> Novo Cliente
            </Link>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        {/* Busca ao vivo + filtros (mudam a URL; o servidor devolve a página nova) */}
        <div className="p-4 border-b border-surface-border flex flex-wrap items-center gap-2 bg-surface-alt/40">
          <div className="flex-1 min-w-[220px]">
            <BuscaUrl lista="clientes" placeholder="Buscar por nome, fantasia ou CPF/CNPJ…" rotulo="Buscar clientes" />
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
                    <span className="text-ink-subtle">{c._count.unidades} end. · {c._count.ordensServico} OS</span>
                    {!c.ativo && <span className="font-bold bg-surface-linha text-ink-muted px-2 py-0.5 rounded-full">Inativo</span>}
                  </div>
                </div>
                <ClienteAcoes id={c.id} nome={c.nomeFantasia ?? c.nome} ativo={c.ativo} />
              </li>
            );
          })}
        </ul>
        <table className="w-full text-sm hidden md:table">
          <thead className="bg-surface-alt border-b border-surface-border">
            <tr>
              {massa && <th className="w-px pl-4 pr-1 py-3"><CheckboxPagina /></th>}
              <ThOrdUrl label="Nome" k="nome" padrao="nome" className="px-4 py-3 text-ink-muted text-xs tracking-wider" />
              <ThOrdUrl label="CPF/CNPJ" k="documento" className="px-4 py-3 text-ink-muted text-xs tracking-wider" />
              <ThOrdUrl label="Segmento" k="segmento" className="px-4 py-3 text-ink-muted text-xs tracking-wider hidden lg:table-cell" />
              <ThOrdUrl label="Satisfação" k="satisfacao" className="px-4 py-3 text-ink-muted text-xs tracking-wider hidden xl:table-cell" />
              <ThOrdUrl label="End." k="unidades" className="px-4 py-3 text-ink-muted text-xs tracking-wider" />
              <ThOrdUrl label="OS" k="os" className="px-4 py-3 text-ink-muted text-xs tracking-wider" />
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
              <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider w-px">Ações</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c, idx) => (
                <tr key={c.id} className={cn(
                  "border-b border-surface-border hover:bg-primary-50/40 transition-colors",
                  idx % 2 === 1 && "bg-surface-alt/30",
                  !c.ativo && "opacity-60",
                )}>
                  {massa && <td className="w-px pl-4 pr-1 py-3"><CheckboxLinha id={c.id} rotulo={c.nomeFantasia ?? c.nome} /></td>}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/clientes/${c.id}/editar`} className="font-semibold text-ink hover:text-primary-600 transition-colors">
                        {c.nomeFantasia ?? c.nome}
                      </Link>
                      {!c.ativo && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-surface-linha text-ink-muted px-2 py-0.5 rounded-full whitespace-nowrap">Inativo</span>
                      )}
                      {c._count.contratos > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-success-50 text-success-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                          <FileCheck className="w-2.5 h-2.5" /> Cliente de Contrato
                        </span>
                      )}
                    </div>
                    {c.nomeFantasia && <p className="text-xs text-ink-subtle mt-0.5">{c.nome}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{formatarCpfCnpj(c.cpfCnpj)}</td>
                  <td className="px-4 py-3 text-ink-muted hidden lg:table-cell text-xs">
                    {c.segmento ? (LABELS_SEGMENTO[c.segmento] ?? c.segmento) : "—"}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <div className="flex justify-center">{estrelas(c.satisfacao)}</div>
                  </td>
                  <td className="px-4 py-3 text-center text-ink-muted">{c._count.unidades}</td>
                  <td className="px-4 py-3 text-center text-ink-muted">{c._count.ordensServico}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const sf = statusFinanceiroMap[c.id] ?? "SEM_HISTORICO";
                      return (
                        <span className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap", COR_STATUS_FINANCEIRO_CALC[sf])}>
                          {LABELS_STATUS_FINANCEIRO_CALC[sf]}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <ClienteAcoes id={c.id} nome={c.nomeFantasia ?? c.nome} ativo={c.ativo} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
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
