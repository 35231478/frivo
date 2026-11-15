import type { Metadata } from "next";
import Link from "next/link";
import { FileBadge, Plus, Pencil, MapPin } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import { dataBR, lerFiltrosPmoc, wherePmoc, LABELS_STATUS_PMOC } from "@/lib/pmoc";
import { PmocStatusSelo } from "@/components/pmoc/pmoc-status-selo";
import { PmocCopiarBotao } from "@/components/pmoc/pmoc-copiar-botao";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { PmocConfigBotao } from "@/components/pmoc/pmoc-config-botao";
import { configPmoc } from "@/lib/pmoc-documento-server";
import { janela, lerOrdem, lerPaginacao, ordemPrisma, paginaValida } from "@/lib/listagem";
import { ORDEM_PMOC, ORDEM_PADRAO_PMOC } from "@/lib/listas/ordenacao";
import {
  BuscaUrl, ConteudoUrl, FiltroCheckUrl, FiltroSelectUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl, TabelaProUrl,
} from "@/components/listagem/lista-url";
import { PLANILHA } from "@/lib/planilha";
import { Dica } from "@/components/ui/dica";

export const metadata: Metadata = { title: "PMOC" };

/** Princípio 7: a base legal sai do corpo da tela e vira o ⓘ do título. */
const AJUDA = "Plano de Manutenção, Operação e Controle dos sistemas de climatização, exigido pela Lei 13.589/2018. Cada plano reúne o local, os equipamentos cobertos, o cronograma e o responsável técnico, e gera o documento para o cliente.";

