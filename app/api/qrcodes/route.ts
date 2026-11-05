import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { z } from "zod";
import { gerarLoteQrCodes } from "@/lib/qrcode-server";

const gerarSchema = z.object({
  quantidade: z.number().int().min(1).max(100),
});

export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["qrcodes", "visualizar"], ["equipamentos", "editar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const { searchParams } = new URL(req.url);
  const vinculado = searchParams.get("vinculado"); // "true" | "false" | null
  const ativo = searchParams.get("ativo"); // "true" | "false" | null

  const where: any = { empresaId };
  if (vinculado === "true") where.equipamentoId = { not: null };
  if (vinculado === "false") where.equipamentoId = null;
  if (ativo === "true") where.ativo = true;
  if (ativo === "false") where.ativo = false;

  const qrcodes = await prisma.qrcode.findMany({
    where,
    include: {
      equipamento: { select: { id: true, marca: true, modelo: true, localizacao: true, unidade: { select: { nome: true } } } },
    },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(qrcodes);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("qrcodes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const parsed = gerarSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  // Lote numerado pelo contador da empresa, sob trava (nunca duplica)
  const codigos = await gerarLoteQrCodes(empresaId, parsed.data.quantidade);

  const criados = await prisma.qrcode.findMany({
    where: { empresaId, codigo: { in: codigos } },
  });
  // Ordem numérica (como texto, "QR-10000" viria antes de "QR-9999")
  const seq = (c: string) => Number(c.split("-").pop());
  criados.sort((a, b) => seq(a.codigo) - seq(b.codigo));

  return NextResponse.json(criados, { status: 201 });
}
