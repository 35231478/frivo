import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Package, ScrollText } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import { contarAlertas, FILTROS_SITUACAO, listarEstoque } from "@/lib/estoque/servidor";
import { formatarQtd } from "@/lib/estoque/regras";
import { LancarEstoque } from "@/components/estoque/lancar-estoque";
import { SaldoQtd, SeloSituacao } from "@/components/estoque/situacao";
import { BuscaUrl, ConteudoUrl, FiltroCheckUrl, FiltroSelectUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl, ThOrdUrl } from "@/components/listagem/lista-url";

export const metadata: Metadata = { title: "Estoque" };

/**
 * Estoque: saldo de cada produto (cache da soma do razão), destaque de quem está no mínimo ou
 * abaixo / negativo, e o lançamento manual (entrada, ajuste, inventário) para quem gerencia.
 * O acesso à rota já é barrado no middleware (Estoque › visualizar).
 */
export default async function EstoquePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  const u = session!.user!;
  const podeLancar = pode(u.permissoes, "estoque", "gerenciar", u.role);
  const [lista, alertas] = await Promise.all([listarEstoque(u.empresaId, sp), contarAlertas(u.empresaId)]);
  const { itens, total, pagina, porPagina, busca } = lista;

  return (
    <ListaUrl chave="estoque" paramBusca="busca" qAtual={busca}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-50 rounded-lg"><Package className="w-5 h-5 text-primary-600" /></div>
            <h1 className="page-title">Estoque</h1>
            <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
          </div>
        </div>

        {/* Aviso no topo: quantos estão no mínimo (ou abaixo) e quantos negativos — clicar filtra */}
        {(alertas.abaixo > 0 || alertas.negativo > 0) && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm" data-alertas>
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            {alertas.abaixo > 0 && (
              <Link href="/estoque?situacao=abaixo" className="font-semibold text-amber-800 hover:underline" data-alerta="abaixo">
                {alertas.abaixo} {alertas.abaixo === 1 ? "produto" : "produtos"} no mínimo ou abaixo
              </Link>
            )}
            {alertas.abaixo > 0 && alertas.negativo > 0 && <span className="text-amber-700">·</span>}
            {alertas.negativo > 0 && (
              <Link href="/estoque?situacao=negativo" className="font-semibold text-red-700 hover:underline" data-alerta="negativo">
                {alertas.negativo} com saldo negativo
              </Link>
            )}
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-surface-border flex flex-wrap items-center gap-2 bg-surface-alt/40">
            <div className="flex-1 min-w-[220px]">
              <BuscaUrl lista="estoque" placeholder="Buscar produto…" rotulo="Buscar produtos no estoque" />
            </div>
            <FiltroSelectUrl param="situacao" vazio="Situação" opcoes={Object.entries(FILTROS_SITUACAO).map(([value, label]) => ({ value, label }))} />
            <FiltroCheckUrl param="inativos" rotulo="Mostrar inativos" />
          </div>

          <ConteudoUrl>
            {itens.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
                <p className="text-sm font-medium text-ink">Nenhum produto encontrado</p>
                {busca ? <p className="text-xs text-ink-muted">Nada combina com “{busca}”.</p>
                  : <p className="text-xs text-ink-muted">Os produtos vêm do cadastro em Configurações › Produtos.</p>}
                <LimparBuscaUrl />
              </div>
            ) : (
              <>
                {/* Celular: um cartão por produto */}
                <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
                  {itens.map((p) => (
                    <li key={p.id} data-cartao={p.id} className={cn("flex items-start gap-3 px-4 py-3", !p.ativo && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <Link href={`/estoque/${p.id}`} className="font-semibold text-ink hover:text-primary-600 block truncate">{p.nome}</Link>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <SaldoQtd saldo={p.saldo} unidade={p.unidade} situacao={p.situacao} />
                          {p.estoqueMinimo != null && <span className="text-ink-subtle">mín. {formatarQtd(p.estoqueMinimo)}</span>}
                          {p.situacao !== "ok" && <SeloSituacao situacao={p.situacao} />}
                        </div>
                      </div>
                      {podeLancar && <LancarEstoque compacto produto={{ id: p.id, nome: p.nome, unidade: p.unidade, saldo: p.saldo }} />}
                    </li>
                  ))}
                </ul>
                <table className="w-full text-sm hidden md:table">
                  <thead className="bg-surface-alt border-b border-surface-border">
                    <tr>
                      <ThOrdUrl label="Produto" k="nome" padrao="nome" className="px-4 py-3 text-ink-muted text-xs tracking-wider" />
                      <ThOrdUrl label="Un." k="unidade" className="px-4 py-3 text-ink-muted text-xs tracking-wider" />
                      <ThOrdUrl label="Saldo" k="saldo" className="px-4 py-3 text-ink-muted text-xs tracking-wider" />
                      <ThOrdUrl label="Mínimo" k="minimo" className="px-4 py-3 text-ink-muted text-xs tracking-wider" />
                      <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Situação</th>
                      <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider w-px">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((p, idx) => (
                      <tr key={p.id} data-linha={p.id} className={cn(
                        "border-b border-surface-border hover:bg-primary-50/40 transition-colors",
                        idx % 2 === 1 && "bg-surface-alt/30", p.situacao === "negativo" && "bg-red-50/50", !p.ativo && "opacity-60",
                      )}>
                        <td className="px-4 py-3">
                          <Link href={`/estoque/${p.id}`} className="font-semibold text-ink hover:text-primary-600">{p.nome}</Link>
                          {!p.ativo && <span className="ml-2 text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Inativo</span>}
                          {p.descricao && <p className="text-xs text-ink-subtle mt-0.5 truncate max-w-md">{p.descricao}</p>}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">{p.unidade}</td>
                        <td className="px-4 py-3"><SaldoQtd saldo={p.saldo} unidade="" situacao={p.situacao} /></td>
                        <td className="px-4 py-3 text-ink-muted tabular-nums">{p.estoqueMinimo != null ? formatarQtd(p.estoqueMinimo) : "—"}</td>
                        <td className="px-4 py-3"><SeloSituacao situacao={p.situacao} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <Link href={`/estoque/${p.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline">
                              <ScrollText className="w-3.5 h-3.5" /> Extrato
                            </Link>
                            {podeLancar && <LancarEstoque compacto produto={{ id: p.id, nome: p.nome, unidade: p.unidade, saldo: p.saldo }} />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </ConteudoUrl>
          <div className="px-4 py-3 border-t border-surface-border">
            <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="produtos" />
          </div>
        </div>
      </div>
    </ListaUrl>
  );
}
