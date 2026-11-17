/**
 * Calendário — o status no cartão da OS. A cor é ACENTO, não fundo: o cartão é neutro (cinza
 * levíssimo sobre o branco do dia) e só uma barra fina à esquerda leva a cor do status. Quatro cores,
 * uma por grupo de status, todas dos tokens (lib/ui/tokens.ts) — nunca cor por técnico nem por tipo.
 * O atrasado, que precisa ser óbvio, pinta também a hora.
 *
 * Exceção registrada à regra "sem borda colorida à esquerda" da identidade (docs/design-system.md):
 * vale só para o evento do calendário, onde a barra é o status — pedido explícito de produto.
 */
import { acento, neutro, status } from "@/lib/ui/tokens";

export type GrupoStatus = "aberta" | "andamento" | "concluida" | "atrasada" | "neutra";

const GRUPO_DO_STATUS: Record<string, GrupoStatus> = {
  ABERTA: "aberta",
  AGUARDANDO_ATENDIMENTO: "aberta",
  AGENDADA: "aberta",
  EM_ANDAMENTO: "andamento",
  PAUSADA: "andamento",
  AGUARDANDO_PECA: "andamento",
  CONCLUIDA: "concluida",
  CANCELADA: "neutra",
};

/** Atrasada vence o status: é o que a pessoa precisa ver primeiro */
export function grupoDoCard(c: { status: string; atrasada?: boolean }): GrupoStatus {
  return c.atrasada ? "atrasada" : GRUPO_DO_STATUS[c.status] ?? "neutra";
}

/** O cartão em si: neutro, sem contorno e sem sombra; um tom acima no hover */
export const ESTILO_CARTAO = "bg-surface-alt hover:bg-surface-linha";

/** As classes de cada grupo (literais: o Tailwind só gera o que lê por extenso) */
export const ESTILO_GRUPO: Record<GrupoStatus, { rotulo: string; barra: string; hora: string }> = {
  aberta: { rotulo: "Aberta / agendada", barra: "bg-acento", hora: "text-ink" },
  andamento: { rotulo: "Em andamento", barra: "bg-atencao", hora: "text-ink" },
  concluida: { rotulo: "Concluída", barra: "bg-ok", hora: "text-ink" },
  atrasada: { rotulo: "Atrasada", barra: "bg-atrasado", hora: "text-atrasado-texto" },
  neutra: { rotulo: "Cancelada", barra: "bg-previsto", hora: "text-ink" },
};

/** As MESMAS cores, em hexadecimal, para o teste de contraste (um par por classe acima) */
export const CORES_GRUPO: Record<GrupoStatus, { barra: string; hora: string }> = {
  aberta: { barra: acento.DEFAULT, hora: neutro.texto },
  andamento: { barra: status.atencao.DEFAULT, hora: neutro.texto },
  concluida: { barra: status.ok.DEFAULT, hora: neutro.texto },
  atrasada: { barra: status.atrasado.DEFAULT, hora: status.atrasado.texto },
  neutra: { barra: status.previsto.DEFAULT, hora: neutro.texto },
};

/** O que é igual em todo cartão: fundo neutro, nome do cliente, apoio (sigla do técnico, ícones) */
export const CORES_CARTAO = { fundo: neutro.fundo, hover: neutro.linha, principal: neutro.texto, apoio: neutro.secundario, celula: neutro.superficie } as const;
