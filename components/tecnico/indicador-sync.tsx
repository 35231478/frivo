"use client";

import { AlertTriangle, CloudOff, CloudUpload, Loader2, LogIn, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EstadoSync } from "@/lib/tecnico/offline/motor";

/** Rótulo do indicador (offline / sincronizando / sincronizado + os casos que pedem ação). */
export function rotuloSync(e: EstadoSync): { texto: string; detalhe: string; classe: string } {
  const n = e.pendentes;
  const fila = n === 1 ? "1 gravação" : `${n} gravações`;
  switch (e.situacao) {
    case "offline": return { texto: n ? `Offline · ${n}` : "Offline", detalhe: n ? `${fila} no aparelho — sobe quando o sinal voltar` : "Tudo o que você gravar fica no aparelho", classe: "bg-slate-700 text-white" };
    case "sincronizando": return { texto: "Sincronizando…", detalhe: n ? `Enviando ${fila}` : "Conferindo com o escritório", classe: "bg-primary-600 text-white" };
    case "pendente": return { texto: `${n} a enviar`, detalhe: "Envia sozinho em instantes", classe: "bg-amber-500 text-white" };
    case "erro": return { texto: e.erros === 1 ? "1 recusada" : `${e.erros} recusadas`, detalhe: "Toque para ver o motivo", classe: "bg-red-600 text-white" };
    case "sessao": return { texto: "Entre de novo", detalhe: "Sua sessão expirou — nada foi perdido", classe: "bg-red-600 text-white" };
    default: return { texto: "Sincronizado", detalhe: "Tudo enviado ao escritório", classe: "bg-success-600 text-white" };
  }
}

const ICONE = { offline: CloudOff, sincronizando: Loader2, pendente: CloudUpload, erro: AlertTriangle, sessao: LogIn, sincronizado: CheckCircle2 } as const;

/** O indicador sempre visível no topo do app: o técnico sabe se o que gravou já subiu. */
export function IndicadorSync({ estado, onClick }: { estado: EstadoSync; onClick?: () => void }) {
  const r = rotuloSync(estado);
  const Icone = ICONE[estado.situacao];
  return (
    <button type="button" onClick={onClick} title={r.detalhe} aria-label={`${r.texto}. ${r.detalhe}`} data-sync={estado.situacao}
      className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm touch-target", r.classe)}>
      <Icone className={cn("w-4 h-4", estado.situacao === "sincronizando" && "animate-spin")} />
      <span>{r.texto}</span>
    </button>
  );
}
