/**
 * ACEITE DO CLIENTE na conclusão da OS — regras puras (tela, app do técnico e servidor; sem banco).
 *
 * A OS concluída fica "aguardando a confirmação do cliente" até o aceite. O status da OS não muda
 * (continua Concluída): o aceite é uma CONFIRMAÇÃO registrada, não trava o faturamento.
 *
 * Dois caminhos para o mesmo aceite:
 *  - NO LOCAL: o responsável do cliente assina na tela do técnico (nome + assinatura desenhada);
 *  - REMOTO: o link público vai por WhatsApp e e-mail e fica pendente no portal; quem confirma
 *    informa o nome, e o sistema grava o IP e a data/hora (o mesmo mecanismo do orçamento).
 *
 * Portal: as confirmações pendentes aparecem quando o cliente vai abrir um chamado. Por padrão só
 * avisam; a empresa pode torná-las obrigatórias — e mesmo assim existe a saída de emergência.
 */
import { z } from "zod";
import { relogioBR } from "@/lib/fuso";

export const SITUACOES_ACEITE = ["PENDENTE", "CONFIRMADO"] as const;
export type SituacaoAceite = (typeof SITUACOES_ACEITE)[number];
export const METODOS_ACEITE = ["LOCAL", "REMOTO"] as const;
export type MetodoAceite = (typeof METODOS_ACEITE)[number];
export const ROTULO_METODO: Record<MetodoAceite, string> = { LOCAL: "No local", REMOTO: "Pelo link" };
export const CANAIS_PEDIDO = ["WHATSAPP", "EMAIL", "WHATSAPP_EMAIL", "LINK"] as const;
export type CanalPedido = (typeof CANAIS_PEDIDO)[number];

export const NOME_MIN = 3, NOME_MAX = 120, OBSERVACAO_MAX = 1000;
/** A assinatura é um desenho pequeno (PNG do traço): 300 KB sobra — e cabe na fila do aparelho */
export const ASSINATURA_MAX_BYTES = 300 * 1024;
export const MSG_NOME = "Informe o nome completo de quem confirma.";
export const MSG_ASSINATURA = "Peça para o cliente assinar no quadro.";
export const MSG_OS_NAO_CONCLUIDA = "A OS ainda não está concluída.";
export const MSG_OS_CANCELADA = "Esta OS foi cancelada.";
export const MSG_JA_CONFIRMADO = "Este serviço já foi confirmado.";

/* ───────── o que chega ───────── */

const nome = z.string({ required_error: MSG_NOME, invalid_type_error: MSG_NOME }).trim().min(NOME_MIN, MSG_NOME).max(NOME_MAX, `O nome vai até ${NOME_MAX} caracteres.`);
/** Bytes de um data URL base64 (sem decodificar) */
export const bytesDoDataUrl = (v: string) => Math.floor(((v.length - v.indexOf(",") - 1) * 3) / 4);
const assinatura = z.string({ required_error: MSG_ASSINATURA, invalid_type_error: MSG_ASSINATURA })
  .refine((v) => /^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/.test(v), MSG_ASSINATURA)
  .refine((v) => bytesDoDataUrl(v) <= ASSINATURA_MAX_BYTES, "Assinatura grande demais: limpe o quadro e assine de novo.");

/** No local: nome de quem recebeu + a assinatura desenhada */
export const aceiteLocalSchema = z.object({ nome, assinatura }).strict();
export type AceiteLocal = z.infer<typeof aceiteLocalSchema>;

/** Remoto (link público): nome de quem confirma + uma observação opcional */
export const aceitePublicoSchema = z.object({
  nome,
  observacao: z.string().trim().max(OBSERVACAO_MAX, `A observação vai até ${OBSERVACAO_MAX} caracteres.`).optional().nullable().transform((v) => v || null),
}).strict();
export type AceitePublico = z.infer<typeof aceitePublicoSchema>;

/* ───────── o estado ───────── */

export interface AceiteResumo {
  situacao: string; metodo?: string | null; nome?: string | null; confirmadoEm?: Date | string | null;
  ip?: string | null; observacao?: string | null; colhidoPor?: string | null;
  enviadoEm?: Date | string | null; enviadoPara?: string | null; envios?: number | null;
}

/**
 * - NAO_SE_APLICA: OS que não está concluída, ou concluída antes de existir o aceite (sem registro);
 * - AGUARDANDO: OS concluída com o aceite pendente — "concluída, aguardando confirmação do cliente";
 * - CONFIRMADO: o cliente aceitou (vale mesmo que a OS seja reaberta depois).
 */
