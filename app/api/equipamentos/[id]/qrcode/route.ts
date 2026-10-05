import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { gerarQrCodeEquipamento } from "@/lib/qrcode-server";

type Params = { params: Promise<{ id: string }> };

const postSchema = z.object({
  qrcodeId: z.string().optional(),
});

/**
 * Gera um novo QR Code já vinculado ao equipamento, OU vincula um QR existente.
 * Aceita "criar" além de "editar": quem cadastra o equipamento precisa poder gerar o QR
 * depois (só acrescenta; trocar/desvincular continua exigindo "editar").
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["equipamentos", "editar"], ["equipamentos", "criar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const equip = await prisma.equipamento.findFirst({
    where: { id, empresaId },
    include: { qrcode: { select: { id: true } } },
  });
  if (!equip) return NextResponse.json({ erro: "Equipamento não encontrado" }, { status: 404 });
  if (equip.qrcode) return NextResponse.json({ erro: "Equipamento já possui um QR Code vinculado." }, { status: 400 });

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  // Vincular um QR existente
  if (parsed.data.qrcodeId) {
    const qr = await prisma.qrcode.findFirst({ where: { id: parsed.data.qrcodeId, empresaId } });
    if (!qr) return NextResponse.json({ erro: "QR Code inválido" }, { status: 400 });
    if (qr.equipamentoId) return NextResponse.json({ erro: "Este QR Code já está vinculado." }, { status: 400 });
    const atualizado = await prisma.qrcode.update({ where: { id: qr.id }, data: { equipamentoId: id } });
    return NextResponse.json(atualizado, { status: 200 });
  }

  // Gerar um novo QR e vincular
  const novo = await gerarQrCodeEquipamento(empresaId, id);
  return NextResponse.json(novo, { status: 201 });
}

/** Desvincula o QR Code do equipamento (mantém o QR no acervo). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipamentos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const qr = await prisma.qrcode.findFirst({ where: { equipamentoId: id, empresaId } });
  if (!qr) return NextResponse.json({ erro: "Nenhum QR Code vinculado" }, { status: 404 });

  await prisma.qrcode.update({ where: { id: qr.id }, data: { equipamentoId: null } });
  return NextResponse.json({ ok: true });
}
