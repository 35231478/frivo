import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, PackageMinus } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { formatarQtd } from "@/lib/estoque/regras";
import { filaDevolucao } from "@/lib/estoque/devolucao-server";
import { StatusPill } from "@/components/ui/status-pill";
import { Dica } from "@/components/ui/dica";

export const metadata: Metadata = { title: "A devolver" };
export const dynamic = "force-dynamic";

/**
 * Estoque › A devolver (E4.3): OS com sobra separada pendente de devolução (consumo já informado) e OS cancelada com
 * material ainda reservado. Some quando tudo voltou ao estoque. Rota de quem tem "Estoque › Separar material".
 */
export default async function FilaDevolucaoPage() {
  const u = (await auth())!.user!;
  if (!pode(u.permissoes, "estoque", "separar", u.role)) redirect("/sem-permissao");
  const verEstoque = pode(u.permissoes, "estoque", "visualizar", u.role);
  const fila = await filaDevolucao(u.empresaId);
  const itensTexto = (o: (typeof fila)[number]) => o.itens.map((i) => `${i.descricao} ${formatarQtd(i.quantidade)} ${i.unidade}`).join(" · ") + (o.aDevolver > o.itens.length ? " · …" : "");

  return (
    <div className="space-y-6" data-fila-devolucao>
      {verEstoque && <Link href="/estoque" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Estoque</Link>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="p-2 bg-surface-alt rounded-lg"><PackageMinus className="w-5 h-5 text-ink-muted" /></div>
        <h1 className="page-title">A devolver</h1>
        <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full" data-total-fila>{fila.length}</span>
        <Dica rotulo="A devolver" texto="Material separado que sobrou depois do consumo informado, e material reservado de OS cancelada: volta ao estoque ao confirmar a devolução. A OS some daqui quando tudo voltou." />
      </div>

      <div className="card overflow-hidden">
        {fila.length === 0 ? (
          <div className="py-12 text-center" data-lista-vazia>
            <p className="text-sm font-medium text-ink">Nada a devolver</p>
            <p className="text-xs text-ink-muted">Quando sobrar material numa OS (ou uma OS com material reservado for cancelada), ela aparece aqui.</p>
          </div>
        ) : (
          <>
            <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
              {fila.map((o) => (
                <li key={o.id} data-os-fila={o.id}>
                  <Link href={`/estoque/devolucao/${o.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-alt">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{o.chamadoNumero ?? o.numero} <span className="font-normal text-ink-muted">· {o.cliente}</span></p>
                      <p className="text-xs text-ink-subtle truncate">{o.descricao}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <StatusPill tom="atencao" tamanho="sm">{o.aDevolver} a devolver</StatusPill>
                        {o.cancelada && <StatusPill tom="atrasado" tamanho="sm" data-os-cancelada>OS cancelada · liberar reserva</StatusPill>}
                      </div>
                      <p className="text-xs text-ink-muted mt-1 truncate" data-itens>{itensTexto(o)}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0 mt-1" />
                  </Link>
                </li>
              ))}
            </ul>
            <table className="hidden md:table w-full text-sm" data-tabela-fila>
              <thead className="bg-surface-page text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="text-left px-4 py-2">OS</th>
                  <th className="text-left px-3 py-2">Cliente</th>
                  <th className="text-left px-3 py-2">Situação</th>
                  <th className="text-left px-3 py-2">A devolver</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-linha">
                {fila.map((o) => (
                  <tr key={o.id} data-os-fila={o.id} className="hover:bg-surface-alt">
                    <td className="px-4 py-2">
                      <Link href={`/estoque/devolucao/${o.id}`} className="font-semibold text-ink hover:text-primary-600">{o.chamadoNumero ?? o.numero}</Link>
                      <p className="text-xs text-ink-subtle truncate max-w-xs">{o.descricao}</p>
                    </td>
                    <td className="px-3 py-2 text-ink-muted truncate max-w-xs">{o.cliente}{o.unidade ? <span className="text-ink-subtle"> · {o.unidade}</span> : null}</td>
                    <td className="px-3 py-2">
                      {o.cancelada
                        ? <StatusPill tom="atrasado" tamanho="sm" data-os-cancelada>OS cancelada · liberar reserva</StatusPill>
                        : <StatusPill tom="atencao" tamanho="sm">Sobra do consumo</StatusPill>}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-muted truncate max-w-sm" data-itens>{itensTexto(o)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link href={`/estoque/devolucao/${o.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline" data-acao="devolver">
                        <PackageMinus className="w-3.5 h-3.5" /> Devolver
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
