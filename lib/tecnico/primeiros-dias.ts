/**
 * D8 (App pronto pra janeiro 2) — o cartão ÚNICO do Meu dia nos primeiros dias: "Instale o app e ative as
 * notificações". Regra pura (o aparelho decide; nada vai ao servidor):
 *  - só nos primeiros DIAS_PRIMEIROS dias de uso NESTE aparelho (contados do primeiro Meu dia aberto nele);
 *  - some quando está feito (instalado na tela de início E com as notificações ativas) ou quando o técnico dispensa;
 *  - o servidor sem notificações configuradas: não há o que pedir (o cartão não aparece);
 *  - o passo mostrado é o que falta AGORA, na ordem: instalar (no iPhone, o passo do Safari; só instalado o iPhone
 *    recebe notificação) → ativar as notificações. Bloqueadas no aparelho: diz onde liberar.
 */
import type { EstadoPush } from "@/lib/push";

export const DIAS_PRIMEIROS = 7;
export const CHAVE_PRIMEIROS_DIAS = "primeirosDias";

/** O que fica guardado no aparelho */
export interface GuardadoPrimeirosDias { desde: number; dispensado?: boolean }

export type PassoPrimeirosDias = "instalar-iphone" | "instalar" | "ativar" | "bloqueado";

export function passoPrimeirosDias(p: {
  guardado: GuardadoPrimeirosDias | null; agora: number; instalado: boolean; iphone: boolean;
  push: EstadoPush["situacao"];
}): PassoPrimeirosDias | null {
  if (!p.guardado || p.guardado.dispensado) return null;
  if (p.agora - p.guardado.desde > DIAS_PRIMEIROS * 86_400_000) return null;
  if (p.push === "desligado") return null;
  if (!p.instalado) return p.iphone ? "instalar-iphone" : "instalar";
  if (p.push === "ativo" || p.push === "sem-suporte") return null;
  if (p.push === "bloqueado") return "bloqueado";
  return "ativar";
}

export const TEXTO_PASSO: Record<PassoPrimeirosDias, string> = {
  "instalar-iphone": "No Safari, toque em Compartilhar (o quadrado com a seta) › Adicionar à Tela de Início. Depois abra o Frivo pelo ícone e ative as notificações aqui.",
  instalar: "Instale o Frivo na tela de início: abre mais rápido e funciona melhor sem sinal. Depois, ative as notificações.",
  ativar: "Falta ativar as notificações: você fica sabendo na hora de OS nova, reagendada ou de recado do escritório.",
  bloqueado: "As notificações estão bloqueadas neste aparelho. Libere nas configurações do celular (Notificações › Frivo).",
};
