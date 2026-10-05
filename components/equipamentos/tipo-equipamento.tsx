import type { LucideIcon } from "lucide-react";
import {
  AirVent, AppWindow, Building2, Wind, Snowflake, Factory, Refrigerator, Container,
  Thermometer, Server, Fan, Box, PanelTop,
} from "lucide-react";
import { cn, LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";

/**
 * Identidade visual por tipo de equipamento (ícone + cor), usada na listagem,
 * no perfil e no formulário. As cores agrupam famílias: ar-condicionado (azuis),
 * água gelada/torre (ciano), refrigeração comercial (violeta), sistemas (índigo).
 */
const VISUAL: Record<string, { icone: LucideIcon; cor: string; fundo: string }> = {
  AR_CONDICIONADO_SPLIT:    { icone: AirVent,      cor: "text-sky-700",     fundo: "bg-sky-50" },
  AR_CONDICIONADO_JANELA:   { icone: AppWindow,    cor: "text-sky-700",     fundo: "bg-sky-50" },
  AR_CONDICIONADO_CENTRAL:  { icone: Building2,    cor: "text-blue-700",    fundo: "bg-blue-50" },
  AR_CONDICIONADO_PORTATIL: { icone: Box,          cor: "text-sky-700",     fundo: "bg-sky-50" },
  CHILLER:                  { icone: Snowflake,    cor: "text-cyan-700",    fundo: "bg-cyan-50" },
  TORRE_RESFRIAMENTO:       { icone: Factory,      cor: "text-cyan-700",    fundo: "bg-cyan-50" },
  CAMARA_FRIA:              { icone: Container,    cor: "text-violet-700",  fundo: "bg-violet-50" },
  CAMARA_CLIMATIZADA:       { icone: Thermometer,  cor: "text-violet-700",  fundo: "bg-violet-50" },
  REFRIGERADOR_COMERCIAL:   { icone: Refrigerator, cor: "text-violet-700",  fundo: "bg-violet-50" },
  CONGELADOR_COMERCIAL:     { icone: Refrigerator, cor: "text-violet-700",  fundo: "bg-violet-50" },
  VRF:                      { icone: Server,       cor: "text-indigo-700",  fundo: "bg-indigo-50" },
  FANCOIL:                  { icone: Fan,          cor: "text-teal-700",    fundo: "bg-teal-50" },
  CONDENSADORA:             { icone: Wind,         cor: "text-slate-700",   fundo: "bg-slate-100" },
  EVAPORADORA:              { icone: PanelTop,     cor: "text-slate-700",   fundo: "bg-slate-100" },
};
const PADRAO = { icone: Thermometer, cor: "text-slate-600", fundo: "bg-slate-100" };

export function visualTipo(tipo: string) {
  return VISUAL[tipo] ?? PADRAO;
}

export function labelTipo(tipo: string, nomeCustom?: string | null) {
  return nomeCustom ?? LABELS_TIPO_EQUIPAMENTO[tipo] ?? tipo;
}

/** Ícone do tipo dentro de um quadrado colorido (miniatura sem foto, hero, formulário). */
export function TipoIcone({ tipo, tamanho = "md", className }: { tipo: string; tamanho?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const v = visualTipo(tipo);
  const Icone = v.icone;
  const caixa = { sm: "w-8 h-8 rounded-md", md: "w-10 h-10 rounded-lg", lg: "w-14 h-14 rounded-xl", xl: "w-full h-full rounded-xl" }[tamanho];
  const icone = { sm: "w-4 h-4", md: "w-5 h-5", lg: "w-7 h-7", xl: "w-14 h-14" }[tamanho];
  return (
    <div className={cn("flex items-center justify-center shrink-0", caixa, v.fundo, v.cor, className)}>
      <Icone className={icone} />
    </div>
  );
}

/** Selo do tipo com ícone. */
export function TipoBadge({ tipo, label, className }: { tipo: string; label?: string; className?: string }) {
  const v = visualTipo(tipo);
  const Icone = v.icone;
  return (
    <span
      title={label ?? labelTipo(tipo)}
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap max-w-full", v.fundo, v.cor, className)}
    >
      <Icone className="w-3 h-3 shrink-0" />
      <span className="truncate">{label ?? labelTipo(tipo)}</span>
    </span>
  );
}
