"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { InputData } from "@/components/ui/input-data";
import { deLocalBR, paraLocalBR } from "@/lib/fuso";

/** Máscara "hh:mm" enquanto digita (só números, dois-pontos automático). */
export function mascararHora(digitado: string): string {
  const n = digitado.replace(/\D/g, "").slice(0, 4);
  return n.length > 2 ? `${n.slice(0, 2)}:${n.slice(2)}` : n;
}

/** "hh:mm" válido (00:00–23:59)? */
export const horaValida = (h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

/**
 * Data E hora sempre em dd/mm/aaaa hh:mm e SEMPRE no relógio de Brasília — no lugar do
 * <input type="datetime-local"> nativo, que mostra mm/dd/yyyy num navegador em inglês e grava no
 * fuso do aparelho. Para fora trabalha com o INSTANTE (ISO UTC, ou "" sem data): lê e grava certo
 * em qualquer navegador/fuso. Data escolhida sem hora usa `horaPadrao` (08:00).
 */
export function InputDataHora({ value, onChange, id, className, disabled, horaPadrao = "08:00", "aria-label": ariaLabel }: {
  /** Instante ISO (ex.: "2026-10-30T17:00:00.000Z") ou "" */
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  horaPadrao?: string;
  "aria-label"?: string;
}) {
  const local = paraLocalBR(value); // "AAAA-MM-DDTHH:mm" em Brasília
  const [dia, setDia] = useState(local.slice(0, 10));
  const [hora, setHora] = useState(local.slice(11, 16));

  // Valor vindo de fora (reset/edição) prevalece
  useEffect(() => {
    const l = paraLocalBR(value);
    setDia((d) => (l ? l.slice(0, 10) : value === "" ? "" : d));
    setHora((h) => (l ? l.slice(11, 16) : value === "" ? "" : h));
  }, [value]);

  function emitir(novoDia: string, novaHora: string) {
    if (!novoDia) { onChange(""); return; }
    const h = horaValida(novaHora) ? novaHora : novaHora ? null : horaPadrao;
    if (!h) return; // hora incompleta: espera terminar de digitar
    onChange(deLocalBR(`${novoDia}T${h}`)!.toISOString());
  }

  const horaInvalida = hora.length === 5 && !horaValida(hora);

  return (
    <div className={cn("flex flex-wrap items-stretch gap-2", className)} data-input-data-hora>
      <InputData
        id={id} className="flex-1 min-w-[8.5rem]" disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} — data` : "Data"}
        value={dia}
        onChange={(d) => {
          setDia(d);
          const h = d && !hora ? horaPadrao : hora;
          if (d && !hora) setHora(horaPadrao);
          emitir(d, h);
        }}
      />
      <div className="relative w-[5.5rem] shrink-0">
        <input
          type="text" inputMode="numeric" autoComplete="off" placeholder="hh:mm" disabled={disabled}
          aria-label={ariaLabel ? `${ariaLabel} — hora` : "Hora"} aria-invalid={horaInvalida || undefined} data-input-hora
          value={hora}
          onChange={(e) => { const h = mascararHora(e.target.value); setHora(h); emitir(dia, h); }}
          className={cn(
            "w-full bg-white border rounded-lg pl-3 pr-7 py-2 text-sm text-ink tabular-nums focus:outline-none focus:ring-4 transition-all disabled:opacity-60",
            horaInvalida ? "border-atrasado focus:border-atrasado focus:ring-red-500/10" : "border-surface-border focus:border-primary-500 focus:ring-primary-500/10",
          )}
        />
        <Clock className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
      </div>
    </div>
  );
}