export type EstadoAceite = "NAO_SE_APLICA" | "AGUARDANDO" | "CONFIRMADO";
export function estadoDoAceite(statusOs: string, aceite: Pick<AceiteResumo, "situacao"> | null | undefined): EstadoAceite {
  if (!aceite) return "NAO_SE_APLICA";
  if (aceite.situacao === "CONFIRMADO") return "CONFIRMADO";
  return statusOs === "CONCLUIDA" ? "AGUARDANDO" : "NAO_SE_APLICA";
}
export const ROTULO_ESTADO: Record<Exclude<EstadoAceite, "NAO_SE_APLICA">, string> = {
  AGUARDANDO: "Aguardando confirmação do cliente", CONFIRMADO: "Confirmada pelo cliente",
};

/** O que impede colher ou pedir o aceite agora (null = pode) */
export function motivoSemAceite(statusOs: string, aceite: Pick<AceiteResumo, "situacao"> | null | undefined): string | null {
  if (statusOs === "CANCELADA") return MSG_OS_CANCELADA;
  if (aceite?.situacao === "CONFIRMADO") return MSG_JA_CONFIRMADO;
  if (statusOs !== "CONCLUIDA") return MSG_OS_NAO_CONCLUIDA;
  return null;
}

/** O que o retrato da atividade leva para o app do técnico decidir se oferece o aceite */
export interface AceiteRetrato {
  /** null = a OS ainda não tem aceite (não concluiu no servidor) */
  situacao: string | null; nome: string | null; confirmadoEm: string | null;
  osConcluida: boolean;
  /** Esta é a última atividade em aberto da OS: concluir aqui conclui a OS — é a hora do aceite */
  ultimaDaOs: boolean;
}

/**
 * O app oferece o aceite? Só com a atividade concluída no aparelho, quando ela fecha a OS (ou a OS já
 * está concluída), e enquanto ninguém confirmou. `aceiteLocal`: já foi colhido neste aparelho.
 */
export type AceiteNoApp = "NAO_OFERECE" | "OFERECE" | "COLHIDO_NO_APARELHO" | "CONFIRMADO";
export function aceiteNoApp(d: { atividadeConcluida: boolean; retrato: AceiteRetrato | null | undefined; aceiteLocal?: { nome: string } | null }): AceiteNoApp {
  if (!d.retrato || !d.atividadeConcluida) return "NAO_OFERECE";
  if (d.retrato.situacao === "CONFIRMADO") return "CONFIRMADO";
  if (d.aceiteLocal) return "COLHIDO_NO_APARELHO";
  return d.retrato.osConcluida || d.retrato.ultimaDaOs ? "OFERECE" : "NAO_OFERECE";
}

/* ───────── textos ───────── */

const dataHoraBR = (d: Date | string) => {
  const r = relogioBR(new Date(d));
  const p = (n: number) => String(n).padStart(2, "0");
  return { dia: `${p(r.getDate())}/${p(r.getMonth() + 1)}/${r.getFullYear()}`, curto: `${p(r.getDate())}/${p(r.getMonth() + 1)}`, hora: `${p(r.getHours())}:${p(r.getMinutes())}` };
};

/** "Confirmado por Maria Souza em 05/11/2026 às 14:32" */
export function textoDoAceite(a: Pick<AceiteResumo, "nome" | "confirmadoEm">): string {
  const quando = a.confirmadoEm ? dataHoraBR(a.confirmadoEm) : null;
  return `Confirmado por ${(a.nome ?? "").trim() || "cliente"}${quando ? ` em ${quando.dia} às ${quando.hora}` : ""}`;
}

/** A prova, em uma linha: como foi, por quem foi colhido e de onde veio */
export function provaDoAceite(a: Pick<AceiteResumo, "metodo" | "ip" | "colhidoPor">): string {
  const como = a.metodo === "LOCAL" ? `no local, com assinatura${a.colhidoPor ? ` colhida por ${a.colhidoPor}` : ""}` : "pelo link de confirmação";
  return [como, a.ip ? `IP ${a.ip}` : ""].filter(Boolean).join(" · ");
}

/** O link público de confirmação (sem login: quem tem o token confirma) */
export const caminhoPublicoAceite = (token: string) => `/relatorio/aceite/${encodeURIComponent(token)}`;

/** A mensagem que vai pelo WhatsApp (e serve de corpo do e-mail aberto à mão) */
export function mensagemPedido(d: { contato?: string | null; numeroOs: string; empresa: string; url: string }): string {
  const saudacao = d.contato?.trim() ? `Olá, ${d.contato.trim().split(/\s+/)[0]}!` : "Olá!";
  return `${saudacao} Concluímos o serviço da ${rotuloDaOs(d.numeroOs)}.\n\nVeja o relatório do que foi feito e confirme o recebimento:\n${d.url}\n\n${d.empresa}`;
}
/** "OS-123" fica como está; número puro ganha o "OS" na frente */
export const rotuloDaOs = (numero: string) => (/^\s*os\b/i.test(numero) ? numero.trim() : `OS ${numero.trim()}`);

