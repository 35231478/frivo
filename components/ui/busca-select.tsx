"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useCampo } from "@/components/ui/campo-contexto";
import { Search, X, ChevronDown, Plus } from "lucide-react";

export interface OpcaoBusca {
  value: string;
  label: string;
  /** Marcado como inativo (fica na lista porque é o valor atual do registro) */
  inativo?: boolean;
  /** Texto do `title` (o rótulo inteiro quando a linha é cortada) */
  titulo?: string;
  /** `data-*` extras da opção (os testes de cada tela usam) */
  atributos?: Record<string, string | undefined>;
}

interface BuscaSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: OpcaoBusca[];
  /** Texto quando nada está escolhido ("Selecione…", "Sem categoria", "Manual / digitar") */
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Rótulo para o leitor de tela (o <label> da tela, quando existe, já basta) */
  rotulo?: string;
  /** Ação no pé da lista ("＋ Novo produto…"): o chamador abre o cadastro rápido */
  acao?: { rotulo: string; onClick: () => void };
  /** `data-*` do campo (os testes de cada tela usam) */
  atributos?: Record<string, string | boolean | undefined>;
  id?: string;
  nome?: string;
}

/** Quantas opções a lista desenha de uma vez (o resto espera a busca apertar) */
const TETO = 60;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * O seletor de escolha única COM BUSCA da casa: o mesmo componente em todo lugar que escolhe um
 * item de um cadastro que cresce (produto, cliente, equipamento, unidade, fornecedor, OS…).
 *
 * - digitar filtra a lista (sem acento e sem caixa: "jose" acha "José");
 * - teclado inteiro: ↓ abre, ↑ ↓ andam, Enter escolhe, Esc fecha e devolve o foco ao campo, Tab sai;
 * - celular: a lista ocupa a largura do campo e o campo de busca já vem com o foco;
 * - `acao` põe "＋ Novo …" no pé da lista, para criar sem sair da tela;
 * - lista grande desenha as primeiras 60 e diz quantas ficaram de fora (a busca aperta).
 *
 * Onde a lista é FIXA e curta (status, frequência, periodicidade, meses, UF) o `<select>` nativo
 * continua: busca ali não ajuda, e o nativo é melhor no celular.
 */
