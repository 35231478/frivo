/**
 * COM-1 — o guarda das rotas POR ID de orçamento e de OS: com "Ver só os próprios", um registro fora do escopo
 * responde 404 (como se não existisse), em leitura e em escrita. Sem a marca (ou ADMIN), não consulta nada.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { filtroOrcamentos, filtroOrdens, soProprios, type QuemVe } from "./proprios";

export const MSG_FORA_DO_ESCOPO = "Não encontrado";

/** O registro está no escopo da pessoa? (sem a marca: sempre) */
export async function noEscopo(u: QuemVe & { empresaId?: string | null }, tipo: "orcamento" | "ordem", id: string): Promise<boolean> {
  if (tipo === "orcamento") {
    if (!soProprios(u, "orcamentos")) return true;
    return !!(await prisma.orcamento.findFirst({ where: { id, empresaId: u.empresaId ?? "", ...filtroOrcamentos(u) }, select: { id: true } }));
  }
  if (!soProprios(u, "ordens")) return true;
  return !!(await prisma.ordemServico.findFirst({ where: { id, empresaId: u.empresaId ?? "", ...filtroOrdens(u) }, select: { id: true } }));
}

/**
 * Para o topo de cada rota `/api/orcamentos/[id]/…` e `/api/ordens/[id]/…`: devolve a resposta 404 quando o registro
 * está fora do escopo da pessoa logada, ou null para seguir. Sem sessão devolve null (o guarda de permissão responde).
 */
export async function escopoBarra(tipo: "orcamento" | "ordem", id: string): Promise<NextResponse | null> {
  // Fora de uma requisição (rotinas chamando o handler direto) não há sessão a limitar: quem responde é o guarda de
  // permissão da rota, que roda antes e já exige a sessão.
  let session: { user?: unknown } | null = null;
  try { session = (await auth()) as { user?: unknown } | null; } catch { session = null; }
  const u = session?.user as (QuemVe & { empresaId?: string }) | undefined;
  if (!u) return null;
  return (await noEscopo(u, tipo, id)) ? null : NextResponse.json({ erro: MSG_FORA_DO_ESCOPO }, { status: 404 });
}

/**
 * Algum dos ids (OS e orçamentos) está fora do escopo da pessoa? Sem a marca (ou ADMIN), nunca. Para as rotas que
 * recebem uma LISTA de OS/orçamentos (o pedido do cliente: informar, liberar sem pedido, editar, conferir).
 */
export async function algumForaDoEscopo(u: QuemVe & { empresaId?: string | null }, osIds: string[], orcamentoIds: string[]): Promise<boolean> {
  const [os, orc] = await Promise.all([idsNoEscopo(u, "ordens", osIds), idsNoEscopo(u, "orcamentos", orcamentoIds)]);
  return os.length !== osIds.length || orc.length !== orcamentoIds.length;
}

/**
 * O pedido do cliente cobre (ou propõe) alguma OS/orçamento fora do escopo? Com a marca, mexer no pedido (corrigir,
 * conferir, baixar o anexo) exige que TUDO o que ele cobre seja da pessoa. Sem a marca, nunca consulta.
 */
export async function pedidoForaDoEscopo(u: QuemVe & { empresaId?: string | null }, pedidoId: string): Promise<boolean> {
  if (!soProprios(u, "ordens") && !soProprios(u, "orcamentos")) return false;
  const p = await prisma.pedidoCliente.findFirst({
    where: { id: pedidoId, empresaId: u.empresaId ?? "" },
    select: { osPropostas: true, orcamentosPropostos: true, ordens: { select: { id: true } }, orcamentos: { select: { id: true } } },
  });
  if (!p) return false; // a rota responde o 404 dela
  return algumForaDoEscopo(u, [...p.ordens.map((o) => o.id), ...p.osPropostas], [...p.orcamentos.map((o) => o.id), ...p.orcamentosPropostos]);
}

/**
 * COM-1.1 — o pedido do cliente COMPARTILHADO (cobre OS de dois vendedores): com a marca, a pessoa VÊ o pedido se ele
 * cobre (ou propõe) ao menos uma OS/orçamento dela — e só os dela aparecem. Editar, conferir ou desfazer continua com
 * `pedidoForaDoEscopo` (tudo tem de ser dela). Devolve null quando a pessoa não vê nada dele (a rota responde 404);
 * sem a marca, devolve "tudo" (sem filtro).
 */
export async function pedidoVisivel(u: QuemVe & { empresaId?: string | null }, pedidoId: string):
  Promise<{ tudo: true } | { tudo: false; osIds: Set<string>; orcamentoIds: Set<string> } | null> {
  if (!soProprios(u, "ordens") && !soProprios(u, "orcamentos")) return { tudo: true };
  const p = await prisma.pedidoCliente.findFirst({
    where: { id: pedidoId, empresaId: u.empresaId ?? "" },
    select: { osPropostas: true, orcamentosPropostos: true, ordens: { select: { id: true } }, orcamentos: { select: { id: true } } },
  });
  if (!p) return { tudo: true }; // a rota responde o 404 dela
  const [os, orc] = await Promise.all([
    idsNoEscopo(u, "ordens", [...p.ordens.map((o) => o.id), ...p.osPropostas]),
    idsNoEscopo(u, "orcamentos", [...p.orcamentos.map((o) => o.id), ...p.orcamentosPropostos]),
  ]);
  return os.length || orc.length ? { tudo: false, osIds: new Set(os), orcamentoIds: new Set(orc) } : null;
}

/** Os ids (de uma seleção em massa) que estão no escopo da pessoa; entidade fora de orçamento/OS volta inteira. */
export async function idsNoEscopo(u: QuemVe & { empresaId?: string | null }, entidade: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return ids;
  if (entidade === "orcamentos" && soProprios(u, "orcamentos")) {
    const ok = await prisma.orcamento.findMany({ where: { id: { in: ids }, empresaId: u.empresaId ?? "", ...filtroOrcamentos(u) }, select: { id: true } });
    const set = new Set(ok.map((o) => o.id));
    return ids.filter((i) => set.has(i));
  }
  if (entidade === "ordens" && soProprios(u, "ordens")) {
    const ok = await prisma.ordemServico.findMany({ where: { id: { in: ids }, empresaId: u.empresaId ?? "", ...filtroOrdens(u) }, select: { id: true } });
    const set = new Set(ok.map((o) => o.id));
    return ids.filter((i) => set.has(i));
  }
  return ids;
}