export default async function PmocListaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltrosPmoc(sp);
  const session = await auth();
  const { empresaId, permissoes, role } = session!.user!;
  const podeCriar = pode(permissoes, "pmoc", "criar", role);
  const podeEditar = pode(permissoes, "pmoc", "editar", role);

  const { diasAviso } = await configPmoc(empresaId);
  const where = wherePmoc(empresaId, f, diasAviso);
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const orderBy = ordemPrisma(lerOrdem(sp, ORDEM_PMOC), ORDEM_PMOC, ORDEM_PADRAO_PMOC) as never;

  const total = await prisma.pmoc.count({ where });
  const pagina = paginaValida(paginaPedida, porPagina, total);
  const { skip, take } = janela(pagina, porPagina);
  const pmocs = await prisma.pmoc.findMany({
    where,
    select: {
      id: true, nome: true, status: true, dataInicio: true, dataExpiracao: true, ativo: true,
      cliente: { select: { nome: true, nomeFantasia: true } },
      unidade: { select: { nome: true, cidade: true, estado: true } },
      _count: { select: { equipamentos: true } },
    },
    orderBy, skip, take,
  });

  const local = (u: { nome: string; cidade: string | null; estado: string | null }) => [u.nome, [u.cidade, u.estado].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  const acoes = (p: (typeof pmocs)[number]) => (
    <div className="flex items-center justify-end gap-0.5">
      <Link href={`/pmoc/${p.id}`} title={podeEditar ? "Editar" : "Visualizar"} aria-label={podeEditar ? "Editar" : "Visualizar"}
        className="p-1.5 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><Pencil className="w-4 h-4" aria-hidden /></Link>
      <PmocCopiarBotao id={p.id} />
      <InativarRegistro url={`/api/pmocs/${p.id}`} modulo="pmoc" acaoReativar="editar" ativo={p.ativo} nome={p.nome} entidade="PMOC" comMotivo={false} />
    </div>
  );

  return (
    <ListaUrl chave="pmoc" paramBusca="busca" qAtual={f.busca}>
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-alt rounded-lg"><FileBadge className="w-5 h-5 text-ink-muted" aria-hidden /></div>
          <h1 className="page-title flex items-center gap-1.5">PMOC <Dica texto={AJUDA} rotulo="PMOC" lado="direita" /></h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {podeEditar && <PmocConfigBotao />}
          {podeCriar && (
            <Link href="/pmoc/novo" data-novo-pmoc
              className="basis-full sm:basis-auto inline-flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm">
              <Plus className="w-4 h-4" aria-hidden /> Novo PMOC
            </Link>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Busca ao vivo + filtros (mudam a URL; o servidor devolve a página nova) */}
        <div className="p-4 border-b border-surface-border flex flex-wrap items-center gap-2 bg-surface-alt/40">
          <div className="flex-1 min-w-[220px]">
            <BuscaUrl lista="pmoc" placeholder="Pesquisar por nome, cliente ou local" rotulo="Pesquisar PMOC" />
          </div>
          <FiltroSelectUrl param="status" vazio="Todos os status" rotulo="Filtrar por status"
            opcoes={[
              ...Object.entries(LABELS_STATUS_PMOC).map(([value, label]) => ({ value, label })),
              { value: "VENCENDO", label: `Vencendo em até ${diasAviso} dias` },
            ]} />
          <FiltroCheckUrl param="inativos" rotulo="Mostrar inativos" />
        </div>

        <ConteudoUrl>
        {pmocs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
            <p className="text-sm font-medium text-ink">Nenhum PMOC encontrado</p>
            {f.busca && <p className="text-xs text-ink-muted">Nada combina com “{f.busca}”.</p>}
            {!f.busca && <p className="text-xs text-ink-muted">{podeCriar ? "Crie o primeiro plano em “Novo PMOC”." : "Ainda não há planos cadastrados."}</p>}
            <LimparBuscaUrl />
          </div>
        ) : (
        <>
        {/* Celular: um cartão por plano */}
        <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
          {pmocs.map((p) => (
            <li key={p.id} data-pmoc-card={p.id} className={cn("p-4 space-y-1.5", !p.ativo && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/pmoc/${p.id}`} className="font-semibold text-ink">{p.nome}</Link>
                <PmocStatusSelo pmoc={p} diasAviso={diasAviso} />
              </div>
              <p className="text-sm text-ink-muted">{p.cliente.nomeFantasia ?? p.cliente.nome}</p>
              <p className="text-xs text-ink-muted flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden /> {local(p.unidade)}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-subtle">
                  Validade {dataBR(p.dataInicio)} – {dataBR(p.dataExpiracao)} · {p._count.equipamentos} {p._count.equipamentos === 1 ? "equipamento" : "equipamentos"}
                </span>
                {acoes(p)}
              </div>
            </li>
          ))}
        </ul>
        <TabelaProUrl
          tela="pmoc" padrao="validade" atributos={{ "data-tabela-pmoc": true }}
          barra={<span>{total === 1 ? "1 PMOC" : `${total} PMOC`}</span>}
          colunas={[
            { id: "nome", titulo: "Nome", ordenar: "nome", obrigatoria: true, minimo: 220 },
            { id: "cliente", titulo: "Cliente", ordenar: "cliente", minimo: 160, classe: "truncate" },
            { id: "local", titulo: "Local", ordenar: "local", minimo: 180, classe: "truncate" },
            { id: "equipamentos", titulo: "Equipamentos", largura: 124, alinhar: "centro", ordenar: "equipamentos" },
            { id: "status", titulo: "Status", largura: 150 },
            { id: "validade", titulo: "Validade", largura: 184, ordenar: "validade" },
            { id: "acoes", titulo: "Ações", fixa: true, semTitulo: true, largura: 112, alinhar: "direita", classe: "py-0.5" },
          ]}
          linhas={pmocs.map((p) => ({
            id: p.id, atributos: { "data-pmoc-id": p.id }, classe: p.ativo ? undefined : "opacity-60",
            titulos: { cliente: p.cliente.nomeFantasia ? `${p.cliente.nomeFantasia} · ${p.cliente.nome}` : p.cliente.nome, local: local(p.unidade) },
            celulas: {
              nome: (
                <span className="flex items-center gap-2 min-w-0">
                  <Link href={`/pmoc/${p.id}`} className={cn(PLANILHA.nome, "truncate hover:text-primary-600")}>{p.nome}</Link>
                  {!p.ativo && <span className="text-[10px] font-bold bg-surface-linha text-ink-muted px-2 py-0.5 rounded-full whitespace-nowrap">Inativo</span>}
                </span>
              ),
              cliente: <span className={PLANILHA.apagado}>{p.cliente.nomeFantasia ?? p.cliente.nome}</span>,
              local: <span className={PLANILHA.apagado}>{local(p.unidade)}</span>,
              equipamentos: <span className={cn(PLANILHA.apagado, "tabular-nums")}>{p._count.equipamentos}</span>,
              status: <PmocStatusSelo pmoc={p} diasAviso={diasAviso} />,
              validade: <span className={cn(PLANILHA.apagado, PLANILHA.data)}>{dataBR(p.dataInicio)} – {dataBR(p.dataExpiracao)}</span>,
              acoes: acoes(p),
            },
          }))}
        />
        </>
        )}
        </ConteudoUrl>
        <div className="px-4 py-3 border-t border-surface-border">
          <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="PMOC" />
        </div>
      </div>
    </div>
    </ListaUrl>
  );
}
