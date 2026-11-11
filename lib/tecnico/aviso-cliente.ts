/**
 * Aviso ao cliente pelo app do técnico: "A caminho" e "Cheguei". Este módulo é PURO (sem Prisma):
 * serve ao servidor (o que enviar, quando NÃO enviar) e ao aparelho (o que a tela mostra, sem sinal
 * também). Regras:
 *  - um aviso de cada evento por atividade, por DIA (Brasília): tocar de novo não avisa de novo;
 *  - o aviso é sensível ao tempo: só sai se o toque chegar ao servidor dentro da JANELA. Tocou sem
 *    sinal e a fila subiu depois disso = o horário fica registrado, o cliente NÃO recebe aviso velho;
 *  - a mensagem é curta, com o nome da empresa, sem tom de assistente e sem emoji.
 */
import { z } from "zod";
import { chaveDiaBR, horaBR } from "@/lib/fuso";

export const EVENTOS_AVISO = ["A_CAMINHO", "CHEGOU"] as const;
export type EventoAviso = (typeof EVENTOS_AVISO)[number];

/**
 * O que aconteceu com o aviso ao cliente:
 *  PENDENTE (o servidor registrou e ainda está enviando) · ENVIADO · ATRASADO (o toque chegou tarde
 *  demais para avisar) · SEM_DESTINO (o cliente não tem e-mail para avisos de OS) · INDISPONIVEL
 *  (e-mail da empresa não configurado, aviso desligado ou falha no envio).
 */
export type StatusAviso = "PENDENTE" | "ENVIADO" | "ATRASADO" | "SEM_DESTINO" | "INDISPONIVEL";

export const avisoClienteSchema = z.object({ evento: z.enum(EVENTOS_AVISO) }).strict();
export type AvisoCliente = z.infer<typeof avisoClienteSchema>;

/** Quanto o toque pode demorar para chegar ao servidor e o aviso ainda fazer sentido para o cliente */
export const JANELA_AVISO_MS = 5 * 60_000;

/** O texto do botão */
export const ROTULO_EVENTO: Record<EventoAviso, string> = { A_CAMINHO: "A caminho", CHEGOU: "Cheguei" };
/** Como o escritório lê no histórico da OS */
export const ACAO_HISTORICO: Record<EventoAviso, string> = { A_CAMINHO: "Técnico a caminho", CHEGOU: "Técnico chegou ao local" };
/** O modelo de e-mail (Configurações › E-mail › Modelos) de cada evento */
export const TEMPLATE_AVISO: Record<EventoAviso, string> = { A_CAMINHO: "TECNICO_A_CAMINHO", CHEGOU: "TECNICO_CHEGOU" };

const FRASE: Record<EventoAviso, string> = {
  A_CAMINHO: "nosso técnico está a caminho do seu atendimento.",
  CHEGOU: "nosso técnico chegou ao local.",
};

/** A mensagem pronta (WhatsApp): "{Empresa}: nosso técnico está a caminho do seu atendimento." */
export function mensagemAviso(evento: EventoAviso, empresa: string | null | undefined): string {
  const nome = (empresa ?? "").trim();
  const frase = FRASE[evento];
  return nome ? `${nome}: ${frase}` : frase[0].toUpperCase() + frase.slice(1);
}

/** Link que abre o WhatsApp com a mensagem pronta para o número do cliente. Sem número válido = sem link. */
export function linkWhatsappAviso(numero: string | null | undefined, evento: EventoAviso, empresa: string | null | undefined): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  const comDdi = digitos.length >= 12 ? digitos : `55${digitos}`;
  return `https://wa.me/${comDdi}?text=${encodeURIComponent(mensagemAviso(evento, empresa))}`;
}

/* ───────── o horário do toque e a janela ───────── */

/**
 * O horário do toque e há quanto tempo ele aconteceu. `em` é o relógio do APARELHO na hora do toque;
 * `agoraAparelho` é o mesmo relógio na hora do envio — a diferença entre os dois é o atraso real,
 * mesmo com o relógio do aparelho errado. Sem `agoraAparelho`, compara com o relógio do servidor.
 * Toque "no futuro" ou sem horário válido conta como agora.
 */
