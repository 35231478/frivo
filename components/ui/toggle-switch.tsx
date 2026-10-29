"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Linha curta sempre visível (use só quando o leitor precisa ver sem abrir a dica) */
  description?: string;
  /** Explicação longa no ⓘ ao lado do rótulo (Princípio 7) */
  dica?: ReactNode;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, label, description, dica, disabled }: ToggleSwitchProps) {
  const id = useId();
  return (
    // O rótulo aponta para o switch (htmlFor): clicar no texto liga/desliga; clicar no ⓘ só abre a dica
    <label htmlFor={id} className={cn(
      "flex items-center justify-between gap-4 py-3 cursor-pointer select-none",
      disabled && "opacity-50 cursor-not-allowed",
    )}>
      <div className="min-w-0">
        <p className="text-sm text-ink flex items-center gap-1">
          <span id={`${id}-rotulo`}>{label}</span>
          {dica && <Dica texto={dica} rotulo={label} lado="direita" />}
        </p>
        {description && <p className="text-xs text-ink-muted mt-0.5">{description}</p>}
      </div>
      <button
        id={id}
        aria-labelledby={`${id}-rotulo`}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative inline-flex h-[26px] w-[46px] shrink-0 rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2",
          checked ? "bg-acento" : "bg-surface-border",
          disabled && "pointer-events-none",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-[22px] w-[22px] rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out mt-[2px]",
            checked ? "translate-x-[22px]" : "translate-x-[2px]",
          )}
        />
      </button>
    </label>
  );
}

interface ToggleGroupProps {
  title: string;
  description?: string;
  /** Explicação do grupo no ⓘ ao lado do título (Princípio 7) */
  dica?: ReactNode;
  children: React.ReactNode;
}

export function ToggleGroup({ title, description, dica, children }: ToggleGroupProps) {
  return (
    <div className="space-y-1">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-1">{title}{dica && <Dica texto={dica} rotulo={title} lado="direita" />}</h3>
        {description && <p className="text-xs text-ink-muted">{description}</p>}
      </div>
      <div className="divide-y divide-surface-linha">
        {children}
      </div>
    </div>
  );
}
