/**
 * Configuração de impressão do relatório da OS (por empresa, em Configuracao.relatorioOsConfig).
 * Arquivo puro: servidor e tela.
 *
 * Cada seção tem duas chaves:
 *  - `ativo`: entra no relatório (desligada, não sai em versão nenhuma);
 *  - `cliente`: aparece na VERSÃO DO CLIENTE (link público / PDF enviado). Desmarcada = "só
 *    interno": aparece apenas na VERSÃO INTERNA (administrativa, só para quem tem login).
 * O cabeçalho (empresa, nº da OS, tipo, situação e datas) sai sempre: identifica o documento.
 *
 * Só as seções que já têm dado hoje. Materiais/valores, saúde do equipamento, recomendações,
 * resumo IA e QR/GPS entram aqui quando existirem.
 */
import { z } from "zod";

export type VersaoRelatorio = "cliente" | "interna";

export const SECOES_RELATORIO = [
  { id: "resultado", label: "Resultado do atendimento", dica: "Linha de resumo no topo: situação, equipamentos atendidos e o que foi feito." },
  { id: "clienteLocal", label: "Cliente e local", dica: "Cliente, documento, endereço e o local (unidade) atendido." },
  { id: "equipe", label: "Equipe, técnicos e veículo", dica: "Quem executou e o veículo usado em cada atividade." },
  { id: "equipamentos", label: "Equipamentos atendidos", dica: "Um bloco por equipamento: local, equipamento + TAG e o checklist daquele equipamento." },
  { id: "fotos", label: "Fotos dos equipamentos", dica: "As fotos tiradas no checklist, dentro do bloco de cada equipamento." },
  { id: "checklistGeral", label: "Formulário geral da atividade", dica: "Respostas e fotos que não são de um equipamento (formulário da atividade)." },
  { id: "naoAtendidos", label: "Equipamentos não atendidos", dica: "Equipamentos da OS que não foram marcados como feitos." },
  { id: "tempos", label: "Horários e duração", dica: "Início e duração de cada atividade." },
  { id: "observacoes", label: "Observações", dica: "Observações da OS e do relatório." },
  { id: "assinaturas", label: "Assinaturas", dica: "Assinaturas coletadas e campos para assinatura do responsável e do cliente." },
] as const;

export type SecaoRelatorioId = (typeof SECOES_RELATORIO)[number]["id"];
export interface SecaoConfig { ativo: boolean; cliente: boolean }
export type ConfigRelatorioOs = Record<SecaoRelatorioId, SecaoConfig>;

/** Padrão: tudo ligado e visível ao cliente, menos o que é operação interna. */
export const CONFIG_RELATORIO_PADRAO: ConfigRelatorioOs = {
  resultado: { ativo: true, cliente: true },
  clienteLocal: { ativo: true, cliente: true },
  equipe: { ativo: true, cliente: true },
  equipamentos: { ativo: true, cliente: true },
  fotos: { ativo: true, cliente: true },
  checklistGeral: { ativo: true, cliente: true },
  naoAtendidos: { ativo: true, cliente: false },
  tempos: { ativo: true, cliente: false },
  observacoes: { ativo: true, cliente: true },
  assinaturas: { ativo: true, cliente: true },
};

const ehSecao = (k: string): k is SecaoRelatorioId => SECOES_RELATORIO.some((s) => s.id === k);

/** Valor salvo (JSON qualquer) + padrões = config completa. Chaves desconhecidas são ignoradas. */
export function mesclarConfigRelatorio(salvo: unknown): ConfigRelatorioOs {
  const out = Object.fromEntries(SECOES_RELATORIO.map((s) => [s.id, { ...CONFIG_RELATORIO_PADRAO[s.id] }])) as ConfigRelatorioOs;
  if (!salvo || typeof salvo !== "object" || Array.isArray(salvo)) return out;
  for (const [k, v] of Object.entries(salvo as Record<string, unknown>)) {
    if (!ehSecao(k) || !v || typeof v !== "object") continue;
    const { ativo, cliente } = v as Partial<SecaoConfig>;
    if (typeof ativo === "boolean") out[k].ativo = ativo;
    if (typeof cliente === "boolean") out[k].cliente = cliente;
  }
  return out;
}

/** A seção sai nesta versão? Desligada: em nenhuma. Ligada: interna sempre; cliente se marcada. */
export function mostraSecao(config: ConfigRelatorioOs, secao: SecaoRelatorioId, versao: VersaoRelatorio): boolean {
  const c = config[secao];
  return c.ativo && (versao === "interna" || c.cliente);
}

/** Corpo do PUT: todas as seções, cada uma { ativo, cliente } booleanos; nada além disso. */
export const configRelatorioSchema = z.object(
  Object.fromEntries(SECOES_RELATORIO.map((s) => [s.id, z.object({ ativo: z.boolean(), cliente: z.boolean() }).strict()])) as
    Record<SecaoRelatorioId, z.ZodObject<{ ativo: z.ZodBoolean; cliente: z.ZodBoolean }>>,
).strict();

export const LABEL_VERSAO: Record<VersaoRelatorio, string> = { cliente: "Versão do cliente", interna: "Versão interna" };