export const ACAO_PEDIDO = "Confirmação do cliente pedida";
export const ACAO_ACEITE = "Serviço confirmado pelo cliente";
export const ACAO_EMERGENCIA = "Chamado aberto em emergência";

/** O canal do pedido, pelo que de fato saiu */
export function canalDoPedido(d: { whatsapp: boolean; email: boolean }): CanalPedido {
  return d.whatsapp && d.email ? "WHATSAPP_EMAIL" : d.whatsapp ? "WHATSAPP" : d.email ? "EMAIL" : "LINK";
}
const TEXTO_CANAL: Record<CanalPedido, string> = { WHATSAPP_EMAIL: "por WhatsApp e e-mail", WHATSAPP: "por WhatsApp", EMAIL: "por e-mail", LINK: "link gerado (sem WhatsApp nem e-mail no cadastro)" };
export const textoDoCanal = (c: string | null | undefined) => TEXTO_CANAL[c as CanalPedido] ?? "";

/** O recado para quem clicou em "Enviar ao cliente" */
export function recadoDoPedido(d: { whatsapp: boolean; emailEnviado: boolean; emailPara?: string | null; erroEmail?: string | null }): { tipo: "sucesso" | "info"; texto: string } {
  if (d.emailEnviado && d.whatsapp) return { tipo: "sucesso", texto: `E-mail enviado para ${d.emailPara}. O WhatsApp abriu com a mensagem pronta.` };
  if (d.emailEnviado) return { tipo: "sucesso", texto: `E-mail enviado para ${d.emailPara}.` };
  if (d.whatsapp) return { tipo: "info", texto: `O WhatsApp abriu com a mensagem pronta.${d.erroEmail ? ` E-mail não enviado: ${d.erroEmail}.` : ""}` };
  return { tipo: "info", texto: `Sem WhatsApp nem e-mail do cliente: o link foi copiado. ${d.erroEmail ? `E-mail não enviado: ${d.erroEmail}. ` : ""}A confirmação fica pendente no portal.`.trim() };
}

/* ───────── portal: pendências e o gate do novo chamado ───────── */

export interface PendenciaAceite {
  osId: string; numero: string; token: string;
  /** Data da conclusão */
  concluidaEm: Date | string | null;
  /** O que foi feito, em poucas palavras (tipos de serviço ou a descrição) */
  servico: string;
}

/** "OS-123 · 05/11 · Manutenção preventiva" */
export function rotuloDaPendencia(p: Pick<PendenciaAceite, "numero" | "concluidaEm" | "servico">): string {
  return [rotuloDaOs(p.numero), p.concluidaEm ? dataHoraBR(p.concluidaEm).curto : "", p.servico.trim()].filter(Boolean).join(" · ");
}

/** "1 serviço aguardando sua confirmação" / "3 serviços aguardando sua confirmação" */
export const tituloDasPendencias = (n: number) => `${n} ${n === 1 ? "serviço aguardando" : "serviços aguardando"} sua confirmação`;

/** O serviço em poucas palavras: os tipos de OS das atividades; sem eles, o começo da descrição */
export function servicoDaOs(tipos: (string | null | undefined)[], descricao: string | null | undefined): string {
  const nomes = [...new Set(tipos.map((t) => (t ?? "").trim()).filter(Boolean))];
  if (nomes.length) return nomes.join(", ");
  const texto = (descricao ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
  return texto.length > 60 ? `${texto.slice(0, 59).trimEnd()}…` : texto;
}

/**
 * O gate do novo chamado:
 *  - sem pendência, ou com a opção da empresa desligada (padrão): LIVRE — só mostra as pendências;
 *  - opção ligada e há pendência: BLOQUEADO, a menos que o cliente declare EMERGÊNCIA (a saída existe
 *    sempre: climatização parada não espera).
 */
export type Gate = "LIVRE" | "BLOQUEADO" | "EMERGENCIA";
export function gateDoChamado(d: { obrigatorio: boolean; pendentes: number; emergencia?: boolean }): Gate {
  if (!d.obrigatorio || d.pendentes <= 0) return "LIVRE";
  return d.emergencia ? "EMERGENCIA" : "BLOQUEADO";
}
export const MSG_GATE = "Antes de abrir um novo chamado, confirme os serviços pendentes — ou abra como emergência.";
