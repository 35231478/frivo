"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { filtrarCodigos, type OpcaoCodigo } from "@/lib/nfse/busca-codigo";

interface Props {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  opcoes: readonly OpcaoCodigo[];
  placeholder?: string;
  disabled?: boolean;
  /** Texto quando nada bate com a busca */
  semResultado?: string;
}

/**
 * Caixa de busca-e-seleção de códigos (estilo ContaAzul): filtra ao digitar, mostra
 * "código — descrição" e preenche com o código ao clicar (ou ↑/↓ + Enter). O que a pessoa
 * digitar também vale (a lista é apoio, não trava). Combobox acessível (ARIA 1.2).
 */
export function ComboboxCodigo({ id, value, onChange, opcoes, placeholder, disabled, semResultado = "Nenhum código encontrado: o digitado vale como está." }: Props) {
  const listaId = useId();
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtradas = useMemo(() => filtrarCodigos(opcoes, value), [opcoes, value]);

  function escolher(o: OpcaoCodigo) {
    onChange(o.codigo);
    setAberto(false);
    setAtivo(-1);
  }

  function teclado(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!aberto) { setAberto(true); setAtivo(0); return; }
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setAtivo((a) => Math.min(Math.max(a + passo, 0), filtradas.length - 1));
    } else if (e.key === "Enter" && aberto && filtradas[ativo]) {
      e.preventDefault();
      escolher(filtradas[ativo]);
    } else if (e.key === "Escape" && aberto) {
      // Fecha só a lista (sem isso o Esc chega na gaveta e fecha o formulário inteiro)
      e.preventDefault();
      e.stopPropagation();
      setAberto(false);
    }
  }

  let grupoAnterior: string | undefined;
  return (
    <div className="relative">
      <Input
        ref={inputRef} id={id} value={value} disabled={disabled} placeholder={placeholder} autoComplete="off"
        role="combobox" aria-expanded={aberto} aria-controls={listaId} aria-autocomplete="list"
        aria-activedescendant={aberto && ativo >= 0 ? `${listaId}-${ativo}` : undefined}
        onChange={(e) => { onChange(e.target.value); setAberto(true); setAtivo(-1); }}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        onKeyDown={teclado}
        className="pr-9"
      />
      <button
        type="button" tabIndex={-1} disabled={disabled} aria-label="Ver a lista"
        onMouseDown={(e) => { e.preventDefault(); setAberto((a) => !a); inputRef.current?.focus(); }}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-ink-subtle hover:text-ink disabled:opacity-40"
      >
        <ChevronDown className="w-4 h-4" />
      </button>
      {aberto && !disabled && (
        <ul
          id={listaId} role="listbox"
          className="absolute z-30 left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-white border border-surface-border rounded-lg shadow-card-hover py-1"
        >
          {filtradas.length === 0 && <li className="px-3 py-2 text-xs text-ink-subtle italic">{semResultado}</li>}
          {filtradas.map((o, i) => {
            const cabecalho = o.grupo && o.grupo !== grupoAnterior ? o.grupo : null;
            grupoAnterior = o.grupo;
            return (
              <li key={`${o.grupo ?? ""}|${o.codigo}`} role="presentation">
                {cabecalho && <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{cabecalho}</p>}
                <div
                  id={`${listaId}-${i}`} role="option" aria-selected={i === ativo} data-codigo={o.codigo}
                  onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
                  onMouseEnter={() => setAtivo(i)}
                  className={cn("px-3 py-1.5 text-sm cursor-pointer flex gap-2", i === ativo ? "bg-primary-50" : "hover:bg-surface-page")}
                >
                  <span className="font-mono font-semibold text-ink shrink-0">{o.codigo}</span>
                  <span className="text-ink-muted line-clamp-2">{o.descricao}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
