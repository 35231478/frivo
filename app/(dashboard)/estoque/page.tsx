import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FileUp, Package, ScrollText } from "lucide-react";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { pode } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import { PLANILHA } from "@/lib/planilha";
import { contarAlertas, FILTROS_SITUACAO, listarEstoque } from "@/lib/estoque/servidor";
import { formatarQtd } from "@/lib/estoque/regras";
import { LancarEstoque } from "@/components/estoque/lancar-estoque";
import { BarraEstoque } from "@/components/estoque/estoque-barra";
import { SaldoQtd, SeloSituacao } from "@/components/estoque/situacao";
import { avisosEstoque } from "@/lib/estoque/regras";
import { ConteudoUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl, TabelaProUrl } from "@/components/listagem/lista-url";
import { Dica } from "@/components/ui/dica";
import { LABEL_USO, USOS } from "@/lib/estoque/categoria";
import { ImportarPlanilha } from "@/components/importacao/importar-planilha";

export const metadata: Metadata = { title: "Estoque" };

const AJUDA = "O saldo de cada produto que controla estoque: a soma dos movimentos (entrada, saída, ajuste e inventário), que ficam no extrato do produto. Quem gerencia lança movimento aqui mesmo; nenhum movimento é apagado — corrigir é lançar ajuste, e o extrato guarda os dois. Sem estoque (saldo zero), abaixo do mínimo (saldo até o mínimo cadastrado) e saldo negativo aparecem destacados e no aviso de cima.";

/**
 * Estoque (padrão da casa: barra de busca/filtros + TabelaPro): o saldo de cada produto que
 * controla estoque (cache da soma do razão), com destaque de quem está no mínimo ou abaixo /
 * negativo, e o lançamento manual (entrada, saída, ajuste, inventário) para quem gerencia.
 * O acesso à rota já é barrado no middleware (Estoque › visualizar).
 */
