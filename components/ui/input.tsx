import { cn } from "@/lib/utils";
import type { FocusEvent, InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { normalizarTexto, type TipoTexto } from "@/lib/texto/normalizar";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  valido?: boolean;
  /**
   * Padroniza a digitação ao sair do campo (onBlur): "nome" → Nome Próprio, "email" → minúsculo,
   * "cidade"/"endereco" → Nome Próprio, "livre" → só apara espaços. A MESMA função roda no servidor
   * ao gravar — aqui é só o conforto de ver o valor já ajeitado. Não usar em senha, documento
   * mascarado nem campo fiscal.
   */
  caixa?: TipoTexto;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, valido, caixa, onBlur, ...props }, ref) => {
    const aoSair = (e: FocusEvent<HTMLInputElement>) => {
      if (caixa) {
        const el = e.currentTarget;
        const novo = normalizarTexto(el.value, caixa);
        if (novo !== el.value) {
          // Troca o valor pelo caminho nativo e dispara "input": tanto o estado controlado quanto o
          // react-hook-form (register) ouvem esse evento e recebem o valor já padronizado.
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(el, novo);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      onBlur?.(e);
    };
    return (
      <input
        ref={ref}
        {...props}
        onBlur={aoSair}
        className={cn(
          "w-full bg-white border rounded-lg px-3 py-2.5 text-sm text-ink transition-colors",
          "focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15",
          "disabled:bg-surface-page disabled:text-ink-muted disabled:cursor-not-allowed",
          "placeholder:text-ink-subtle",
          error
            ? "border-atrasado focus:border-atrasado focus:ring-atrasado/15"
            : valido
              ? "border-ok focus:border-ok focus:ring-ok/15"
              : "border-surface-campo",
          className
        )}
      />
    );
  }
);
Input.displayName = "Input";
