"use client";

import { useEffect, useRef, useState } from "react";
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
 * O que foi digitado vira "hh:mm" ao sair do campo: "9" → 09:00, "14" → 14:00, "930" → 09:30,
 * "1830" → 18:30. Devolve null quando não dá uma hora que existe (ex.: "25", "9:7").
 */
export function completarHora(digitado: string): string | null {
  const n = digitado.replace(/\D/g, "");
  if (!n) return null;
  const tentativa = n.length <= 2 ? `${n.padStart(2, "0")}:00` : n.length === 3 ? `0${n[0]}:${n.slice(1)}` : `${n.slice(0, 2)}:${n.slice(2, 4)}`;
  return horaValida(tentativa) ? tentativa : null;
}

/** O que a tela diz (e o motivo de não salvar) quando há data mas a hora está vazia ou não existe */
export const MSG_HORA_INVALIDA = "Informe um horário válido (hh:mm) para salvar.";

/**
 * Data E hora sempre em dd/mm/aaaa hh:mm e SEMPRE no relógio de Brasília — no lugar do
 * <input type="datetime-local"> nativo, que mostra mm/dd/yyyy num navegador em inglês e grava no
 * fuso do aparelho. Para fora trabalha com o INSTANTE (ISO UTC, ou "" sem data): lê e grava certo
 * em qualquer navegador/fuso. Ao escolher a data com a hora vazia, o campo da hora é preenchido com
 * `horaPadrao` (08:00) À VISTA. Depois disso a hora é exigida: com data e hora vazia, incompleta ou
 * que não existe, o campo fica em vermelho, NADA é entregue (não cai em 08:00 escondido nem deixa
 * valendo a hora anterior) e `onProblema` avisa o formulário, que não salva enquanto não corrigir.
 */
export function InputDataHora({ value, onChange, onProblema, id, className, disabled, horaPadrao = "08:00", "aria-label": ariaLabel }: {
  /** Instante ISO (ex.: "2026-10-30T17:00:00.000Z") ou "" */
  value: string;
  onChange: (iso: string) => void;
  /** Avisa o formulário: a mensagem enquanto há data sem hora válida; null quando está tudo certo */
  onProblema?: (mensagem: string | null) => void;
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
    // Hora vazia, incompleta ou que não existe: não entrega nada (o formulário é avisado e não salva)
    if (!horaValida(novaHora)) return;
    onChange(deLocalBR(`${novoDia}T${novaHora}`)!.toISOString());
  }

  // Com data, a hora é obrigatória e tem de existir
  const horaFaltando = !!dia && !horaValida(hora);
  const [saiu, setSaiu] = useState(false);
  // Em vermelho: hora completa que não existe, ou a pessoa já saiu do campo deixando-a vazia/incompleta
  const horaInvalida = horaFaltando && (hora.length === 5 || saiu);
  const avisar = useRef(onProblema);
  avisar.current = onProblema;
  useEffect(() => {
    avisar.current?.(horaFaltando ? MSG_HORA_INVALIDA : null);
    return () => avisar.current?.(null);
  }, [horaFaltando]);

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
          onChange={(e) => { const h = mascararHora(e.target.value); setHora(h); setSaiu(false); emitir(dia, h); }}
          onBlur={() => {
            if (!dia || horaValida(hora)) return;
            const completa = completarHora(hora); // "9" → 09:00
            if (completa) { setHora(completa); emitir(dia, completa); } else setSaiu(true);
          }}
          className={cn(
            "w-full bg-white border rounded-lg pl-3 pr-7 py-2 text-sm text-ink tabular-nums focus:outline-none focus:ring-4 transition-all disabled:opacity-60",
            horaInvalida ? "border-atrasado focus:border-atrasado focus:ring-atrasado/10" : "border-surface-campo focus:border-primary-500 focus:ring-primary-500/10",
          )}
        />
        <Clock className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
      </div>
      {horaInvalida && <p data-hora-erro className="basis-full text-xs text-atrasado">Informe um horário válido (hh:mm).</p>}
    </div>
  );
}