export function horarioDoToque(em: string | null | undefined, agoraServidor: number, agoraAparelho?: string | null): { registradoEm: Date; atrasoMs: number } {
  const toque = em ? Date.parse(em) : NaN;
  if (!Number.isFinite(toque)) return { registradoEm: new Date(agoraServidor), atrasoMs: 0 };
  const envio = agoraAparelho ? Date.parse(agoraAparelho) : NaN;
  const atrasoMs = Math.max(0, (Number.isFinite(envio) ? envio : agoraServidor) - toque);
  return { registradoEm: new Date(agoraServidor - atrasoMs), atrasoMs };
}

const minutos = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** O aviso ainda pode sair? Quando não, o status e o motivo (para o histórico da OS). */
export function decidirAviso(p: { ligado: boolean; atrasoMs: number; evento: EventoAviso; chegadaRegistrada: boolean }):
  { enviar: true } | { enviar: false; status: StatusAviso; detalhe: string } {
  if (!p.ligado) return { enviar: false, status: "INDISPONIVEL", detalhe: "aviso ao cliente desligado em Equipes › App do colaborador" };
  if (p.atrasoMs > JANELA_AVISO_MS) return { enviar: false, status: "ATRASADO", detalhe: `tocado sem sinal; chegou ao sistema ${minutos(p.atrasoMs)} min depois` };
  if (p.evento === "A_CAMINHO" && p.chegadaRegistrada) return { enviar: false, status: "ATRASADO", detalhe: "a chegada já estava registrada" };
  return { enviar: true };
}

/* ───────── o que a tela do técnico mostra ───────── */

/** Um toque registrado, como a tela vê. `status` null = ainda só no aparelho (a enviar). */
export interface AvisoTela { em: string; status: StatusAviso | null; pendente?: boolean }
export type AvisosTela = Partial<Record<EventoAviso, AvisoTela>>;

/** O que o retrato da atividade leva para o app avisar: null = permissão desligada na empresa. */
export interface AvisoClienteRetrato {
  /** Nome da empresa (entra na mensagem) */
  empresa: string;
  /** WhatsApp do cliente para o toque manual; null sem número ou com "Exibir contatos do cliente" desligado */
  whatsapp: string | null;
}

export const mesmoDia = (a: string | number | Date, b: string | number | Date) => chaveDiaBR(a) === chaveDiaBR(b);

/** O toque de HOJE deste evento (o de outro dia não conta: a atividade que continua pode avisar de novo). */
export function avisoDoDia(avisos: AvisosTela | null | undefined, evento: EventoAviso, agora: number = Date.now()): AvisoTela | null {
  const a = avisos?.[evento];
  return a && mesmoDia(a.em, agora) ? a : null;
}

export type TomAviso = "ok" | "espera" | "neutro";

/**
 * O que o botão mostra depois do toque: o evento em cima e, embaixo, "avisado às 14:02" — ou o horário
 * com o motivo de o aviso não ter saído. `texto` junta os dois (leitor de tela).
 */
export function rotuloAviso(evento: EventoAviso, a: AvisoTela, agora: number = Date.now()): { titulo: string; detalhe: string; texto: string; tom: TomAviso } {
  const titulo = ROTULO_EVENTO[evento];
  const hora = horaBR(a.em);
  const montar = (detalhe: string, tom: TomAviso) => ({ titulo, detalhe, texto: `${titulo} · ${detalhe}`, tom });
  if (a.status === "ENVIADO") return montar(`avisado às ${hora}`, "ok");
  // Ainda no aparelho (ou o servidor acabou de receber): dentro da janela o aviso ainda sai
  if ((a.status === null || a.status === "PENDENTE") && agora - Date.parse(a.em) <= JANELA_AVISO_MS) return montar(`${hora} · aviso a enviar`, "espera");
  if (a.status === "SEM_DESTINO") return montar(`${hora} · sem e-mail para avisar`, "neutro");
  if (a.status === "INDISPONIVEL") return montar(`${hora} · e-mail não enviado`, "neutro");
  return montar(`${hora} · sem aviso (sem sinal)`, "neutro");
}

/** O recado ao técnico quando a gravação sobe (só o que ele precisa saber; nada do cliente). */
export function recadoAviso(evento: EventoAviso, status: StatusAviso): string {
  if (status === "ENVIADO") return evento === "A_CAMINHO" ? "Cliente avisado: técnico a caminho." : "Cliente avisado: técnico no local.";
  if (status === "ATRASADO") return "Horário registrado. O aviso não foi enviado: faltou sinal na hora do toque.";
  if (status === "SEM_DESTINO") return "Horário registrado. O cliente não tem e-mail para receber o aviso.";
  return "Horário registrado. O e-mail de aviso não pôde ser enviado.";
}
