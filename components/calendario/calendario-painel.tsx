"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn, LABELS_STATUS_OS, LABELS_PRIORIDADE } from "@/lib/utils";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { CalendarioGrid, type CelulaDia, type CardOs } from "@/components/calendario/calendario-grid";
import {
  CHAVES_FILTRO, FILTROS_VAZIOS, cardCasa, contarAtivos, gravarFiltrosNaUrl, lerFiltrosDaUrl,
  type FiltrosCalendario,
} from "@/lib/calendario/filtros";
import { SlidersHorizontal, Filter, X, ChevronDown, Check } from "lucide-react";

interface TecnicoOpc extends OpcaoBusca { avatar?: string | null }
/** A unidade sabe de que cliente é: o seletor só oferece as do cliente escolhido. */
interface UnidadeOpc extends OpcaoBusca { clienteId: string }
interface Opcoes { clientes: OpcaoBusca[]; tiposOs: OpcaoBusca[]; tecnicos: TecnicoOpc[]; unidades: UnidadeOpc[] }

const selectCls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

export function CalendarioPainel({
  celulas, eventosPorDia, opcoes, totalMes,
}: { celulas: CelulaDia[]; eventosPorDia: Record<string, CardOs[]>; opcoes: Opcoes; totalMes: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [filtros, setFiltros] = useState<FiltrosCalendario>(() => lerFiltrosDaUrl(sp, opcoes.unidades));
  const [mostrarMais, setMostrarMais] = useState(filtros.status.length > 0 || filtros.prioridade.length > 0);
  // No celular os filtros ficam recolhidos para a grade subir (no computador a faixa está sempre à vista).
  // Quem chega com filtro na URL já vê os campos abertos.
  const [aberto, setAberto] = useState(() => [...CHAVES_FILTRO, "unidade"].some((k) => (sp.get(k) ?? "") !== ""));
  const montou = useRef(false);

  function set<K extends keyof FiltrosCalendario>(chave: K, valor: FiltrosCalendario[K]) {
    setFiltros((f) => {
      const novo = { ...f, [chave]: valor };
      // Trocou de cliente: a unidade escolhida, se é de outro cliente, sai junto (senão o filtro
      // ficaria com um par impossível e a grade inteira esmaeceria sem explicação)
      if (chave === "clienteId" && novo.unidadeId) {
        const u = opcoes.unidades.find((x) => x.value === novo.unidadeId);
        if (novo.clienteId && u && u.clienteId !== novo.clienteId) novo.unidadeId = "";
      }
      return novo;
    });
  }

  // Sincroniza filtros na URL (debounce 300ms) — mantém mes/ano/view/dia
  useEffect(() => {
    if (!montou.current) { montou.current = true; return; }
    const t = setTimeout(() => {
      const p = gravarFiltrosNaUrl(new URLSearchParams(sp.toString()), filtros);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros]);

  const ativos = contarAtivos(filtros);
  const filtrando = ativos > 0;

  const { dimmedIds, exibidos } = useMemo(() => {
    // O predicado mora em lib/calendario/filtros.ts, com um teste por filtro e um da combinação
    const casa = (c: CardOs) => cardCasa(c, filtros);
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
    setFiltros(FILTROS_VAZIOS);
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
      <div className="px-3 py-2 sm:px-4 border-b border-surface-border bg-surface-alt/30" data-filtros-calendario data-filtros-ativos={ativos}>
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
            <CampoUnidade
              unidades={opcoes.unidades}
              clientes={opcoes.clientes}
              clienteId={filtros.clienteId}
              value={filtros.unidadeId}
              onChange={(v) => set("unidadeId", v)}
            />
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

/**
 * "Localização / unidade": SELETOR das unidades cadastradas (model Unidade), não mais texto solto.
 *
 * Antes era um campo de digitar que casava por trecho do nome — quem não lembrasse a grafia exata
 * não achava nada, e não havia como saber o que existe. Agora:
 *   • com um cliente escolhido, oferece as unidades DELE;
 *   • sem cliente, oferece todas, com o nome do cliente ao lado (duas empresas têm "Matriz");
 *   • cliente sem unidade cadastrada: o campo sai e fica a explicação no lugar.
 */
function CampoUnidade({
  unidades, clientes, clienteId, value, onChange,
}: {
  unidades: UnidadeOpc[]; clientes: OpcaoBusca[]; clienteId: string; value: string; onChange: (v: string) => void;
}) {
  const nomeDoCliente = (id: string) => clientes.find((c) => c.value === id)?.label ?? "";
  const lista = useMemo(() => {
    const doCliente = clienteId ? unidades.filter((u) => u.clienteId === clienteId) : unidades;
    return doCliente.map((u) => ({
      value: u.value,
      label: clienteId ? u.label : `${u.label} — ${nomeDoCliente(u.clienteId)}`,
      atributos: { "data-unidade-opcao": u.value },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidades, clienteId, clientes]);

  if (clienteId && lista.length === 0) {
    return (
      <p className="md:flex-1 md:min-w-[128px] text-xs text-ink-muted self-center" data-unidade-sem-cadastro>
        {nomeDoCliente(clienteId) || "Este cliente"} não tem unidade cadastrada.
      </p>
    );
  }

  return (
    <BuscaSelect
      className="md:flex-1 md:min-w-[128px]"
      rotulo="Localização ou unidade"
      value={value}
      onChange={onChange}
      options={lista}
      placeholder="Localização / unidade"
      atributos={{ "data-filtro-unidade": true }}
    />
  );
}
