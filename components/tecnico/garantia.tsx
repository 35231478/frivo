"use client";

import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import { seloGarantia } from "@/lib/tecnico/garantia";

const ESTILO = {
  vigente: { classe: "bg-success-100 text-success-700", Icone: ShieldCheck },
  vencendo: { classe: "bg-atencao-claro text-atencao-texto", Icone: ShieldAlert },
  vencida: { classe: "bg-surface-linha text-ink-muted", Icone: ShieldX },
} as const;

/** Selo da garantia do equipamento ("Em garantia até …"); sem garantia cadastrada, nada. */
export function SeloGarantia({ fim, className }: { fim?: string | null; className?: string }) {
  const s = seloGarantia(fim);
  if (!s) return null;
  const { classe, Icone } = ESTILO[s.situacao];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-0.5", classe, className)} data-garantia={s.situacao}>
      <Icone className="w-3.5 h-3.5" aria-hidden /> {s.texto}
    </span>
  );
}
