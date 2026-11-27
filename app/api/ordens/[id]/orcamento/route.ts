import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { respostaRefEmpresa } from "@/lib/ref-empresa";
import { itemOsSchema } from "@/lib/validations";
import { criarItemOs, fixarCustosDosMateriaisOs, INCLUIR_ITEM_OS, prepararItemOsConferido, regraDaOs } from "@/lib/os/materiais-server";
import { usuarioVeCustoDeCompra } from "@/lib/estoque/custo-acesso";
import { semCustoNosItensOs } from "@/lib/os/custo";
import { travaDasLinhasDaOs } from "@/lib/os/trava-edicao-server";
import { verificarItemDaOs } from "@/lib/precos/trava-tabela-server";
import { textoDaTrilha } from "@/lib/precos/trava-tabela";

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
  // Registro fechado (OS assinada pelo cliente, faturada ou com nota): não entra linha nova
  const fechada = await travaDasLinhasDaOs(id);
  if (fechada) return NextResponse.json({ erro: fechada }, { status: 400 });
  const body = await req.json();
  const parsed = itemOsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  // Custo na OS: o custo dos materiais é decidido aqui (último custo de compra), nunca o que veio do navegador
  await fixarCustosDosMateriaisOs(empresaId, null, parsed.data.materiais);
  let prep;
  // "Orçamento E2": a regra de cobrança dos materiais da OS (fixada aqui se ainda não tinha e o item tem materiais)
  const regra = await regraDaOs(id, empresaId, !!parsed.data.materiais?.length);
  try { prep = await prepararItemOsConferido(empresaId, parsed.data, regra); } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  // Preço que veio da tabela do cliente: travado (só com a permissão e o motivo — lib/precos/trava-tabela)
  const trava = await verificarItemDaOs({ user: session.user!, empresaId, osId: id, item: { ...parsed.data, ...prep }, motivo: parsed.data.motivoPrecoTabela });
  if (!trava.veredito.ok) return NextResponse.json({ erro: trava.veredito.erro, precoTabela: true }, { status: trava.veredito.status });
  const criado = await prisma.$transaction(async (tx) => {
    const item = await criarItemOs(tx, id, prep);
    if (trava.alteracoes.length && trava.veredito.ok && trava.veredito.motivo)
      await tx.osHistorico.create({ data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Preço de tabela alterado", detalhes: textoDaTrilha(trava.alteracoes, trava.veredito.motivo).slice(0, 500) } });
    await tx.osHistorico.create({
      data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Item de orçamento adicionado", detalhes: prep.pecas.length ? `${prep.descricao} (+ ${prep.pecas.length} peça(s) à parte)` : prep.descricao },
    });
    return item;
  });
  const item = await prisma.osItemOrcamento.findUnique({ where: { id: criado.id }, include: INCLUIR_ITEM_OS });
  const pecas = await prisma.osItemOrcamento.findMany({ where: { ordemServicoId: id, material: { osItemId: criado.id } }, orderBy: { ordem: "asc" }, include: INCLUIR_ITEM_OS });
  // Sem permissão de ver custo, a resposta não traz o custo dos materiais (a chave some)
  const ver = usuarioVeCustoDeCompra(session.user);
  const [itemSaida] = item && !ver ? semCustoNosItensOs([item]) : [item];
  return NextResponse.json({ ...itemSaida, pecas: ver ? pecas : semCustoNosItensOs(pecas) }, { status: 201 });
}
