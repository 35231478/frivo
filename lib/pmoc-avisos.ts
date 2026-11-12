/**
 * PMOC — Etapa 3: regras puras dos AVISOS DE VENCIMENTO, da configuração da empresa e do ENVIO do
 * documento ao cliente (tela e servidor; sem banco).
 *
 * Aviso: nasce da data, não de uma rotina — o plano publicado e ativo está "vencendo" quando faltam
 * até N dias para a expiração (N é da empresa), e "expirado" a partir do dia seguinte a ela. O que o
 * banco guarda é só o que JÁ foi avisado (para o histórico registrar uma vez) e quem deu ciência.
 */
import { z } from "zod";
import { DIAS_AVISO_VENCIMENTO, dataBR, situacaoPmoc } from "@/lib/pmoc";

export type TipoAviso = "VENCENDO" | "EXPIRADO";
export const TIPOS_AVISO: readonly TipoAviso[] = ["VENCENDO", "EXPIRADO"];
export const DIAS_AVISO_MIN = 1;
export const DIAS_AVISO_MAX = 365;

export interface AvisoDoPlano {
  tipo: TipoAviso;
  /** VENCENDO: dias que faltam (0 = expira hoje). EXPIRADO: dias desde a expiração (1 = expirou ontem) */
  dias: number;
}

/**
 * O aviso de vencimento do plano hoje (null = nenhum). Rascunho e plano inativo não avisam: rascunho
 * não está valendo, e inativar é o jeito de dizer que o plano saiu de uso.
 */
export function avisoDoPlano(p: { status: string; ativo: boolean; dataInicio: Date | string; dataExpiracao: Date | string }, diasAviso: number = DIAS_AVISO_VENCIMENTO, agora = new Date()): AvisoDoPlano | null {
  if (!p.ativo) return null;
  const s = situacaoPmoc(p, agora, diasAviso);
  if (s.status === "EXPIRADO") return { tipo: "EXPIRADO", dias: -(s.diasParaExpirar ?? 0) };
  if (s.status === "VIGENTE" && s.vencendo) return { tipo: "VENCENDO", dias: s.diasParaExpirar ?? 0 };
  return null;
}

/** "Expira em 12 dias (25/11/2026)", "Expira hoje (…)", "Expirou há 3 dias (…)" */
export function textoAviso(a: AvisoDoPlano, dataExpiracao: Date | string): string {
  const quando = `(${dataBR(dataExpiracao)})`;
  if (a.tipo === "EXPIRADO") return a.dias === 1 ? `Expirou ontem ${quando}` : `Expirou há ${a.dias} dias ${quando}`;
  if (a.dias === 0) return `Expira hoje ${quando}`;
  return a.dias === 1 ? `Expira amanhã ${quando}` : `Expira em ${a.dias} dias ${quando}`;
}

/** O que vai para o histórico do plano quando o aviso é registrado (uma vez por tipo e data) */
export const ACAO_AVISO: Record<TipoAviso, string> = { VENCENDO: "Aviso: plano perto de expirar", EXPIRADO: "Aviso: plano expirado" };
export function detalheAviso(tipo: TipoAviso, dataExpiracao: Date | string, dias: number): string {
  return tipo === "EXPIRADO" ? `O plano expirou em ${dataBR(dataExpiracao)}.` : dias === 0 ? `O plano expira hoje, ${dataBR(dataExpiracao)}.` : `O plano expira em ${dataBR(dataExpiracao)} (faltam ${dias} ${dias === 1 ? "dia" : "dias"}).`;
}

/* ───────── configuração da empresa ───────── */

export const configPmocSchema = z.object({
  diasAviso: z.number({ invalid_type_error: "Informe com quantos dias de antecedência avisar." }).int("Use um número inteiro de dias.")
    .min(DIAS_AVISO_MIN, `A antecedência vai de ${DIAS_AVISO_MIN} a ${DIAS_AVISO_MAX} dias.`).max(DIAS_AVISO_MAX, `A antecedência vai de ${DIAS_AVISO_MIN} a ${DIAS_AVISO_MAX} dias.`),
  /** Vazio = volta ao texto padrão do sistema */
  textoPadrao: z.string().max(20_000, "O texto padrão vai até 20.000 caracteres.").optional().nullable().transform((v) => (v && v.trim() ? v.trim() : null)),
});
export type ConfigPmocInput = z.infer<typeof configPmocSchema>;
export interface ConfigPmoc { diasAviso: number; textoPadrao: string | null }
export const CONFIG_PMOC_PADRAO: ConfigPmoc = { diasAviso: DIAS_AVISO_VENCIMENTO, textoPadrao: null };

/* ───────── envio ao cliente ───────── */

export const CANAIS_ENVIO = ["WHATSAPP", "EMAIL", "LINK"] as const;
export type CanalEnvio = (typeof CANAIS_ENVIO)[number];
export const envioSchema = z.object({ canal: z.enum(CANAIS_ENVIO, { errorMap: () => ({ message: "Canal de envio inválido." }) }) });

/** Por que o documento não pode ir ao cliente agora (null = pode) */
export function bloqueioEnvio(p: { status: string; ativo: boolean }): string | null {
  if (!p.ativo) return "PMOC inativo: reative antes de enviar ao cliente.";
  if (p.status !== "PUBLICADO") return "Publique o plano antes de enviar ao cliente.";
  return null;
}

/** Caminho público do documento (o prefixo /relatorio/ já é público no sistema) */
export const caminhoPublicoDocumento = (token: string) => `/relatorio/pmoc/${token}`;

/** Texto da mensagem do WhatsApp (e do e-mail pelo programa do usuário) */
export function mensagemEnvio(d: { contato?: string | null; nomePmoc: string; empresa: string; url: string; vigencia: string }): string {
  const saudacao = d.contato?.trim() ? `Prezado(a) ${d.contato.trim().split(/\s+/)[0]},` : "Prezados,";
  return `${saudacao}\n\nSegue o documento do ${/pmoc/i.test(d.nomePmoc) ? d.nomePmoc : `PMOC ${d.nomePmoc}`} (vigência: ${d.vigencia}):\n${d.url}\n\nAtenciosamente,\n${d.empresa}`;
}

export const ACAO_ENVIO: Record<CanalEnvio, string> = { WHATSAPP: "Documento enviado por WhatsApp", EMAIL: "Documento enviado por e-mail", LINK: "Link do documento copiado" };
