"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

/** ISO (aaaa-mm-dd) → "dd/mm/aaaa" */
export function isoParaBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "dd/mm/aaaa" → ISO, ou null se a data não existir (31/02, 00/13…) */
export function brParaIso(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, mes - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Máscara enquanto digita: só números, barras automáticas, até 8 dígitos. */
export function mascararData(digitado: string): string {
  const n = digitado.replace(/\D/g, "").slice(0, 8);
  return [n.slice(0, 2), n.slice(2, 4), n.slice(4, 8)].filter(Boolean).join("/");
}

/**
 * UX-8 (G1): data SEMPRE em dd/mm/aaaa, qualquer que seja o idioma do sistema operacional
 * (o <input type="date"> nativo mostra mm/dd/yyyy num navegador em inglês). Continua com o
 * calendário do aparelho no botão ao lado. Trabalha com ISO (aaaa-mm-dd) para fora, igual ao
 * input nativo — troca direta. Com `name`, um campo oculto leva o ISO em formulários GET.
 */
export function InputData({ value, defaultValue, onChange, name, id, className, placeholder = "dd/mm/aaaa", title, disabled, "aria-label": ariaLabel }: {
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  name?: string;
  id?: string;
  className?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const controlado = value !== undefined;
  const [texto, setTexto] = useState(isoParaBr(controlado ? value : defaultValue));
  const [iso, setIso] = useState((controlado ? value : defaultValue) ?? "");
  const nativo = useRef<HTMLInputElement>(null);

  // Valor vindo de fora (ex.: reset do formulário) prevalece
  useEffect(() => {
    if (!controlado) return;
    setIso(value ?? "");
    setTexto((t) => (brParaIso(t) === (value ?? "") ? t : isoParaBr(value)));
  }, [controlado, value]);

  function aplicar(novoIso: string) {
    setIso(novoIso);
    onChange?.(novoIso);
  }

  const invalida = texto.length === 10 && !brParaIso(texto);

  return (
    <div className={cn("relative", className)}>
      <input
        id={id} type="text" inputMode="numeric" autoComplete="off" placeholder={placeholder} title={title} disabled={disabled}
        aria-label={ariaLabel} aria-invalid={invalida || undefined} data-input-data value={texto}
        onChange={(e) => {
          const t = mascararData(e.target.value);
          setTexto(t);
          if (!t) aplicar("");
          else { const i = brParaIso(t); if (i) aplicar(i); }
        }}
        className={cn(
          "w-full bg-white border rounded-lg pl-3 pr-10 py-2 text-sm text-ink focus:outline-none focus:ring-4 transition-all disabled:opacity-60",
          invalida ? "border-red-400 focus:border-red-500 focus:ring-red-500/10" : "border-surface-border focus:border-primary-500 focus:ring-primary-500/10",
        )}
      />
      <button
        type="button" disabled={disabled} aria-label="Abrir calendário" data-abrir-calendario
        onClick={() => { const el = nativo.current; if (!el) return; try { el.showPicker(); } catch { el.click(); } }}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-ink-subtle hover:text-primary-600 disabled:opacity-50"
      >
        <CalendarDays className="w-4 h-4" />
      </button>
      {/* Calendário do aparelho (invisível): escolheu, vira dd/mm/aaaa no campo */}
      <input
        ref={nativo} type="date" tabIndex={-1} aria-hidden value={iso}
        onChange={(e) => { setTexto(isoParaBr(e.target.value)); aplicar(e.target.value); }}
        className="absolute right-0 bottom-0 w-0 h-0 opacity-0 pointer-events-none"
      />
      {name && <input type="hidden" name={name} value={iso} />}
    </div>
  );
}
