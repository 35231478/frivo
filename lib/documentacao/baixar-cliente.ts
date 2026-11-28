import { baixarArquivo } from "@/lib/baixar-cliente";

/**
 * Baixa o zip do pacote pelo navegador (lib/baixar-cliente): quando a rota recusa (o pacote tem documento que venceu
 * depois do envio), a pessoa vê a RAZÃO na tela.
 */
export const baixarZipDoEnvio = (envioId: string) =>
  baixarArquivo(`/api/documentacao/envios/${envioId}/zip`, "documentacao.zip", "Não foi possível baixar o pacote.");
