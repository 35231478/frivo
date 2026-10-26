import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Tom de status do sistema de design. A cor tem função:
 *  - ok: concluído, pago, em dia;
 *  - atencao: em andamento, vence hoje, precisa de olhar;
 *  - atrasado: vencido, atrasado, cancelado/erro;
 *  - previsto: neutro, ainda não começou, sem prazo;
 *  - acento: informação/agendado (a cor da marca, sem juízo de valor);
 *  - ok-solido / atrasado-solido: o mesmo significado, com mais peso (faturada, crítico).
 */
export type TomStatus = "ok" | "atencao" | "atrasado" | "previsto" | "acento" | "ok-solido" | "atrasado-solido";

export const CLASSE_TOM: Record<TomStatus, string> = {
  ok: "bg-ok-claro text-ok-texto",
  atencao: "bg-atencao-claro text-atencao-texto",
  atrasado: "bg-atrasado-claro text-atrasado-texto",
  previsto: "bg-previsto-claro text-previsto-texto",
  acento: "bg-acento-claro text-acento",
  "ok-solido": "bg-ok text-white",
  "atrasado-solido": "bg-atrasado text-white",
};

/** Pílula de status (texto sempre presente: a cor reforça, não substitui a palavra). */
export function StatusPill({ tom, children, className, tamanho = "md", ...dados }: {
  tom: TomStatus;
  children: ReactNode;
  className?: string;
  tamanho?: "sm" | "md";
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span
      {...dados}
      data-tom={tom}
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap",
        tamanho === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-0.5",
        CLASSE_TOM[tom],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Estágio da OS → tom (ABERTA previsto, AGENDADA acento, EM_ANDAMENTO atenção, CONCLUIDA ok…). */
export const TOM_ESTAGIO_OS: Record<string, TomStatus> = {
  ABERTA: "previsto", AGUARDANDO_ATENDIMENTO: "previsto", AGENDADA: "acento",
  EM_ANDAMENTO: "atencao", PAUSADA: "atencao", AGUARDANDO_PECA: "atencao",
  CONCLUIDA: "ok", FATURADA: "ok-solido", CANCELADA: "atrasado",
};

/** Prioridade → tom. */
export const TOM_PRIORIDADE: Record<string, TomStatus> = {
  BAIXA: "previsto", NORMAL: "previsto", ALTA: "atencao", URGENTE: "atrasado", CRITICO: "atrasado-solido",
};

/** Situação de prazo (lib/os/prazos) → tom. */
export const TOM_PRAZO: Record<string, TomStatus> = {
  ATRASADO: "atrasado", VENCE_HOJE: "atencao", NO_PRAZO: "previsto", CUMPRIDO: "ok", SEM_PRAZO: "previsto",
};
