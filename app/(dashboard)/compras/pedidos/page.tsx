import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ShoppingCart } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { wherePedidosCompra } from "@/lib/listas/filtros";
import { cn, formatarData } from "@/lib/utils";
import { CICLO_PEDIDO, LABEL_STATUS_PEDIDO, type StatusPedido } from "@/lib/compras/pedido";
import { origemDoPedidoCompleto } from "@/lib/compras/pedido-server";
import { OrigemPedido, StatusPedidoBadge } from "@/components/compras/pedido-painel";
import { BuscaUrl, ConteudoUrl, FiltroCheckUrl, FiltroSelectUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl } from "@/components/listagem/lista-url";

export const metadata: Metadata = { title: "Pedidos de Compra" };

/** Status legado aparece como o equivalente do ciclo novo (o SQL migra; isto é só garantia) */
const statusTela = (s: string): StatusPedido => (s === "COMPRADO" ? "COTANDO" : s === "ENTREGUE" ? "CONCLUIDO" : s) as StatusPedido;

/**
 * Compras: a lista central de pedidos (de OS, de orçamento e avulsos) com o status e desde quando,
 * filtros, busca e o "Novo pedido avulso". O acesso à rota já é barrado no middleware (Compras ›
 * visualizar); criar avulso exige Compras › Gerenciar.
 */
export default async function PedidosCompraPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  const u = session!.user!;
  const empresaId = u.empresaId;
  const podeCriar = pode(u.permissoes, "compras", "gerenciar", u.role);
  const busca = sp.q ?? "";

  const where = wherePedidosCompra(empresaId, sp);
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const [total, compradores] = await Promise.all([
    prisma.pedidoCompraInterno.count({ where }),
    prisma.usuario.findMany({ where: { empresaId, pedidosComprador: { some: {} } }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);
  const pagina = paginaValida(paginaPedida, porPagina, total);
  const pedidos = total
    ? await prisma.pedidoCompraInterno.findMany({
        where,
        include: {
          itens: { orderBy: { id: "asc" }, select: { descricao: true, quantidade: true, unidade: true } },
          comprador: { select: { nome: true } },
          fornecedor: { select: { nome: true } },
          ordemServico: { select: { id: true, numero: true } },
          orcamento: { select: { id: true, codigo: true, ordensServico: { select: { ordemServico: { select: { id: true, numero: true } } }, take: 1 } } },
        },
        orderBy: [{ criadoEm: "desc" }, { id: "asc" }],
        ...janela(pagina, porPagina),
      })
    : [];
  const linhas = pedidos.map((p) => ({
    ...p, status: statusTela(p.status), origem: origemDoPedidoCompleto(p),
    itensTxt: p.itens.map((i) => `${i.descricao} (${Number(i.quantidade)} ${i.unidade})`).join(", "),
  }));

  return (
    <ListaUrl chave="pedidos-compra" paramBusca="q" qAtual={busca}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-50 rounded-lg"><ShoppingCart className="w-5 h-5 text-primary-600" /></div>
            <h1 className="page-title">Pedidos de Compra</h1>
            <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
          </div>
          {podeCriar && (
            <Link href="/compras/pedidos/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm" data-novo-avulso>
              <Plus className="w-4 h-4" /> Novo pedido avulso
            </Link>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-surface-border flex flex-wrap items-center gap-2 bg-surface-alt/40">
            <div className="flex-1 min-w-[220px]">
              <BuscaUrl lista="pedidos-compra" placeholder="Buscar nº, item, fornecedor, OS…" rotulo="Buscar pedidos de compra" />
            </div>
            <FiltroSelectUrl param="status" vazio="Todos os status" opcoes={CICLO_PEDIDO.map((s) => ({ value: s, label: LABEL_STATUS_PEDIDO[s] }))} />
            <FiltroSelectUrl param="origem" vazio="Toda origem" opcoes={[{ value: "OS", label: "OS" }, { value: "ORCAMENTO", label: "Orçamento" }, { value: "AVULSO", label: "Avulso" }]} />
            {compradores.length > 0 && <FiltroSelectUrl param="compradorId" vazio="Todos compradores" opcoes={compradores.map((c) => ({ value: c.id, label: c.nome }))} />}
            <FiltroCheckUrl param="abertos" rotulo="Só abertos" />
          </div>

          <ConteudoUrl>
            {linhas.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
                <p className="text-sm font-medium text-ink">Nenhum pedido de compra encontrado</p>
                {busca ? <p className="text-xs text-ink-muted">Nada combina com “{busca}”.</p>
                  : <p className="text-xs text-ink-muted">Os pedidos nascem na OS, no orçamento ou aqui, como pedido avulso.</p>}
                <LimparBuscaUrl />
              </div>
            ) : (
              <>
                {/* Celular: um cartão por pedido */}
                <ul className="lg:hidden divide-y divide-surface-border" data-cartoes>
                  {linhas.map((p) => (
                    <li key={p.id} className="px-4 py-3 space-y-1" data-cartao={p.id}>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/compras/pedidos/${p.id}`} className="font-mono font-semibold text-primary-600 hover:underline">{p.numero}</Link>
                        <StatusPedidoBadge status={p.status} desde={p.statusEm.toISOString()} />
                      </div>
                      <p className="text-sm text-ink line-clamp-2">{p.itensTxt}</p>
                      <p className="text-xs text-ink-muted flex flex-wrap gap-x-2">
                        <OrigemPedido pedido={p} />
                        {p.fornecedor && <span>· {p.fornecedor.nome}</span>}
                        {p.prazoNecessario && <span>· até {formatarData(p.prazoNecessario)}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
                <table className="w-full text-sm hidden lg:table">
                  <thead className="bg-surface-alt border-b border-surface-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Número</th>
                      <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Itens</th>
                      <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Origem</th>
                      <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Fornecedor</th>
                      <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden xl:table-cell">Comprador</th>
                      <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Prazo</th>
                      <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((p, idx) => (
                      <tr key={p.id} data-linha={p.id} className={cn("border-b border-surface-border hover:bg-primary-50/40 transition-colors", idx % 2 === 1 && "bg-surface-alt/30")}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Link href={`/compras/pedidos/${p.id}`} className="font-mono font-semibold text-primary-600 hover:underline">{p.numero}</Link>
                        </td>
                        <td className="px-4 py-3 text-ink-muted max-w-[280px]"><span className="block truncate" title={p.itensTxt}>{p.itensTxt}</span></td>
                        <td className="px-4 py-3 text-ink-muted"><OrigemPedido pedido={p} /></td>
                        <td className="px-4 py-3 text-ink-muted">{p.fornecedor?.nome ?? "—"}</td>
                        <td className="px-4 py-3 text-ink-muted hidden xl:table-cell">{p.comprador?.nome ?? "—"}</td>
                        <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{p.prazoNecessario ? formatarData(p.prazoNecessario) : "—"}</td>
                        <td className="px-4 py-3"><StatusPedidoBadge status={p.status} desde={p.statusEm.toISOString()} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </ConteudoUrl>
          <div className="px-4 py-3 border-t border-surface-border bg-surface-alt/40">
            <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="pedidos" />
          </div>
        </div>
      </div>
    </ListaUrl>
  );
}
