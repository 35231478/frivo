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
import { TabelaPro } from "@/components/listagem/tabela-pro";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { PLANILHA } from "@/lib/planilha";

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
        <div className="p-2 bg-surface-alt rounded-lg"><PackageOpen className="w-5 h-5 text-ink-muted" /></div>
        <h1 className="page-title">A separar</h1>
        <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full" data-total-fila>{fila.length}</span>
        <Dica rotulo="A separar" texto="Toda OS com material nos itens entra aqui sozinha enquanto houver material ainda não separado; some quando tudo foi separado. Separar reserva o material para a OS no estoque." />
      </div>

      <div className="card overflow-hidden">
        {fila.length === 0 ? (
          <ListaVazia mensagem="Nada a separar. Quando uma OS com material for criada, ela aparece aqui." />
        ) : (
          <TabelaPro
            tela="estoque-separacao"
            atributos={{ "data-tabela-fila": true }}
            quebra="md"
            cartoes={
              <ul className="divide-y divide-surface-border" data-cartoes>
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
            }
            colunas={[
              { id: "os", titulo: "OS", minimo: 180, obrigatoria: true, classe: "truncate" },
              { id: "cliente", titulo: "Cliente", minimo: 160, classe: "truncate" },
              { id: "previsao", titulo: "Previsão", largura: 110 },
              { id: "aseparar", titulo: "A separar", largura: 190 },
              { id: "falta", titulo: "Falta", minimo: 180, classe: "truncate" },
              { id: "acoes", titulo: "Ações", fixa: true, largura: 110, semTitulo: true, alinhar: "direita" },
            ]}
            linhas={fila.map((o) => ({
              id: o.id,
              atributos: { "data-os-fila": o.id },
              titulos: { os: o.descricao, cliente: o.cliente, falta: o.faltam.map((f) => `${f.descricao} ${formatarQtd(f.falta)} ${f.unidade}`).join(" · ") },
              celulas: {
                os: (
                  <span className="min-w-0">
                    <Link href={`/estoque/separacao/${o.id}`} className="font-semibold text-ink hover:text-primary-600">{o.chamadoNumero ?? o.numero}</Link>
                    <span className="block text-xs text-ink-subtle truncate">{o.descricao}</span>
                  </span>
                ),
                cliente: <span className="text-ink-muted">{o.cliente}{o.unidade ? <span className="text-ink-subtle"> · {o.unidade}</span> : null}</span>,
                previsao: (
                  <span className={cn(PLANILHA.data, o.previsaoConclusao && o.previsaoConclusao < new Date() ? "text-atrasado-texto font-semibold" : "text-ink-muted")}>
                    {o.previsaoConclusao ? formatarData(o.previsaoConclusao) : "—"}
                  </span>
                ),
                aseparar: <StatusPill tom="atencao" tamanho="sm">{o.aSeparar} de {o.total}{o.parciais > 0 ? ` · ${o.parciais} em parte` : ""}</StatusPill>,
                falta: <span className="text-xs text-ink-muted" data-faltam>{o.faltam.map((f) => `${f.descricao} ${formatarQtd(f.falta)} ${f.unidade}`).join(" · ")}{o.aSeparar > o.faltam.length ? " · …" : ""}</span>,
                acoes: (
                  <Link href={`/estoque/separacao/${o.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline" data-acao="separar">
                    <PackageOpen className="w-3.5 h-3.5" /> Separar
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
