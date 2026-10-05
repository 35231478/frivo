import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { gerarQrCodeEquipamento } from "@/lib/qrcode-server";
import { equipamentoSchema } from "@/lib/validations";
import { resolverTipoEquipamento } from "@/lib/tipo-equipamento";

/**
 * Lista equipamentos ativos. Além de quem visualiza o módulo, libera a leitura para
 * quem usa os seletores de equipamento na OS (ordens) e no orçamento (orcamentos).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { permissoes, role } = session.user!;
  if (!["equipamentos", "ordens", "orcamentos"].some((m) => pode(permissoes, m, "visualizar", role)))
    return NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });

  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const unidadeId = searchParams.get("unidadeId");
  const clienteId = searchParams.get("clienteId");

  const equipamentos = await prisma.equipamento.findMany({
    where: {
      empresaId,
      ativo: true,
      ...(unidadeId && { unidadeId }),
      ...(clienteId && { unidade: { clienteId } }),
    },
    include: {
      unidade: {
        select: {
          id: true,
          nome: true,
          cidade: true,
          cliente: { select: { id: true, nome: true, nomeFantasia: true } },
        },
      },
    },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(equipamentos);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("equipamentos", "criar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

  const empresaId = session.user!.empresaId;
  const body = await req.json();
  const parsed = equipamentoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  // Garante que a unidade pertence à empresa
  const unidade = await prisma.unidade.findFirst({
    where: { id: parsed.data.unidadeId, empresaId },
  });
  if (!unidade) return NextResponse.json({ erro: "Unidade não encontrada" }, { status: 404 });

  const { dataInstalacao, dataFabricacao, garantiaInicio, garantiaAte, tipoEquipamentoId: tipoCustomId, ...resto } = parsed.data;
  if (garantiaInicio && garantiaAte && garantiaInicio > garantiaAte)
    return NextResponse.json({ erro: "O início da garantia deve ser anterior ao fim." }, { status: 400 });
  const tipoResolvido = await resolverTipoEquipamento(empresaId, resto.tipo, tipoCustomId);
  if (!tipoResolvido) return NextResponse.json({ erro: "Tipo de equipamento não encontrado" }, { status: 400 });
  const equipamento = await prisma.equipamento.create({
    data: {
      ...resto,
      tipo: tipoResolvido.tipo as any,
      empresaId,
      tipoEquipamentoId: tipoResolvido.tipoEquipamentoId,
      dataInstalacao: dataInstalacao ? new Date(dataInstalacao) : null,
      dataFabricacao: dataFabricacao ? new Date(dataFabricacao) : null,
      garantiaInicio: garantiaInicio ? new Date(garantiaInicio) : null,
      garantiaAte: garantiaAte ? new Date(garantiaAte) : null,
    },
  });

  // Cadastro pela foto da etiqueta pede o QR já na criação (mesma geração da aba "QR Code")
  if (body?.gerarQrCode === true) {
    try {
      const qrcode = await gerarQrCodeEquipamento(empresaId, equipamento.id);
      return NextResponse.json({ ...equipamento, qrcode: { id: qrcode.id, codigo: qrcode.codigo } }, { status: 201 });
    } catch (e) {
      // O equipamento já foi salvo: não desfaz o cadastro por causa do QR
      console.error("Falha ao gerar QR do equipamento", e);
      return NextResponse.json({ ...equipamento, qrcode: null, avisoQr: "O equipamento foi salvo, mas o QR Code não pôde ser gerado agora. Gere pela aba QR Code." }, { status: 201 });
    }
  }

  return NextResponse.json(equipamento, { status: 201 });
}
