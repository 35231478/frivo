import { prisma } from "@/lib/prisma";
import { comNumero, reservarNumeros } from "@/lib/numeracao-server";
import { formatarNumero } from "@/lib/numeracao";

/** "QR-42" de um sequencial (o contador da empresa é quem dá o sequencial) */
export const codigoQr = (seq: number) => formatarNumero("qrcode", seq);

/** Gera um QR Code novo ("QR-42") já vinculado ao equipamento — número pelo contador, sob trava. */
export function gerarQrCodeEquipamento(empresaId: string, equipamentoId: string) {
  return comNumero(empresaId, "qrcode", (codigo, tx) => tx.qrcode.create({ data: { empresaId, codigo, equipamentoId } }));
}

/** Gera um lote de QR Codes avulsos (sem equipamento), numerados em sequência pelo contador. */
export function gerarLoteQrCodes(empresaId: string, quantidade: number) {
  return prisma.$transaction(async (tx) => {
    const codigos = await reservarNumeros(tx, empresaId, "qrcode", quantidade);
    await tx.qrcode.createMany({ data: codigos.map((codigo) => ({ empresaId, codigo })) });
    return codigos;
  });
}
