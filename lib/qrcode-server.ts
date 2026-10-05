import { prisma } from "@/lib/prisma";

/**
 * Próximo sequencial do ano para "QR-AAAA-####", pelo MAIOR número já usado.
 * (Ordenar o código como texto colocava "QR-2026-9999" depois de "QR-2026-10000",
 * e o próximo voltava a ser 10000 → código duplicado. Mesma correção do número da OS.)
 */
export async function proximoSequencialQr(empresaId: string, ano = new Date().getFullYear()): Promise<number> {
  const prefixo = `QR-${ano}-`;
  const [r] = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(split_part(codigo, '-', 3) AS INTEGER)) AS max
    FROM qrcodes
    WHERE empresa_id = ${empresaId} AND codigo LIKE ${prefixo + "%"} AND split_part(codigo, '-', 3) ~ '^[0-9]{1,9}$'`;
  return (r?.max ?? 0) + 1;
}

export function codigoQr(ano: number, seq: number) {
  return `QR-${ano}-${String(seq).padStart(4, "0")}`;
}

/** Gera um QR Code novo ("QR-2026-0042") já vinculado ao equipamento. */
export async function gerarQrCodeEquipamento(empresaId: string, equipamentoId: string) {
  const ano = new Date().getFullYear();
  const seq = await proximoSequencialQr(empresaId, ano);
  return prisma.qrcode.create({
    data: { empresaId, codigo: codigoQr(ano, seq), equipamentoId },
  });
}
