import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { respostaRefEmpresa } from "@/lib/ref-empresa";
import { itemOsSchema } from "@/lib/validations";
import { criarItemOs, INCLUIR_ITEM_OS, prepararItemOsConferido } from "@/lib/os/materiais-server";
import { travaDasLinhasDaOs } from "@/lib/os/trava-edicao-server";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/ordens/[id]/orcamento — item da OS sem orçamento. Linha livre (como sempre: descrição, qtd, unitário),
 * serviço ou produto do catálogo e, no serviço com composição (E3.3b), o snapshot dos materiais: o item vale base +
 * ajuste dos inclusos (ou o manual) e cada peça vira um item PRODUTO derivado, cobrado à parte. Sem baixa (E4).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;
  if (!(await osDaEmpresa(id, empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  // Registro fechado (OS concluída, assinada, faturada ou com nota): não entra linha nova
  const fechada = await travaDasLinhasDaOs(id);
  if (fechada) return NextResponse.json({ erro: fechada }, { status: 409 });
  const body = await req.json();
  const parsed = itemOsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  let prep;
  try { prep = await prepararItemOsConferido(empresaId, parsed.data); } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  const criado = await prisma.$transaction(async (tx) => {
    const item = await criarItemOs(tx, id, prep);
    await tx.osHistorico.create({
      data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Item de orçamento adicionado", detalhes: prep.pecas.length ? `${prep.descricao} (+ ${prep.pecas.length} peça(s) à parte)` : prep.descricao },
    });
    return item;
  });
  const item = await prisma.osItemOrcamento.findUnique({ where: { id: criado.id }, include: INCLUIR_ITEM_OS });
  const pecas = await prisma.osItemOrcamento.findMany({ where: { ordemServicoId: id, material: { osItemId: criado.id } }, orderBy: { ordem: "asc" }, include: INCLUIR_ITEM_OS });
  return NextResponse.json({ ...item, pecas }, { status: 201 });
}
