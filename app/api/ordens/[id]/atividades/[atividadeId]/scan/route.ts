import { NextRequest, NextResponse } from "next/server";
import { contextoExecucao } from "@/lib/execucao/contexto";
import { nomeEquipamento } from "@/lib/execucao/vinculos";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

const schema = z.object({ valor: z.string().min(1) });

/**
 * Resolve um QR escaneado (URL .../qr/<token>, token puro ou código QR-AAAA-NNNN) para o equipamento:
 * já vinculado à atividade → marca como atendido; ainda não → VINCULA (se for do cliente da OS e
 * estiver ativo) já como atendido. Equipamento de outro cliente nunca entra.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, atividadeId } = await params;
  const ctx = await contextoExecucao(id, atividadeId);
  if (!ctx.ok) return ctx.resposta;
  const { empresaId } = ctx;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  // Extrai o token de uma URL .../qr/<token> ou usa o valor cru
  const valor = parsed.data.valor.trim();
  const m = valor.match(/\/qr\/([^/?#\s]+)/);
  const token = m ? m[1] : valor;

  const qrcode = await prisma.qrcode.findFirst({
    where: { empresaId, OR: [{ tokenPublico: token }, { codigo: valor }] },
    select: { equipamentoId: true },
  });
  if (!qrcode?.equipamentoId) {
    return NextResponse.json({ erro: "QR Code não reconhecido." }, { status: 404 });
  }
  const equipamentoId = qrcode.equipamentoId;
  const eq = await prisma.equipamento.findFirst({
    where: { id: equipamentoId, empresaId },
    select: { nome: true, marca: true, modelo: true, ativo: true, unidade: { select: { clienteId: true } } },
  });
  if (!eq) return NextResponse.json({ erro: "QR Code não reconhecido." }, { status: 404 });
  const nome = nomeEquipamento(eq);

  const vinculo = await prisma.atividadeEquipamento.findFirst({ where: { atividadeId, equipamentoId }, select: { id: true } });
  if (vinculo) {
    await prisma.atividadeEquipamento.update({ where: { id: vinculo.id }, data: { feito: true, feitoEm: new Date() } });
    return NextResponse.json({ ok: true, vinculado: false, vinculoId: vinculo.id, equipamentoId, nome });
  }
  if (eq.unidade?.clienteId !== ctx.atividade.ordemServico.clienteId)
    return NextResponse.json({ erro: `O ${nome} é de outro cliente: não entra nesta OS.` }, { status: 409 });
  if (!eq.ativo) return NextResponse.json({ erro: `O ${nome} está inativo: reative o cadastro dele para usar na OS.` }, { status: 409 });

  const novo = await prisma.atividadeEquipamento.create({
    data: { atividadeId, equipamentoId, feito: true, feitoEm: new Date() },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, vinculado: true, vinculoId: novo.id, equipamentoId, nome }, { status: 201 });
}