export default async function EstoquePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await exigirModuloNaPagina("estoque");
  const u = session!.user!;
  const podeLancar = pode(u.permissoes, "estoque", "gerenciar", u.role);
  const [lista, alertas] = await Promise.all([listarEstoque(u.empresaId, sp), contarAlertas(u.empresaId)]);
  const avisos = avisosEstoque(alertas);
  const { itens, total, pagina, porPagina, busca } = lista;

  return (
    <ListaUrl chave="estoque" paramBusca="busca" qAtual={busca}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-surface-alt rounded-lg"><Package className="w-5 h-5 text-ink-muted" /></div>
            <h1 className="page-title flex items-center gap-1.5">Estoque <Dica texto={AJUDA} rotulo="Estoque" lado="direita" /></h1>
            <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
          </div>
          <div className="flex items-center gap-2">
          {podeLancar && <ImportarPlanilha entidade="estoque" />}
          <Link
            href="/estoque/notas" data-ir-notas
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold",
              podeLancar
                ? "bg-primary-500 hover:bg-primary-600 text-white shadow-sm"
                : "border border-surface-border bg-white text-ink hover:bg-surface-alt",
            )}
          >
            <FileUp className="w-4 h-4" /> {podeLancar ? "Importar NF de compra" : "Notas de compra"}
          </Link>
          </div>
        </div>

        {/* Barra enxuta (padrão da casa): busca por produto + "Mais filtros" (situação, uso, inativos) */}
        <BarraEstoque situacoes={Object.entries(FILTROS_SITUACAO).map(([value, label]) => ({ value, label }))} usos={USOS.map((value) => ({ value, label: LABEL_USO[value] }))} />

        {/* Aviso no topo: quantos sem estoque, abaixo do mínimo e negativos — cada frase filtra a lista */}
        {avisos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-atencao/20 bg-atencao-claro px-4 py-3 text-sm" data-alertas>
            <AlertTriangle className="w-4 h-4 text-atencao-texto shrink-0" />
            {avisos.map((a, i) => (
              <span key={a.situacao} className="inline-flex items-center gap-2">
                {i > 0 && <span className="text-atencao-texto">·</span>}
                <Link href={a.href} className={cn("font-semibold hover:underline", a.situacao === "abaixo" ? "text-atencao-texto" : "text-atrasado-texto")} data-alerta={a.situacao}>
                  {a.texto}
                </Link>
              </span>
            ))}
          </div>
        )}

        <div className="card overflow-hidden">
          <ConteudoUrl>
            {itens.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
                <p className="text-sm font-medium text-ink">Nenhum produto encontrado</p>
                {busca ? <p className="text-xs text-ink-muted">Nada combina com “{busca}”.</p>
                  : <p className="text-xs text-ink-muted">Os produtos vêm do cadastro em Configurações › Produtos (os que controlam estoque).</p>}
                <LimparBuscaUrl />
              </div>
            ) : (
              <>
                {/* Celular: um cartão por produto */}
                <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
                  {itens.map((p) => (
                    <li key={p.id} data-cartao={p.id} className={cn("flex items-start gap-3 px-4 py-3", p.situacao === "negativo" && "bg-atrasado-claro", !p.ativo && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <Link href={`/estoque/${p.id}`} className="font-semibold text-ink hover:text-primary-600 block truncate">{p.nome}</Link>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <SaldoQtd saldo={p.saldo} unidade={p.unidade} situacao={p.situacao} />
                          {p.estoqueMinimo != null && <span className="text-ink-subtle">mín. {formatarQtd(p.estoqueMinimo)}</span>}
                          {p.situacao !== "ok" && <SeloSituacao situacao={p.situacao} />}
                          <span className="text-ink-subtle" data-uso-produto={p.uso}>{LABEL_USO[p.uso]}</span>
                        </div>
                      </div>
                      {podeLancar && <LancarEstoque compacto produto={{ id: p.id, nome: p.nome, unidade: p.unidade, saldo: p.saldo }} />}
                    </li>
                  ))}
                </ul>
                {/* Desktop: a tabela profissional (colunas redimensionáveis, menu "Colunas", preferência por usuário) */}
                <div data-tabela-estoque>
                  <TabelaProUrl
                    tela="estoque" padrao="nome"
                    colunas={[
                      { id: "nome", titulo: "Produto", ordenar: "nome", obrigatoria: true, classe: "truncate" },
                      { id: "uso", titulo: "Uso", largura: 90 },
                      { id: "unidade", titulo: "Un.", largura: 64, ordenar: "unidade" },
                      { id: "saldo", titulo: "Saldo", alinhar: "direita", largura: 110, ordenar: "saldo", obrigatoria: true },
                      { id: "minimo", titulo: "Mínimo", alinhar: "direita", largura: 90, ordenar: "minimo" },
                      { id: "situacao", titulo: "Situação", largura: 150 },
                      { id: "acoes", titulo: "Ações", fixa: true, largura: podeLancar ? 176 : 96, semTitulo: true, alinhar: "direita", classe: "py-0.5" },
                    ]}
                    linhas={itens.map((p) => ({
                      id: p.id,
                      atributos: { "data-linha": p.id, "data-situacao-linha": p.situacao }, href: `/estoque/${p.id}`,
                      // Negativo: linha vermelha (como a conta vencida no financeiro); inativo apagado
                      classe: cn(p.situacao === "negativo" && "even:bg-atrasado-claro bg-atrasado-claro hover:bg-atrasado-claro/70", !p.ativo && "opacity-60"),
                      titulos: { nome: p.descricao ? `${p.nome} — ${p.descricao}` : p.nome },
                      celulas: {
                        nome: (
                          <span className="flex items-center gap-2 min-w-0">
                            <Link href={`/estoque/${p.id}`} className={cn(PLANILHA.nome, "text-ink hover:text-primary-600 truncate")} data-nome-produto>{p.nome}</Link>
                            {!p.ativo && <span className="shrink-0 text-[10px] font-bold bg-surface-linha text-ink-muted px-2 py-0.5 rounded-full">Inativo</span>}
                            {p.descricao && <span className="hidden xl:inline text-xs text-ink-subtle truncate">{p.descricao}</span>}
                          </span>
                        ),
                        uso: <span className="text-ink-muted" data-uso-produto={p.uso}>{LABEL_USO[p.uso]}</span>,
                        unidade: <span className="text-ink-muted">{p.unidade}</span>,
                        saldo: <SaldoQtd saldo={p.saldo} unidade="" situacao={p.situacao} />,
                        minimo: <span className={cn(PLANILHA.numero, "text-ink-muted")}>{p.estoqueMinimo != null ? formatarQtd(p.estoqueMinimo) : "—"}</span>,
                        situacao: <SeloSituacao situacao={p.situacao} />,
                        acoes: (
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <Link href={`/estoque/${p.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline">
                              <ScrollText className="w-3.5 h-3.5" /> Extrato
                            </Link>
                            {podeLancar && <LancarEstoque compacto produto={{ id: p.id, nome: p.nome, unidade: p.unidade, saldo: p.saldo }} />}
                          </div>
                        ),
                      },
                    }))}
                  />
                </div>
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
