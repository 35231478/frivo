import { prisma } from "@/lib/prisma";
import { CONFIG_APP_PADRAO, normalizarConfigApp, SELECT_CONFIG_APP, type ConfigApp } from "@/lib/tecnico/config-app";

/**
 * Carrega o ConfigApp (permissões do app do colaborador) de uma empresa, selecionando só as
 * colunas app* de Configuracao. Empresa sem linha de configuração = todos os padrões. Só servidor.
 */
export async function carregarConfigApp(empresaId: string): Promise<ConfigApp> {
  const row = await prisma.configuracao.findUnique({
    where: { empresaId },
    select: SELECT_CONFIG_APP,
  });
  return normalizarConfigApp(row);
}

/** "Campo de conclusão obrigatório" ligado na empresa? (trava do resumo na conclusão da atividade). */
export async function conclusaoExigeResumo(empresaId: string): Promise<boolean> {
  const row = await prisma.configuracao.findUnique({
    where: { empresaId },
    select: { appConclusaoObrigatoria: true },
  });
  return row?.appConclusaoObrigatoria ?? CONFIG_APP_PADRAO.conclusaoObrigatoria;
}
