import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, PackageOpen } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { cn, formatarData } from "@/lib/utils";
import { formatarQtd } from "@/lib/estoque/regras";
import { filaSeparacao } from "@/lib/estoque/separacao-server";
import { StatusPill } from "@/components/ui/status-pill";
import { Dica } from "@/components/ui/dica";

export const metadata: Metadata = { title: "A separar" };
export const dynamic = "force-dynamic";

/**
 * Estoque › A separar (E4.1): toda OS viva com material ainda não separado entra sozinha e sai quando tudo foi
 * separado. Rota de quem tem "Estoque › Separar material" (sem exigir "Estoque › Visualizar": o middleware deixa
 * passar e a página confere a ação).
 */
export default async function FilaSeparacaoPage() {
  const u = (await auth())!.user!;
  if (!pode(u.permissoes, "estoque", "separar", u.role)) redirect("/sem-permissao");
  const verEstoque = pode(u.permissoes, "estoque", "visualizar", u.role);
  const fila = await filaSeparacao(u.empresaId);

  return (
    <div className="space-y-6" data-fila-separacao>
      {verEstoque && <Link href="/estoque" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Estoque</Link>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg"><PackageOpen className="w-5 h-5 text-primary-600" /></div>
        <h1 className="page-title">A separar</h1>
        <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full" data-total-fila>{fila.length}</span>
        <Dica rotulo="A separar" texto="Toda OS com material nos itens entra aqui sozinha enquanto houver material ainda não separado; some quando tudo foi separado. Separar reserva o material para a OS no estoque." />
      </div>

      <div className="card overflow-hidden">
        {fila.length === 0 ? (
          <div className="py-12 text-center" data-lista-vazia>
            <p className="text-sm font-medium text-ink">Nada a separar</p>
            <p className="text-xs text-ink-muted">Quando uma OS com material for criada, ela aparece aqui.</p>
          </div>
        ) : (
          <>
            {/* Celular: um cartão por OS */}
            <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
              {fila.map((o) => (
                <li key={o.id} data-os-fila={o.id}>
                  <Link href={`/estoque/separacao/${o.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-alt">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{o.chamadoNumero ?? o.numero} <span className="font-normal text-ink-muted">· {o.cliente}</span></p>
                      <p className="text-xs text-ink-subtle truncate">{o.descricao}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <StatusPill tom="atencao" tamanho="sm">{o.aSeparar} de {o.total} a separar</StatusPill>
                        {o.previsaoConclusao && <span className="text-ink-subtle">previsão {formatarData(o.previsaoConclusao)}</span>}
                      </div>
                      <p className="text-xs text-ink-muted mt-1 truncate" data-faltam>{o.faltam.map((f) => `${f.descricao} ${formatarQtd(f.falta)} ${f.unidade}`).join(" · ")}{o.aSeparar > o.faltam.length ? " · …" : ""}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0 mt-1" />
                  </Link>
                </li>
              ))}
            </ul>
            {/* Desktop: a planilha */}
            <table className="hidden md:table w-full text-sm" data-tabela-fila>
              <thead className="bg-surface-page text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="text-left px-4 py-2">OS</th>
                  <th className="text-left px-3 py-2">Cliente</th>
                  <th className="text-left px-3 py-2">Previsão</th>
                  <th className="text-left px-3 py-2">A separar</th>
                  <th className="text-left px-3 py-2">Falta</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-linha">
                {fila.map((o) => (
                  <tr key={o.id} data-os-fila={o.id} className="hover:bg-surface-alt">
                    <td className="px-4 py-2">
                      <Link href={`/estoque/separacao/${o.id}`} className="font-semibold text-ink hover:text-primary-600">{o.chamadoNumero ?? o.numero}</Link>
                      <p className="text-xs text-ink-subtle truncate max-w-xs">{o.descricao}</p>
                    </td>
                    <td className="px-3 py-2 text-ink-muted truncate max-w-xs">{o.cliente}{o.unidade ? <span className="text-ink-subtle"> · {o.unidade}</span> : null}</td>
                    <td className={cn("px-3 py-2 tabular-nums", o.previsaoConclusao && o.previsaoConclusao < new Date() ? "text-atrasado-texto font-semibold" : "text-ink-muted")}>{o.previsaoConclusao ? formatarData(o.previsaoConclusao) : "—"}</td>
                    <td className="px-3 py-2"><StatusPill tom="atencao" tamanho="sm">{o.aSeparar} de {o.total}{o.parciais > 0 ? ` · ${o.parciais} em parte` : ""}</StatusPill></td>
                    <td className="px-3 py-2 text-xs text-ink-muted truncate max-w-sm" data-faltam>{o.faltam.map((f) => `${f.descricao} ${formatarQtd(f.falta)} ${f.unidade}`).join(" · ")}{o.aSeparar > o.faltam.length ? " · …" : ""}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link href={`/estoque/separacao/${o.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline" data-acao="separar">
                        <PackageOpen className="w-3.5 h-3.5" /> Separar
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
