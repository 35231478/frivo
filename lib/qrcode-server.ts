import { prisma } from "@/lib/prisma";

async function proximoSequencial(empresaId: string, ano: number) {
  const ultimo = await prisma.qrcode.findFirst({
    where: { empresaId, codigo: { startsWith: `QR-${ano}-` } },
    orderBy: { codigo: "desc" },
    select: { codigo: true },
  });
  return ultimo ? Number(ultimo.codigo.split("-")[2]) + 1 : 1;
}

/** Gera um QR Code novo ("QR-2026-0042") já vinculado ao equipamento. */
export async function gerarQrCodeEquipamento(empresaId: string, equipamentoId: string) {
  const ano = new Date().getFullYear();
  const seq = await proximoSequencial(empresaId, ano);
  return prisma.qrcode.create({
    data: { empresaId, codigo: `QR-${ano}-${String(seq).padStart(4, "0")}`, equipamentoId },
  });
}
