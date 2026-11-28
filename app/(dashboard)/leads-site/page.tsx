import type { Metadata } from "next";
import { comEscopo, filtroOrcamentos } from "@/lib/escopo/proprios";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { ConteudoUrl, ListaUrl, PaginacaoUrl, TabelaProUrl } from "@/components/listagem/lista-url";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Globe } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { PLANILHA } from "@/lib/planilha";
import {
  cn,
  formatarData,
  formatarDataHora,
  formatarMoeda,
  LABELS_STATUS_ORCAMENTO,
  CLASSE_STATUS_ORCAMENTO,
} from "@/lib/utils";

export const metadata: Metadata = { title: "Leads do site" };
export const dynamic = "force-dynamic";

// Leads do site são os orçamentos nomeados "Lead do site — ..." (criados pelo
// endpoint público /api/publico/leads).
const NOME_PREFIXO = "Lead do site";

const AJUDA =
  "Cada pedido da calculadora de BTU do site vira um orçamento em rascunho e entra aqui, do mais novo para o mais antigo. " +
  "O nome abre o orçamento e o atalho ao lado abre a ficha do cliente. Descartar não apaga nada: o lead vai para " +
  "“Descartados”, com quem descartou e quando, e pode ser reaberto a qualquer momento.";

const FILTROS: { key: string; label: string; status: string[] | null }[] = [
  // "Todos" esconde os descartados (o padrão da casa); eles têm filtro próprio
  { key: "todos", label: "Todos", status: ["RASCUNHO", "ENVIADO", "APROVADO", "REPROVADO", "CONVERTIDA"] },
  { key: "aguardando", label: "Aguardando", status: ["RASCUNHO"] },
  { key: "andamento", label: "Em andamento", status: ["ENVIADO", "APROVADO"] },
  { key: "convertido", label: "Convertido", status: ["CONVERTIDA"] },
  { key: "descartados", label: "Descartados", status: ["CANCELADO"] },
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

  const where: { empresaId: string; nome: { startsWith: string }; status?: { in: string[] } } = {
    empresaId,
    nome: { startsWith: NOME_PREFIXO },
  };
  if (filtro.status) where.status = { in: filtro.status };
  // COM-1: "Ver só os próprios" — só os leads (orçamentos) em que a pessoa é o vendedor
  const escopo = filtroOrcamentos(session!.user);

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // UX-4 (Y5): paginação de servidor no lugar do corte fixo de 200
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const [total, novos24h] = await Promise.all([
    prisma.orcamento.count({ where: comEscopo(where as object, escopo) }),
    prisma.orcamento.count({
      where: comEscopo({ empresaId, nome: { startsWith: NOME_PREFIXO }, criadoEm: { gte: desde } }, escopo),
    }),
  ]);
  const pagina = paginaValida(paginaPedida, porPagina, total);
  const orcamentos = total
    ? await prisma.orcamento.findMany({
        where: comEscopo(where as object, escopo),
        include: { cliente: { select: { id: true, nome: true, celular: true, cidade: true } } },
        orderBy: [{ criadoEm: "desc" }, { id: "asc" }],
        ...janela(pagina, porPagina),
      })
    : [];

  // Quem descartou e quando: o último evento de status do orçamento (a linha do tempo que já existe)
  const descartados = orcamentos.filter((o) => o.status === "CANCELADO").map((o) => o.id);
  const eventos = descartados.length
    ? await prisma.orcamentoEvento.findMany({
        where: { empresaId, orcamentoId: { in: descartados }, tipo: "STATUS" },
        include: { usuario: { select: { nome: true } } },
        orderBy: { criadoEm: "desc" },
      })
    : [];
  // O evento do descarte é o último que terminou em "Cancelado" (vem do botão ou da troca de status)
  const descarte = new Map<string, { quem: string; quando: Date }>();
  for (const e of eventos) {
    if (descarte.has(e.orcamentoId)) continue;
    if (!/cancelad/i.test(e.detalhe ?? "")) continue;
    descarte.set(e.orcamentoId, { quem: e.usuario?.nome ?? "o cliente", quando: e.criadoEm });
  }

  const linhas = orcamentos.map((o) => {
    const valor = Number(o.totalGeral);
    const d = descarte.get(o.id);
    return {
      id: o.id,
      codigo: o.codigo,
      clienteId: o.cliente.id,
      data: o.criadoEm,
      nome: o.cliente.nome,
      cidade: o.cliente.cidade ?? "—",
      whatsapp: o.cliente.celular ?? "—",
      recomendacao: o.descricao ?? "—",
      valor: valor > 0 ? formatarMoeda(valor) : "Sob consulta",
      status: o.status as string,
      ativo: o.status !== "CANCELADO",
      descarte: d ? `Descartado por ${d.quem} em ${formatarData(d.quando)}` : null,
    };
  });

  const Status = ({ l }: { l: (typeof linhas)[number] }) => (
    <span className="inline-flex flex-col gap-0.5">
      <span
        className={
          CLASSE_STATUS_ORCAMENTO[l.status] ??
          "inline-flex rounded-full bg-surface-linha px-2.5 py-0.5 text-xs font-medium text-ink-muted"
        }
      >
        {l.status === "CANCELADO" ? "Descartado" : (LABELS_STATUS_ORCAMENTO[l.status] ?? l.status)}
      </span>
      {l.descarte && (
        <span className="text-[11px] text-ink-subtle" data-descartado-por={l.id}>
          {l.descarte}
        </span>
      )}
    </span>
  );

  const Acoes = ({ l }: { l: (typeof linhas)[number] }) => (
    <div className="flex items-center justify-end gap-0.5">
      <Link
        href={`/clientes/${l.clienteId}`}
        data-ficha-cliente={l.id}
        title="Abrir a ficha do cliente"
        className="inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-ink-muted hover:bg-surface-alt hover:text-ink"
      >
        Cliente
      </Link>
      <InativarRegistro
        url={`/api/orcamentos/${l.id}`} modulo="orcamentos" acaoReativar="editar"
        ativo={l.ativo} nome={l.codigo} entidade="lead"
        rotuloInativar="Descartar" rotuloReativar="Reabrir" comMotivo={false}
        textoInativar="Tem certeza? O lead sai da lista e passa a aparecer em “Descartados”, com quem descartou e quando. Nada é apagado: o orçamento, o cliente e o link público ficam preservados, e ele pode ser reaberto."
        textoReativar="O lead volta para Aguardando e reaparece na lista."
      />
    </div>
  );

  return (
    <ListaUrl chave="leads-site" paramBusca="q" qAtual="">
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600">
          <Globe className="h-5 w-5" />
        </span>
        <div>
          <h1 className="page-title flex items-center gap-1.5">
            Leads do site
            <Dica texto={AJUDA} rotulo="Leads do site" lado="direita" />
            {novos24h > 0 && (
              <span className="inline-flex items-center rounded-full bg-success-500 px-2 py-0.5 text-xs font-semibold text-white">
                {novos24h === 1 ? "1 novo em 24h" : `${novos24h} novos em 24h`}
              </span>
            )}
          </h1>
          <p className="text-sm text-ink-muted">
            {total === 1 ? "1 lead" : `${total} leads`} da calculadora de BTU do site.
          </p>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "todos" ? "/leads-site" : `/leads-site?status=${f.key}`}
            data-filtro-lead={f.key}
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

      <div className="card overflow-hidden">
        <ConteudoUrl>
        {linhas.length === 0 ? (
          <ListaVazia mensagem={filtro.key === "descartados" ? "Nenhum lead descartado." : "Nenhum lead encontrado para este filtro."} />
        ) : (
          <>
          {/* Celular: um cartão por lead */}
          <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
            {linhas.map((l) => (
              <li key={l.id} data-cartao={l.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <Link href={`/orcamentos/${l.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{l.nome}</p>
                    <p className="font-mono text-xs text-ink-muted">{l.codigo} · {formatarDataHora(l.data)}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">{l.recomendacao}</p>
                    <p className="text-xs text-ink-muted">{l.cidade} · {l.whatsapp}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Status l={l} />
                      <span className="ml-auto text-sm font-semibold tabular-nums text-ink">{l.valor}</span>
                    </div>
                  </Link>
                </div>
                <div className="mt-1 -mr-2"><Acoes l={l} /></div>
              </li>
            ))}
          </ul>
          {/* Desktop: a tabela da casa (colunas escolhíveis, largura por usuário) */}
          <div data-tabela-leads>
            <TabelaProUrl
              tela="leads-site"
              colunas={[
                { id: "data", titulo: "Data", largura: 140 },
                { id: "cliente", titulo: "Cliente", minimo: 180, obrigatoria: true, classe: "truncate" },
                { id: "cidade", titulo: "Cidade", largura: 140, classe: "truncate" },
                { id: "whatsapp", titulo: "WhatsApp", largura: 140 },
                { id: "equipamento", titulo: "Equipamento", minimo: 160, classe: "truncate" },
                { id: "valor", titulo: "Valor estimado", alinhar: "direita", largura: 132 },
                { id: "status", titulo: "Status", largura: 200 },
                { id: "acoes", titulo: "Ações", fixa: true, largura: 148, semTitulo: true, alinhar: "direita", classe: "py-0.5" },
              ]}
              linhas={linhas.map((l) => ({
                id: l.id,
                atributos: { "data-linha-lead": l.id }, href: `/orcamentos/${l.id}`,
                titulos: { cliente: l.nome, equipamento: l.recomendacao },
                celulas: {
                  data: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarDataHora(l.data)}</span>,
                  cliente: (
                    <span className="min-w-0">
                      <Link href={`/orcamentos/${l.id}`} className="font-medium text-primary-600 hover:underline">{l.nome}</Link>
                      <span className={cn(PLANILHA.codigo, "block text-ink-muted")}>{l.codigo}</span>
                    </span>
                  ),
                  cidade: <span className="text-ink-muted">{l.cidade}</span>,
                  whatsapp: <span className="whitespace-nowrap text-ink-muted">{l.whatsapp}</span>,
                  equipamento: <span className="text-ink-muted">{l.recomendacao}</span>,
                  valor: <span className="font-semibold tabular-nums text-ink" data-valor-lead={l.id}>{l.valor}</span>,
                  status: <Status l={l} />,
                  acoes: <Acoes l={l} />,
                },
              }))}
            />
          </div>
          </>
        )}
        </ConteudoUrl>
        <div className="border-t border-surface-border px-4 py-3">
          <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="leads" />
        </div>
      </div>
    </div>
    </ListaUrl>
  );
}
