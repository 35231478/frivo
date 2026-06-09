import { prisma } from "@/lib/prisma";

/** Configurações da página pública de QR Code (armazenadas em Configuracao.qrConfig como JSON). */
export type QrConfig = {
  // Acesso público
  paginaPublicaAtiva: boolean;
  mostrarHistorico: boolean;
  mostrarProximaManutencao: boolean;
  mostrarDadosEquipamento: boolean;
  mostrarLocalizacao: boolean;
  // Botões de contato
  botaoWhatsapp: boolean;
  botaoOrcamento: boolean;
  botaoChamado: boolean;
  whatsappNumero: string;
  linkSite: string;
  mensagemBoasVindas: string;
  // Restrições
  chamadoSomenteLogado: boolean;
  historicoSomenteLogado: boolean;
  orcamentoSomenteLogado: boolean;
};

export const QR_CONFIG_PADRAO: QrConfig = {
  paginaPublicaAtiva: true,
  mostrarHistorico: true,
  mostrarProximaManutencao: true,
  mostrarDadosEquipamento: true,
  mostrarLocalizacao: true,
  botaoWhatsapp: true,
  botaoOrcamento: false,
  botaoChamado: true,
  whatsappNumero: "",
  linkSite: "",
  mensagemBoasVindas: "",
  chamadoSomenteLogado: false,
  historicoSomenteLogado: false,
  orcamentoSomenteLogado: false,
};

/** Mescla os valores salvos com os padrões, garantindo um objeto completo. */
export function mesclarQrConfig(salvo: unknown): QrConfig {
  if (!salvo || typeof salvo !== "object") return { ...QR_CONFIG_PADRAO };
  return { ...QR_CONFIG_PADRAO, ...(salvo as Partial<QrConfig>) };
}

/** Busca a configuração de QR de uma empresa, já mesclada com os padrões. */
export async function getQrConfig(empresaId: string): Promise<QrConfig> {
  const config = await prisma.configuracao.findUnique({
    where: { empresaId },
    select: { qrConfig: true },
  });
  return mesclarQrConfig(config?.qrConfig);
}
