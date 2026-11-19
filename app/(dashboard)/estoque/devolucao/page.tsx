import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, PackageMinus } from "lucide-react";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { pode } from "@/lib/permissoes";
import { formatarQtd } from "@/lib/estoque/regras";
import { filaDevolucao } from "@/lib/estoque/devolucao-server";
import { StatusPill } from "@/components/ui/status-pill";
import { Dica } from "@/components/ui/dica";
import { TabelaPro } from "@/components/listagem/tabela-pro";
import { ListaVazia } from "@/components/listagem/listagem-ui";

export const metadata: Metadata = { title: "A devolver" };
export const dynamic = "force-dynamic";

/**
 * Estoque › A devolver (E4.3): OS com sobra separada pendente de devolução (consumo já informado) e OS cancelada com
 * material ainda reservado. Some quando tudo voltou ao estoque. Rota de quem tem "Estoque › Separar material".
 */
export default async function FilaDevolucaoPage() {
  const u = (await exigirModuloNaPagina("estoque"))!.user!;
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
          <ListaVazia mensagem="Nada a devolver. Quando sobrar material numa OS, ela aparece aqui." />
        ) : (
          <TabelaPro
            tela="estoque-devolucao"
            atributos={{ "data-tabela-fila": true }}
            quebra="md"
            cartoes={
              <ul className="divide-y divide-surface-border" data-cartoes>
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
            }
            colunas={[
              { id: "os", titulo: "OS", minimo: 180, obrigatoria: true, classe: "truncate" },
              { id: "cliente", titulo: "Cliente", minimo: 160, classe: "truncate" },
              { id: "situacao", titulo: "Situação", largura: 230 },
              { id: "itens", titulo: "A devolver", minimo: 180, classe: "truncate" },
              { id: "acoes", titulo: "Ações", fixa: true, largura: 118, semTitulo: true, alinhar: "direita" },
            ]}
            linhas={fila.map((o) => ({
              id: o.id,
              atributos: { "data-os-fila": o.id },
              titulos: { os: o.descricao, cliente: o.cliente, itens: itensTexto(o) },
              celulas: {
                os: (
                  <span className="min-w-0">
                    <Link href={`/estoque/devolucao/${o.id}`} className="font-semibold text-ink hover:text-primary-600">{o.chamadoNumero ?? o.numero}</Link>
                    <span className="block text-xs text-ink-subtle truncate">{o.descricao}</span>
                  </span>
                ),
                cliente: <span className="text-ink-muted">{o.cliente}{o.unidade ? <span className="text-ink-subtle"> · {o.unidade}</span> : null}</span>,
                situacao: o.cancelada
                  ? <StatusPill tom="atrasado" tamanho="sm" data-os-cancelada>OS cancelada · liberar reserva</StatusPill>
                  : <StatusPill tom="atencao" tamanho="sm">Sobra do consumo</StatusPill>,
                itens: <span className="text-xs text-ink-muted" data-itens>{itensTexto(o)}</span>,
                acoes: (
                  <Link href={`/estoque/devolucao/${o.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline" data-acao="devolver">
                    <PackageMinus className="w-3.5 h-3.5" /> Devolver
                  </Link>
                ),
              },
            }))}
          />
        )}
      </div>
    </div>
  );
}
