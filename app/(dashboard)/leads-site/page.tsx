import type { Metadata } from "next";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { ListaUrl, PaginacaoUrl } from "@/components/listagem/lista-url";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Globe } from "lucide-react";
import {
  cn,
  formatarDataHora,
  formatarMoeda,
  LABELS_STATUS_ORCAMENTO,
  CLASSE_STATUS_ORCAMENTO,
} from "@/lib/utils";

export const metadata: Metadata = { title: "Leads do Site" };
export const dynamic = "force-dynamic";

// Leads do site são os orçamentos nomeados "Lead do site — ..." (criados pelo
// endpoint público /api/publico/leads).
const NOME_PREFIXO = "Lead do site";

const FILTROS: { key: string; label: string; status: string[] | null }[] = [
  { key: "todos", label: "Todos", status: null },
  { key: "aguardando", label: "Aguardando", status: ["RASCUNHO"] },
  { key: "andamento", label: "Em andamento", status: ["ENVIADO", "APROVADO"] },
  { key: "convertido", label: "Convertido", status: ["CONVERTIDA"] },
];

export default async function LeadsSitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { status = "todos" } = sp;
  const session = await auth();
  if (!pode(session!.user!.permissoes, "orcamentos", "visualizar", session!.user!.role)) redirect("/sem-permissao");
  const empresaId = session!.user!.empresaId;

  const filtro = FILTROS.find((f) => f.key === status) ?? FILTROS[0];

  const where: any = { empresaId, nome: { startsWith: NOME_PREFIXO } };
  if (filtro.status) where.status = { in: filtro.status };

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // UX-4 (Y5): paginação de servidor no lugar do corte fixo de 200
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const [total, novos24h] = await Promise.all([
    prisma.orcamento.count({ where }),
    prisma.orcamento.count({
      where: { empresaId, nome: { startsWith: NOME_PREFIXO }, criadoEm: { gte: desde } },
    }),
  ]);
  const pagina = paginaValida(paginaPedida, porPagina, total);
  const orcamentos = total
    ? await prisma.orcamento.findMany({
        where,
        include: { cliente: { select: { nome: true, celular: true, cidade: true } } },
        orderBy: [{ criadoEm: "desc" }, { id: "asc" }],
        ...janela(pagina, porPagina),
      })
    : [];

  const linhas = orcamentos.map((o) => {
    const valor = Number(o.totalGeral);
    return {
      id: o.id,
      codigo: o.codigo,
      data: o.criadoEm,
      nome: o.cliente.nome,
      cidade: o.cliente.cidade ?? "—",
      whatsapp: o.cliente.celular ?? "—",
      recomendacao: o.descricao ?? "—",
      valor: valor > 0 ? formatarMoeda(valor) : "Sob consulta",
      status: o.status as string,
    };
  });

  return (
    <ListaUrl chave="leads-site" paramBusca="q" qAtual="">
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600">
          <Globe className="h-5 w-5" />
        </span>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
            Leads do Site
            {novos24h > 0 && (
              <span className="inline-flex items-center rounded-full bg-success-500 px-2 py-0.5 text-xs font-semibold text-white">
                {novos24h} novo{novos24h > 1 ? "s" : ""} em 24h
              </span>
            )}
          </h1>
          <p className="text-sm text-ink-muted">
            Orçamentos gerados pela calculadora de BTU do site.
          </p>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "todos" ? "/leads-site" : `/leads-site?status=${f.key}`}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
              filtro.key === f.key
                ? "border-primary-500 bg-primary-500 text-white"
                : "border-surface-border bg-white text-ink-muted hover:border-ink-subtle",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-card border border-surface-border bg-white">
        {linhas.length === 0 ? (
          <div className="p-12 text-center text-ink-muted">
            <Globe className="mx-auto h-8 w-8 text-ink-subtle" />
            <p className="mt-3 text-sm">Nenhum lead encontrado para este filtro.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Cidade</th>
                <th className="px-4 py-3 font-medium">WhatsApp</th>
                <th className="px-4 py-3 font-medium">Equipamento</th>
                <th className="px-4 py-3 font-medium">Valor estimado</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-surface-linha last:border-0 hover:bg-surface-page"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                    {formatarDataHora(l.data)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/orcamentos/${l.id}`}
                      className="font-medium text-primary-600 hover:underline"
                    >
                      {l.nome}
                    </Link>
                    <div className="font-mono text-xs text-ink-muted">{l.codigo}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{l.cidade}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                    {l.whatsapp}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{l.recomendacao}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink">
                    {l.valor}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        CLASSE_STATUS_ORCAMENTO[l.status] ??
                        "inline-flex rounded-full bg-surface-linha px-2.5 py-0.5 text-xs font-medium text-ink-muted"
                      }
                    >
                      {LABELS_STATUS_ORCAMENTO[l.status] ?? l.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-4 py-3 border-t border-surface-border bg-surface-alt/40">
          <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="leads" />
        </div>
      </div>
    </div>
    </ListaUrl>
  );
}
