"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Search, ChevronDown, X } from "lucide-react";

export type ClienteOpcao = {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
  cpfCnpj?: string | null;
};

const CORES = ["bg-sky-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-indigo-500", "bg-teal-500", "bg-orange-500"];

function iniciais(nome: string) {
  return nome.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function corDe(nome: string) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % CORES.length;
  return CORES[h];
}
function formatarDoc(doc?: string | null) {
  if (!doc) return "";
  const d = doc.replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return doc;
}

interface Props {
  value: string;
  onChange: (clienteId: string, cliente?: ClienteOpcao) => void;
  initialLabel?: string;
  error?: boolean;
}

export function ClienteCombobox({ value, onChange, initialLabel, error }: Props) {
  const [clientes, setClientes] = useState<ClienteOpcao[]>([]);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [selecionadoLabel, setSelecionadoLabel] = useState(initialLabel ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then(setClientes).catch(() => {});
  }, []);

  // Atualiza o rótulo selecionado quando a lista chega e já há um value
  useEffect(() => {
    if (value && !selecionadoLabel) {
      const c = clientes.find((c) => c.id === value);
      if (c) setSelecionadoLabel(c.nomeFantasia ?? c.nome);
    }
  }, [clientes, value, selecionadoLabel]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const termo = busca.trim().toLowerCase();
  const filtrados = termo.length >= 2
    ? clientes.filter((c) =>
        (c.nomeFantasia ?? c.nome).toLowerCase().includes(termo) ||
        c.nome.toLowerCase().includes(termo) ||
        (c.cpfCnpj ?? "").replace(/\D/g, "").includes(termo.replace(/\D/g, "")),
      ).slice(0, 30)
    : clientes.slice(0, 8);

  function selecionar(c: ClienteOpcao) {
    setSelecionadoLabel(c.nomeFantasia ?? c.nome);
    setBusca("");
    setAberto(false);
    onChange(c.id, c);
  }
  function limpar() {
    setSelecionadoLabel("");
    setBusca("");
    onChange("");
  }

  return (
    <div ref={ref} className="relative">
      {value && selecionadoLabel && !aberto ? (
        <button
          type="button"
          onClick={() => { setAberto(true); setBusca(""); }}
          className={cn(
            "w-full flex items-center justify-between gap-2 bg-white border rounded-lg px-3 py-2.5 text-sm text-left transition-all",
            error ? "border-red-400" : "border-surface-border hover:border-primary-400",
          )}
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0", corDe(selecionadoLabel))}>
              {iniciais(selecionadoLabel)}
            </span>
            <span className="truncate text-ink">{selecionadoLabel}</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <span onClick={(e) => { e.stopPropagation(); limpar(); }} className="p-0.5 text-ink-muted hover:text-red-500"><X className="w-4 h-4" /></span>
            <ChevronDown className="w-4 h-4 text-ink-muted" />
          </span>
        </button>
      ) : (
        <div className={cn("flex items-center gap-2 bg-white border rounded-lg px-3 py-2.5 transition-all", error ? "border-red-400" : "border-surface-border focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/10")}>
          <Search className="w-4 h-4 text-ink-subtle shrink-0" />
          <input
            autoFocus={aberto}
            value={busca}
            onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
            onFocus={() => setAberto(true)}
            placeholder="Digite 2+ letras para buscar o cliente…"
            className="w-full text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
          />
        </div>
      )}

      {aberto && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-surface-border rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {filtrados.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-subtle">
              {termo.length >= 2 ? "Nenhum cliente encontrado." : "Digite 2+ letras para buscar."}
            </p>
          ) : (
            filtrados.map((c) => {
              const label = c.nomeFantasia ?? c.nome;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selecionar(c)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-alt transition-colors"
                >
                  <span className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0", corDe(label))}>
                    {iniciais(label)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-ink truncate">{label}</span>
                    {c.cpfCnpj && <span className="block text-xs text-ink-muted">{formatarDoc(c.cpfCnpj)}</span>}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
