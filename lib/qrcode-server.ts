import { prisma } from "@/lib/prisma";
import { anoBR } from "@/lib/fuso";
import { comNumero, reservarNumeros } from "@/lib/numeracao-server";
import { formatarNumero } from "@/lib/numeracao";

/** "QR-AAAA-NNNN" de um sequencial (o contador da empresa é quem dá o sequencial) */
export const codigoQr = (ano: number, seq: number) => formatarNumero("qrcode", seq, ano);

/** Gera um QR Code novo ("QR-2026-0042") já vinculado ao equipamento — número pelo contador, sob trava. */
export function gerarQrCodeEquipamento(empresaId: string, equipamentoId: string) {
  return comNumero(empresaId, "qrcode", (codigo, tx) => tx.qrcode.create({ data: { empresaId, codigo, equipamentoId } }));
}

/** Gera um lote de QR Codes avulsos (sem equipamento), numerados em sequência pelo contador. */
export function gerarLoteQrCodes(empresaId: string, quantidade: number) {
  return prisma.$transaction(async (tx) => {
    const codigos = await reservarNumeros(tx, empresaId, "qrcode", quantidade, anoBR());
    await tx.qrcode.createMany({ data: codigos.map((codigo) => ({ empresaId, codigo })) });
    return codigos;
  });
}
