import { prisma } from "@/lib/prisma";
import { mesclarConfigRelatorio, type ConfigRelatorioOs } from "@/lib/relatorio-os/config";

/** Configuração de impressão da OS da empresa, já mesclada com os padrões. */
export async function getConfigRelatorio(empresaId: string): Promise<ConfigRelatorioOs> {
  const c = await prisma.configuracao.findUnique({ where: { empresaId }, select: { relatorioOsConfig: true } });
  return mesclarConfigRelatorio(c?.relatorioOsConfig);
}
