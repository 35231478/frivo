"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn, LABELS_STATUS_OS, LABELS_PRIORIDADE } from "@/lib/utils";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { CalendarioGrid, type CelulaDia, type CardOs } from "@/components/calendario/calendario-grid";
import { SlidersHorizontal, Filter, X, ChevronDown, Check } from "lucide-react";

interface TecnicoOpc extends OpcaoBusca { avatar?: string | null }
interface Opcoes { clientes: OpcaoBusca[]; tiposOs: OpcaoBusca[]; tecnicos: TecnicoOpc[] }

interface Filtros {
  clienteId: string; tipos: string[]; numero: string; unidade: string;
  tecnicoId: string; status: string[]; prioridade: string[];
}

const selectCls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

export function CalendarioPainel({
  celulas, eventosPorDia, opcoes, totalMes,
}: { celulas: CelulaDia[]; eventosPorDia: Record<string, CardOs[]>; opcoes: Opcoes; totalMes: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [filtros, setFiltros] = useState<Filtros>(() => ({
    clienteId: sp.get("clienteId") ?? "",
    tipos: (sp.get("tipos") ?? "").split(",").filter(Boolean),
    numero: sp.get("numero") ?? "",
    unidade: sp.get("unidade") ?? "",
    tecnicoId: sp.get("tecnicoId") ?? "",
    status: (sp.get("status") ?? "").split(",").filter(Boolean),
    prioridade: (sp.get("prioridade") ?? "").split(",").filter(Boolean),
  }));
  const [mostrarMais, setMostrarMais] = useState(filtros.status.length > 0 || filtros.prioridade.length > 0);
  // No celular os filtros ficam recolhidos para a grade subir (no computador a faixa está sempre à vista).
  // Quem chega com filtro na URL já vê os campos abertos.
  const [aberto, setAberto] = useState(() => ["clienteId", "tipos", "numero", "unidade", "tecnicoId", "status", "prioridade"].some((k) => (sp.get(k) ?? "") !== ""));
  const montou = useRef(false);

  function set<K extends keyof Filtros>(chave: K, valor: Filtros[K]) {
    setFiltros((f) => ({ ...f, [chave]: valor }));
  }

  // Sincroniza filtros na URL (debounce 300ms) — mantém mes/ano/view/dia
  useEffect(() => {
    if (!montou.current) { montou.current = true; return; }
    const t = setTimeout(() => {
      const p = new URLSearchParams(sp.toString());
      const aplica = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
      aplica("clienteId", filtros.clienteId);
      aplica("tipos", filtros.tipos.join(","));
      aplica("numero", filtros.numero.trim());
      aplica("unidade", filtros.unidade.trim());
      aplica("tecnicoId", filtros.tecnicoId);
      aplica("status", filtros.status.join(","));
      aplica("prioridade", filtros.prioridade.join(","));
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros]);

  const ativos =
    (filtros.clienteId ? 1 : 0) + (filtros.tipos.length ? 1 : 0) + (filtros.numero.trim() ? 1 : 0) +
    (filtros.unidade.trim() ? 1 : 0) + (filtros.tecnicoId ? 1 : 0) + (filtros.status.length ? 1 : 0) +
    (filtros.prioridade.length ? 1 : 0);
  const filtrando = ativos > 0;

  const { dimmedIds, exibidos } = useMemo(() => {
    const numero = filtros.numero.trim().toLowerCase();
    const unidade = filtros.unidade.trim().toLowerCase();
    const casa = (c: CardOs) => {
      if (filtros.clienteId && c.clienteId !== filtros.clienteId) return false;
      if (filtros.tipos.length && !(c.tipoOsId && filtros.tipos.includes(c.tipoOsId))) return false;
      if (numero && !c.numero.toLowerCase().includes(numero)) return false;
      if (unidade && !(c.unidade ?? "").toLowerCase().includes(unidade)) return false;
      // Por técnico: o responsável OU qualquer membro da equipe da atividade
      if (filtros.tecnicoId && c.tecnicoId !== filtros.tecnicoId && !(c.tecnicoIds ?? []).includes(filtros.tecnicoId)) return false;
      if (filtros.status.length && !filtros.status.includes(c.status)) return false;
      if (filtros.prioridade.length && !filtros.prioridade.includes(c.prioridade)) return false;
      return true;
    };
    const inMonth = new Set(celulas.filter((c) => c.inMonth).map((c) => c.dateKey));
    const dim = new Set<string>();
    let x = 0;
    for (const [k, cards] of Object.entries(eventosPorDia)) {
      for (const card of cards) {
        const ok = casa(card);
        if (!ok && filtrando) dim.add(card.chave);
        if (ok && inMonth.has(k)) x++;
      }
    }
    return { dimmedIds: dim, exibidos: x };
  }, [eventosPorDia, celulas, filtros, filtrando]);

  function limpar() {
    setFiltros({ clienteId: "", tipos: [], numero: "", unidade: "", tecnicoId: "", status: [], prioridade: [] });
  }

  const statusOpts = Object.entries(LABELS_STATUS_OS).map(([value, label]) => ({ value, label }));
  const prioridadeOpts = Object.entries(LABELS_PRIORIDADE).map(([value, label]) => ({ value, label }));

  const resumo = (
    <span className="text-sm text-ink-muted whitespace-nowrap" data-resumo-calendario>
      {filtrando
        ? <><strong className="text-ink">{exibidos}</strong> de <strong className="text-ink">{totalMes}</strong> ordens de serviço</>
        : <><strong className="text-ink">{totalMes}</strong> {totalMes === 1 ? "ordem de serviço" : "ordens de serviço"}</>}
    </span>
  );

  return (
    <>
      {/* Faixa de filtros numa linha só: o campo vazio mostra o próprio nome (vazio = todos); no celular fica recolhida */}
      <div className="px-3 py-2 sm:px-4 border-b border-surface-border bg-surface-alt/30" data-filtros-calendario>
        <div className="flex flex-wrap items-center gap-2">
          {/* Resumo + abrir/fechar (o botão só existe no celular) */}
          {/* Sem filtro, o total cabe na ponta da linha dos campos; filtrando, o resumo (com "Limpar") desce inteiro */}
          <div className={cn("order-1 w-full flex items-center justify-between gap-2", ativos > 0 ? "md:order-3 md:justify-start" : "md:order-2 md:w-auto md:justify-end md:ml-auto")}>
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              {resumo}
              {ativos > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                  <Filter className="w-3 h-3" aria-hidden /> {ativos} {ativos === 1 ? "filtro ativo" : "filtros ativos"}
                </span>
              )}
              {ativos > 0 && (
                <button type="button" onClick={limpar} className="inline-flex items-center gap-1 text-xs font-medium text-atrasado hover:text-atrasado-texto whitespace-nowrap">
                  <X className="w-3.5 h-3.5" aria-hidden /> Limpar filtros
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              aria-expanded={aberto} aria-controls="filtros-calendario" data-abrir-filtros
              className={cn("md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors shrink-0",
                aberto ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-ink-muted")}
            >
              <Filter className="w-4 h-4" aria-hidden /> Filtros
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", aberto && "rotate-180")} aria-hidden />
            </button>
          </div>

          {/* Os campos: uma linha no computador; no celular aparecem ao tocar em "Filtros" */}
          <div
            id="filtros-calendario"
            className={cn("order-2 md:order-1 w-full md:w-auto md:flex-1 grid-cols-1 sm:grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center",
              aberto ? "grid" : "hidden")}
          >
            <BuscaSelect className="md:flex-1 md:min-w-[128px]" rotulo="Cliente" value={filtros.clienteId} onChange={(v) => set("clienteId", v)} options={opcoes.clientes} placeholder="Cliente" />
            <div className="md:flex-1 md:min-w-[128px]">
              <MultiSelect rotulo="Tipo de OS" options={opcoes.tiposOs} selected={filtros.tipos} onChange={(v) => set("tipos", v)} placeholder="Tipo de OS" />
            </div>
            <input aria-label="Número da OS" value={filtros.numero} onChange={(e) => set("numero", e.target.value)} placeholder="Número da OS" className={cn(selectCls, "md:flex-1 md:min-w-[112px] md:w-auto")} />
            <input aria-label="Localização ou unidade" value={filtros.unidade} onChange={(e) => set("unidade", e.target.value)} placeholder="Localização / unidade" className={cn(selectCls, "md:flex-1 md:min-w-[128px] md:w-auto")} />
            <div className="md:flex-1 md:min-w-[128px]">
              <SelectTecnico options={opcoes.tecnicos} value={filtros.tecnicoId} onChange={(v) => set("tecnicoId", v)} placeholder="Técnico" />
            </div>
            <button
              type="button"
              onClick={() => setMostrarMais((v) => !v)}
              aria-expanded={mostrarMais} data-mais-filtros
              className={cn("inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap",
                mostrarMais ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-ink-muted hover:bg-surface-alt")}
            >
              <SlidersHorizontal className="w-4 h-4" aria-hidden /> Mais filtros
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", mostrarMais && "rotate-180")} aria-hidden />
            </button>
          </div>
        </div>

        {mostrarMais && (
          <div className={cn("grid-cols-1 sm:grid-cols-2 gap-2 mt-2 anim-data md:grid md:max-w-xl", aberto ? "grid" : "hidden")} data-filtros-extras>
            <MultiSelect rotulo="Status" options={statusOpts} selected={filtros.status} onChange={(v) => set("status", v)} placeholder="Status" />
            <MultiSelect rotulo="Prioridade" options={prioridadeOpts} selected={filtros.prioridade} onChange={(v) => set("prioridade", v)} placeholder="Prioridade" />
          </div>
        )}
      </div>

      <CalendarioGrid celulas={celulas} eventosPorDia={eventosPorDia} opcoes={opcoes} dimmedIds={filtrando ? dimmedIds : undefined} />
    </>
  );
}

function useForaDoClique(aoFechar: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) aoFechar(); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [aoFechar]);
  return ref;
}

function MultiSelect({
  options, selected, onChange, placeholder, rotulo,
}: { options: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void; placeholder: string; rotulo: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useForaDoClique(() => setAberto(false));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const texto = selected.length === 0 ? placeholder
    : selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label ?? "1 selecionado")
    : `${selected.length} selecionados`;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setAberto((a) => !a)} aria-label={rotulo} aria-haspopup="listbox" aria-expanded={aberto} className={cn(selectCls, "flex items-center justify-between gap-2 text-left")}>
        <span className={cn("truncate", selected.length ? "text-ink" : "text-ink-subtle")}>{texto}</span>
        <ChevronDown className="w-4 h-4 text-ink-subtle shrink-0" />
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-surface-border rounded-lg shadow-lg max-h-56 overflow-y-auto py-1">
          {options.length === 0 && <p className="px-3 py-2 text-xs text-ink-subtle">Nenhuma opção</p>}
          {options.map((o) => {
            const marcado = selected.includes(o.value);
            return (
              <button key={o.value} type="button" onClick={() => toggle(o.value)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-alt text-left">
                <span className={cn("w-4 h-4 rounded flex items-center justify-center border shrink-0", marcado ? "bg-primary-500 border-primary-500 text-white" : "border-surface-border")}>
                  {marcado && <Check className="w-3 h-3" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SelectTecnico({
  options, value, onChange, placeholder,
}: { options: TecnicoOpc[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useForaDoClique(() => setAberto(false));
  const sel = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setAberto((a) => !a)} aria-label="Técnico" aria-haspopup="listbox" aria-expanded={aberto} className={cn(selectCls, "flex items-center justify-between gap-2 text-left")}>
        <span className="flex items-center gap-2 min-w-0">
          {sel && <AvatarTecnico nome={sel.label} fotoUrl={sel.avatar} size={20} />}
          <span className={cn("truncate", sel ? "text-ink" : "text-ink-subtle")}>{sel?.label ?? placeholder}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-ink-subtle shrink-0" />
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-surface-border rounded-lg shadow-lg max-h-56 overflow-y-auto py-1">
          <button type="button" onClick={() => { onChange(""); setAberto(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-alt text-left">
            Todos os técnicos
          </button>
          {options.map((o) => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setAberto(false); }}
              className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-alt text-left", o.value === value && "bg-primary-50")}>
              <AvatarTecnico nome={o.label} fotoUrl={o.avatar} size={22} />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
