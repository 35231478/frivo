"use client";

import { useState, useId, type KeyboardEvent, type ClipboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmailsInputProps {
  value: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Entrada de múltiplos e-mails como "tags" (chips). Confirma cada e-mail com
 * Enter, Tab, vírgula ou ao sair do campo; aceita colar uma lista separada por
 * vírgula/ponto-e-vírgula/espaço. Ignora duplicados e e-mails inválidos.
 */
export function EmailsInput({ value, onChange, placeholder, id, disabled }: EmailsInputProps) {
  const gerado = useId();
  const inputId = id ?? gerado;
  const [rascunho, setRascunho] = useState("");
  const [erro, setErro] = useState(false);

  function adicionar(bruto: string): boolean {
    const candidatos = bruto.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (candidatos.length === 0) return true;
    const validos: string[] = [];
    let houveInvalido = false;
    for (const c of candidatos) {
      if (!EMAIL_RE.test(c)) { houveInvalido = true; continue; }
      if (!value.includes(c) && !validos.includes(c)) validos.push(c);
    }
    if (validos.length > 0) onChange([...value, ...validos]);
    setErro(houveInvalido);
    return !houveInvalido;
  }

  function confirmar() {
    if (!rascunho.trim()) { setErro(false); return; }
    if (adicionar(rascunho)) setRascunho("");
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
      if (e.key === "Tab" && !rascunho.trim()) return;
      e.preventDefault();
      confirmar();
    } else if (e.key === "Backspace" && !rascunho && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function aoColar(e: ClipboardEvent<HTMLInputElement>) {
    const texto = e.clipboardData.getData("text");
    if (/[\s,;]/.test(texto)) { e.preventDefault(); if (adicionar(texto)) setRascunho(""); }
  }

  function remover(email: string) {
    onChange(value.filter((e) => e !== email));
  }

  return (
    <div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 w-full min-h-[42px] border rounded-lg px-2 py-1.5 bg-white transition-colors",
          "focus-within:ring-2 focus-within:ring-acento focus-within:border-acento",
          disabled && "opacity-50 bg-surface-page",
          erro ? "border-atrasado" : "border-surface-campo",
        )}
        onClick={() => document.getElementById(inputId)?.focus()}
        data-emails-input
      >
        {value.map((email) => (
          <span key={email} data-chip={email} className="inline-flex items-center gap-1 bg-frivo-50 text-frivo-700 text-xs font-medium rounded-md pl-2 pr-1 py-1 max-w-full">
            <span className="truncate">{email}</span>
            {!disabled && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); remover(email); }}
                className="shrink-0 rounded hover:bg-frivo-100 text-frivo-700/70 hover:text-frivo-700 p-0.5"
                aria-label={`Excluir e-mail ${email}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        <input
          id={inputId}
          type="email"
          inputMode="email"
          disabled={disabled}
          value={rascunho}
          onChange={(e) => { setRascunho(e.target.value); if (erro) setErro(false); }}
          onKeyDown={aoTeclar}
          onPaste={aoColar}
          onBlur={confirmar}
          placeholder={value.length === 0 ? (placeholder ?? "exemplo@empresa.com.br") : ""}
          className="flex-1 min-w-[8rem] border-0 outline-none text-sm bg-transparent py-1 placeholder:text-ink-muted"
        />
      </div>
      {erro && <p className="text-xs text-atrasado font-medium mt-1">E-mail inválido. Confira o endereço digitado.</p>}
    </div>
  );
}
