/**
 * Calendário — a cor do cartão da OS. O cartão INTEIRO leva a cor do status (fundo claro + contorno do
 * mesmo matiz), para se destacar do branco do dia e ser lido de relance; a bolinha continua dizendo o
 * mesmo status. Tudo vem dos tokens (lib/ui/tokens.ts) — o teste de contraste confere estes pares:
 * texto sobre o fundo ≥ 4.5:1 (WCAG AA) e contorno sobre o branco da célula ≥ 3:1.
 */
import { acento, escalaAcento, neutro, status } from "@/lib/ui/tokens";

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

/** Quanto do matiz entra no contorno do cartão (o resto é o branco da célula) */
export const OPACIDADE_BORDA = 0.8;

/** As classes de cada grupo (literais: o Tailwind só gera o que lê por extenso) */
export const ESTILO_GRUPO: Record<GrupoStatus, { rotulo: string; ponto: string; cartao: string; hora: string }> = {
  aberta: { rotulo: "Aberta / agendada", ponto: "bg-acento", cartao: "bg-acento-claro border-acento/80 hover:border-acento", hora: "text-primary-700" },
  andamento: { rotulo: "Em andamento", ponto: "bg-atencao", cartao: "bg-atencao-claro border-atencao/80 hover:border-atencao", hora: "text-atencao-texto" },
  concluida: { rotulo: "Concluída", ponto: "bg-ok", cartao: "bg-ok-claro border-ok/80 hover:border-ok", hora: "text-ok-texto" },
  atrasada: { rotulo: "Atrasada", ponto: "bg-atrasado", cartao: "bg-atrasado-claro border-atrasado/80 hover:border-atrasado", hora: "text-atrasado-texto" },
  neutra: { rotulo: "Cancelada", ponto: "bg-previsto", cartao: "bg-previsto-claro border-previsto/80 hover:border-previsto", hora: "text-previsto-texto" },
};

/** As MESMAS cores, em hexadecimal, para o teste de contraste (um par por classe acima) */
export const CORES_GRUPO: Record<GrupoStatus, { fundo: string; borda: string; hora: string }> = {
  aberta: { fundo: acento.claro, borda: acento.DEFAULT, hora: escalaAcento[700] },
  andamento: { fundo: status.atencao.claro, borda: status.atencao.DEFAULT, hora: status.atencao.texto },
  concluida: { fundo: status.ok.claro, borda: status.ok.DEFAULT, hora: status.ok.texto },
  atrasada: { fundo: status.atrasado.claro, borda: status.atrasado.DEFAULT, hora: status.atrasado.texto },
  neutra: { fundo: status.previsto.claro, borda: status.previsto.DEFAULT, hora: status.previsto.texto },
};

/** Texto do cartão (nome do cliente) e ícones de apoio: os mesmos em todo grupo */
export const TEXTO_CARTAO = { principal: neutro.texto, apoio: neutro.secundario, celula: neutro.superficie } as const;

/** A cor com que o contorno aparece de verdade: o matiz misturado ao branco da célula */
export function bordaSobreCelula(grupo: GrupoStatus): string {
  const mis = (i: number) => Math.round(parseInt(CORES_GRUPO[grupo].borda.slice(i, i + 2), 16) * OPACIDADE_BORDA + parseInt(TEXTO_CARTAO.celula.slice(i, i + 2), 16) * (1 - OPACIDADE_BORDA));
  return `#${[1, 3, 5].map((i) => mis(i).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