export function BuscaSelect({
  value, onChange, options, placeholder = "Selecione…", className, disabled,
  rotulo, acao, atributos, id, nome,
}: BuscaSelectProps) {
  const [aberto, setAberto] = useState(false);
  const [query, setQuery] = useState("");
  const [ativo, setAtivo] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const idLista = `busca-${reactId}`;

  const fechar = useCallback((devolverFoco = false) => {
    setAberto(false); setQuery(""); setAtivo(0);
    if (devolverFoco) botaoRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!aberto) return;
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) fechar(); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [aberto, fechar]);

  const selecionada = options.find((o) => o.value === value);
  const q = semAcento(query.trim());
  const filtradas = q ? options.filter((o) => semAcento(o.label).includes(q)) : options;
  const visiveis = filtradas.slice(0, TETO);
  const escondidas = filtradas.length - visiveis.length;

  // a opção em foco nunca fica fora da lista nem fora da janela rolável
  useEffect(() => { if (ativo >= visiveis.length) setAtivo(Math.max(0, visiveis.length - 1)); }, [ativo, visiveis.length]);
  useEffect(() => {
    if (!aberto) return;
    listaRef.current?.querySelector<HTMLElement>(`[data-opcao-ativa="true"]`)?.scrollIntoView({ block: "nearest" });
  }, [aberto, ativo]);

  const escolher = (v: string) => { onChange(v); fechar(true); };
  // Dentro de um FormField com erro: borda vermelha + aria-invalid + aria-describedby
  const campo = useCampo();

  function teclado(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!aberto) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setAberto(true); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(true); return; }
    if (e.key === "Tab") { fechar(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => Math.min(i + 1, visiveis.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Home") { e.preventDefault(); setAtivo(0); return; }
    if (e.key === "End") { e.preventDefault(); setAtivo(Math.max(0, visiveis.length - 1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const o = visiveis[ativo];
      if (o) escolher(o.value);
      else if (acao && !q) { fechar(); acao.onClick(); }
    }
  }

  return (
    <div className={cn("relative", className)} ref={ref} onKeyDown={teclado} {...atributos}>
      <button
        ref={botaoRef} type="button" id={id} name={nome} disabled={disabled}
        onClick={() => (aberto ? fechar() : setAberto(true))}
        role="combobox" aria-expanded={aberto} aria-haspopup="listbox"
        aria-controls={aberto ? idLista : undefined} aria-label={rotulo}
        aria-invalid={campo?.invalido || undefined} aria-describedby={campo?.descricaoId}
        data-busca-select
        className={cn(
          "w-full flex items-center justify-between gap-2 bg-white border rounded-lg px-3 py-2 text-sm text-left transition-all",
          campo?.invalido
            ? "border-atrasado focus:outline-none focus:border-atrasado focus:ring-4 focus:ring-atrasado/15"
            : "border-surface-campo focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10",
          disabled && "opacity-60 cursor-not-allowed bg-surface-alt",
        )}
      >
        <span className={cn("truncate", selecionada ? "text-ink" : "text-ink-subtle")} data-valor-escolhido={selecionada?.value}>
          {selecionada?.label ?? placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {value && !disabled && (
            <span role="button" tabIndex={-1} aria-label="Limpar" data-limpar-busca
              className="p-0.5 -m-0.5 rounded text-ink-subtle hover:text-ink"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}>
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={cn("w-4 h-4 text-ink-subtle transition-transform", aberto && "rotate-180")} />
        </span>
      </button>

      {aberto && !disabled && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-surface-border rounded-lg shadow-card-hover" data-lista-busca>
          <div className="p-2 border-b border-surface-border relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-subtle pointer-events-none" />
            <input
              autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setAtivo(0); }}
              placeholder="Pesquisar…" aria-label="Pesquisar na lista" data-campo-busca
              className="w-full bg-surface-alt rounded-md pl-8 pr-2 py-1.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto" role="listbox" id={idLista} aria-label={rotulo} ref={listaRef}>
            {/* Diz o que foi procurado: sem isso, "Nenhum resultado" não ajuda a corrigir o termo */}
            {visiveis.length === 0 && (
              <p className="px-3 py-3 text-xs text-ink-subtle italic" data-busca-vazia>
                Nenhum resultado{query.trim() ? ` para “${query.trim()}”` : ""}.
              </p>
            )}
            {visiveis.map((o, i) => (
              <button
                key={o.value} type="button" role="option" aria-selected={o.value === value}
                data-opcao={o.value} data-opcao-ativa={i === ativo} data-inativo={o.inativo || undefined}
                title={o.titulo ?? o.label}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(o.value)}
                {...o.atributos}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm border-b border-surface-border last:border-0 truncate",
                  i === ativo && "bg-primary-50",
                  o.value === value ? "text-primary-700 font-medium" : "text-ink",
                  o.inativo && "text-ink-muted",
                )}
              >
                {o.label}
              </button>
            ))}
            {escondidas > 0 && (
              <p className="px-3 py-2 text-xs text-ink-subtle" data-busca-teto>
                e mais {escondidas} — pesquise para afinar.
              </p>
            )}
          </div>
          {acao && (
            <button type="button" onClick={() => { fechar(); acao.onClick(); }} data-acao-busca
              className="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-acento border-t border-surface-border hover:bg-primary-50/50">
              <Plus className="w-3.5 h-3.5" /> {acao.rotulo}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
(BuscaSelect as unknown as { campoDeFormulario: boolean }).campoDeFormulario = true;
