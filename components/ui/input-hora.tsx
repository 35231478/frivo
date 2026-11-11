"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { horaValida, mascararHora } from "@/components/ui/input-data-hora";

/**
 * O que foi digitado vira "hh:mm" ao sair do campo: "9" → 09:00, "14" → 14:00, "930" → 09:30,
 * "1830" → 18:30. Devolve null quando não dá uma hora que existe (ex.: "25", "9:7").
 */
export function completarHora(digitado: string): string | null {
  const n = digitado.replace(/\D/g, "");
  if (!n) return null;
  const tentativas = n.length <= 2 ? [`${n.padStart(2, "0")}:00`]
    : n.length === 3 ? [`0${n[0]}:${n.slice(1)}`]
      : [`${n.slice(0, 2)}:${n.slice(2, 4)}`];
  return tentativas.find(horaValida) ?? null;
}

/**
 * Hora sempre em hh:mm de 24 horas — no lugar do <input type="time"> nativo, que num navegador em
 * inglês mostra 12 h com AM/PM. Para fora trabalha com "HH:mm" (ou "" vazio), o mesmo valor que o
 * campo nativo entregava: troca direta — hora completa e válida sai como "HH:mm"; incompleta ou que
 * não existe sai como "" (nunca fica valendo, calada, a hora anterior). Ao sair do campo completa o
 * que der ("9" → 09:00) e marca em vermelho o que não é hora.
 */
export function InputHora({ value, onChange, id, className, disabled, placeholder = "hh:mm", "aria-label": ariaLabel }: {
  /** "HH:mm" ou "" */
  value: string;
  onChange: (hora: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [texto, setTexto] = useState(value ?? "");
  const [saiu, setSaiu] = useState(false);
  // O último valor que este campo entregou: só o que vem DE FORA (reset/edição) troca o texto —
  // o "" de uma hora ainda incompleta não apaga o que a pessoa está digitando
  const entregue = useRef(value ?? "");
  useEffect(() => {
    const v = value ?? "";
    if (v === entregue.current) return;
    entregue.current = v; setTexto(v); setSaiu(false);
  }, [value]);
  const entregar = (h: string) => { if (h !== entregue.current) { entregue.current = h; onChange(h); } };

  const invalida = !!texto && !horaValida(texto) && (saiu || texto.length === 5);

  return (
    <div className={cn("relative", className)} data-input-hora-campo>
      <input
        id={id} type="text" inputMode="numeric" autoComplete="off" placeholder={placeholder} disabled={disabled}
        aria-label={ariaLabel} aria-invalid={invalida || undefined} data-input-hora
        value={texto}
        onChange={(e) => {
          const h = mascararHora(e.target.value);
          setTexto(h); setSaiu(false);
          entregar(horaValida(h) ? h : "");
        }}
        onBlur={() => {
          if (!texto || horaValida(texto)) return;
          const completa = completarHora(texto);
          if (completa) { setTexto(completa); entregar(completa); } else setSaiu(true);
        }}
        className={cn(
          "w-full bg-white border rounded-lg pl-3 pr-8 py-2 text-sm text-ink tabular-nums focus:outline-none focus:ring-4 transition-all disabled:opacity-60",
          invalida ? "border-atrasado focus:border-atrasado focus:ring-atrasado/10" : "border-surface-campo focus:border-primary-500 focus:ring-primary-500/10",
        )}
      />
      <Clock className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" aria-hidden />
    </div>
  );
}
