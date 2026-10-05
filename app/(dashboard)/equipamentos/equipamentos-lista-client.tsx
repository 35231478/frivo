"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn, formatarData } from "@/lib/utils";
import {
  Plus, Search, LayoutGrid, Rows3, X, ChevronDown, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, Eye, Pencil, QrCode, Loader2, SlidersHorizontal,
  Building2, MapPin, ShieldAlert, ShieldX, CheckCircle2, CalendarCheck, Thermometer,
} from "lucide-react";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { EquipamentoAtivoBotao } from "@/components/equipamentos/equipamento-ativo-botao";
import { TipoBadge, TipoIcone } from "@/components/equipamentos/tipo-equipamento";
import { GarantiaSelo, StatusSelo } from "@/components/equipamentos/selos";
import type { FiltrosListagem, OrdemListagem } from "@/lib/equipamento-listagem";
import { TAMANHOS_PAGINA } from "@/lib/equipamento-listagem";

export type EquipLinha = {
  id: string;
  nome: string; temNome: boolean; marca: string; modelo: string;
  numeroSerie: string | null; patrimonio: string | null;
  tipo: string; tipoLabel: string; capacidade: string | null;
  setor: string | null; ambiente: string | null;
  garantiaAte: string | null; ativo: boolean; qrcodeId: string | null;
  foto: string | null;
  clienteId: string; cliente: string; unidadeId: string; unidade: string;
  ultimoAtendimento: string | null;
};

interface Props {
  itens: EquipLinha[];
  total: number;
  filtros: FiltrosListagem;
  opcoes: { clientes: OpcaoBusca[]; unidades: OpcaoBusca[]; setores: string[]; fluidos: string[]; tipos: OpcaoBusca[] };
  resumo: { ativos: number; vencendo: number; vencidas: number; semQr: number };
}

const CHAVE_FILTROS = "frivo:equipamentos:filtros";
const CHAVE_VISAO = "frivo:equipamentos:visao";
/** Parâmetros que não fazem parte do "filtro salvo". */
const NAO_PERSISTIR = ["pagina"];

function lerStorage(chave: string): string | null {
  try { return window.localStorage.getItem(chave); } catch { return null; }
}
function gravarStorage(chave: string, valor: string) {
  try { window.localStorage.setItem(chave, valor); } catch { /* modo privado etc. */ }
}

function haQuanto(iso: string | null) {
  if (!iso) return null;
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias < 30) return `há ${dias} d`;
  if (dias < 365) return `há ${Math.floor(dias / 30)} mês${Math.floor(dias / 30) > 1 ? "es" : ""}`;
  const anos = Math.floor(dias / 365);
  return `há ${anos} ano${anos > 1 ? "s" : ""}`;
}

/** "S/N … · TAG …" (o que houver). */
function identificadores(e: Pick<EquipLinha, "numeroSerie" | "patrimonio">) {
  return [e.numeroSerie && `S/N ${e.numeroSerie}`, e.patrimonio && `TAG ${e.patrimonio}`].filter(Boolean).join(" · ");
}

/** "Unidade · Setor · Ambiente" (o que houver). */
function localTexto(e: Pick<EquipLinha, "unidade" | "setor" | "ambiente">) {
  return [e.unidade, e.setor, e.ambiente].filter(Boolean).join(" · ");
}

export function EquipamentosListaClient({ itens, total, filtros: f, opcoes, resumo }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { pode } = usePermissoes();
  const podeCriar = pode("equipamentos", "criar");
  const podeEditar = pode("equipamentos", "editar");
  const [pendente, startTransition] = useTransition();

  const [visao, setVisao] = useState<"lista" | "cards">("lista");
  const [busca, setBusca] = useState(f.q);
  const [maisAberto, setMaisAberto] = useState(!!(f.qr || f.fluido));
  const [filtrosMobile, setFiltrosMobile] = useState(false);

  // Visão (lista/cards) é preferência pessoal
  useEffect(() => {
    const v = lerStorage(CHAVE_VISAO);
    if (v === "cards" || v === "lista") setVisao(v);
  }, []);
  function trocarVisao(v: "lista" | "cards") { setVisao(v); gravarStorage(CHAVE_VISAO, v); }

  // Filtros persistentes: ao abrir /equipamentos "limpo", restaura o último filtro usado
  const restaurou = useRef(false);
  const restaurando = useRef(false);
  useEffect(() => {
    if (restaurou.current) return;
    restaurou.current = true;
    if (sp.toString() === "") {
      const salvo = lerStorage(CHAVE_FILTROS);
      if (salvo) {
        restaurando.current = true;
        router.replace(`${pathname}?${salvo}`, { scroll: false });
      }
    }
  }, [sp, pathname, router]);
  useEffect(() => {
    // Enquanto restaura, não sobrescreve o filtro salvo com a URL ainda vazia
    if (restaurando.current) {
      if (sp.toString() === "") return;
      restaurando.current = false;
    }
    const p = new URLSearchParams(sp.toString());
    NAO_PERSISTIR.forEach((k) => p.delete(k));
    gravarStorage(CHAVE_FILTROS, p.toString());
  }, [sp]);

  /** Aplica mudanças na URL (fonte da verdade); por padrão volta para a página 1. */
  function navegar(mudancas: Record<string, string | null>, manterPagina = false) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === "") p.delete(k); else p.set(k, v);
    }
    if (!manterPagina) p.delete("pagina");
    const qs = p.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: !manterPagina ? false : true }));
  }

  // Busca com debounce (servidor)
  useEffect(() => {
    if (busca.trim() === f.q) return;
    const t = setTimeout(() => navegar({ q: busca.trim() || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);
  useEffect(() => { setBusca(f.q); }, [f.q]);

  function ordenar(k: OrdemListagem) {
    const dir = f.ordem === k ? (f.dir === "asc" ? "desc" : "asc") : (k === "ultimo" ? "desc" : "asc");
    navegar({ ordem: k === "nome" ? null : k, dir: dir === "asc" ? null : "desc" });
  }

  const filtrosAtivos = [f.q, f.cliente, f.unidade, f.setor, f.tipos.length, f.status !== "ativo", f.garantia, f.qr, f.fluido].filter(Boolean).length;
  function limpar() {
    setBusca("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  }

  const clienteSel = opcoes.clientes.find((c) => c.value === f.cliente);
  const unidadeSel = opcoes.unidades.find((u) => u.value === f.unidade);
  const inicio = total === 0 ? 0 : (f.pagina - 1) * f.porPagina + 1;
  const fim = Math.min(total, f.pagina * f.porPagina);
  const totalPaginas = Math.max(1, Math.ceil(total / f.porPagina));

  return (
    <div className="space-y-4">
      {/* ── Cabeçalho ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-2 bg-primary-50 rounded-lg hidden sm:block"><Thermometer className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Equipamentos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">
            {total.toLocaleString("pt-BR")}
          </span>
          {pendente && <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center bg-surface-alt border border-surface-border rounded-lg p-0.5">
            <button onClick={() => trocarVisao("lista")} title="Lista" className={cn("p-1.5 rounded-md transition-colors", visao === "lista" ? "bg-white text-primary-600 shadow-sm" : "text-ink-muted hover:text-ink")}>
              <Rows3 className="w-4 h-4" />
            </button>
            <button onClick={() => trocarVisao("cards")} title="Cards" className={cn("p-1.5 rounded-md transition-colors", visao === "cards" ? "bg-white text-primary-600 shadow-sm" : "text-ink-muted hover:text-ink")}>
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
          {podeCriar && (
            <Link href={`/equipamentos/novo${f.unidade ? `?unidadeId=${f.unidade}` : ""}`} className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Novo equipamento</span><span className="sm:hidden">Novo</span>
            </Link>
          )}
        </div>
      </div>

      {/* ── Resumo do parque (atalhos de filtro) ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <ChipResumo
          ativo={!f.garantia && !f.qr} onClick={() => navegar({ garantia: null, qr: null })}
          icone={CheckCircle2} cor="text-emerald-700" rotulo="Ativos" valor={resumo.ativos}
        />
        <ChipResumo
          ativo={f.garantia === "vencendo"} onClick={() => navegar({ garantia: f.garantia === "vencendo" ? null : "vencendo" })}
          icone={ShieldAlert} cor="text-amber-700" rotulo="Garantia vencendo" valor={resumo.vencendo}
        />
        <ChipResumo
          ativo={f.garantia === "vencida"} onClick={() => navegar({ garantia: f.garantia === "vencida" ? null : "vencida" })}
          icone={ShieldX} cor="text-red-600" rotulo="Garantia vencida" valor={resumo.vencidas}
        />
        <ChipResumo
          ativo={f.qr === "sem"} onClick={() => navegar({ qr: f.qr === "sem" ? null : "sem" })}
          icone={QrCode} cor="text-slate-600" rotulo="Sem QR" valor={resumo.semQr}
        />
      </div>

      {/* ── Busca + filtros ── */}
      <div className="bg-white border border-surface-border rounded-xl p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
            <input
              value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar nome, modelo, marca, nº série, TAG, cliente, setor…"
              className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-9 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
            />
            {busca && (
              <button onClick={() => setBusca("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink" title="Limpar busca">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-ink-subtle shrink-0 hidden sm:block" />
            <BuscaSelect
              className="flex-1 min-w-0"
              value={f.cliente}
              onChange={(v) => navegar({ cliente: v || null, unidade: null, setor: null })}
              options={opcoes.clientes}
              placeholder="Todos os clientes"
            />
          </div>
          <div className={cn("items-center gap-2", filtrosMobile ? "flex" : "hidden lg:flex")}>
            <MapPin className="w-4 h-4 text-ink-subtle shrink-0 hidden sm:block" />
            {f.cliente ? (
              <BuscaSelect
                className="flex-1 min-w-0"
                value={f.unidade}
                onChange={(v) => navegar({ unidade: v || null, setor: null })}
                options={opcoes.unidades}
                placeholder="Todas as unidades"
              />
            ) : (
              <div className="flex-1 bg-surface-alt border border-surface-border rounded-lg px-3 py-2 text-sm text-ink-subtle cursor-not-allowed" title="Escolha um cliente para filtrar por unidade">
                Escolha um cliente…
              </div>
            )}
          </div>
        </div>

        {/* Celular: filtros secundários ficam atrás de um botão */}
        <button
          onClick={() => setFiltrosMobile((v) => !v)}
          className="lg:hidden w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium text-primary-600 border border-surface-border rounded-lg py-2"
        >
          <SlidersHorizontal className="w-4 h-4" />
          {filtrosMobile ? "Ocultar filtros" : `Filtros${filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ""}`}
        </button>

        <div className={cn("flex-wrap items-center gap-2", filtrosMobile ? "flex" : "hidden lg:flex")}>
          <SelectFiltro
            valor={f.setor} onChange={(v) => navegar({ setor: v || null })}
            vazio="Setor: todos" opcoes={opcoes.setores.map((s) => ({ value: s, label: s }))}
          />
          <MultiSelect titulo="Tipo" opcoes={opcoes.tipos} selecionados={f.tipos} onChange={(v) => navegar({ tipos: v.join(",") || null })} />
          <SelectFiltro
            valor={f.status === "ativo" ? "" : f.status} onChange={(v) => navegar({ status: v || null })}
            vazio="Status: ativos" opcoes={[{ value: "inativo", label: "Status: inativos" }, { value: "todos", label: "Status: todos" }]}
          />
          <SelectFiltro
            valor={f.garantia} onChange={(v) => navegar({ garantia: v || null })}
            vazio="Garantia: todas"
            opcoes={[
              { value: "vigente", label: "Em garantia" }, { value: "vencendo", label: "Vencendo (≤30d)" },
              { value: "vencida", label: "Vencida" }, { value: "sem", label: "Sem garantia" },
            ]}
          />
          <button onClick={() => setMaisAberto((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 px-2 py-1.5">
            <SlidersHorizontal className="w-4 h-4" /> Mais
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", maisAberto && "rotate-180")} />
          </button>
          {maisAberto && (
            <>
              <SelectFiltro
                valor={f.qr} onChange={(v) => navegar({ qr: v || null })}
                vazio="QR: todos" opcoes={[{ value: "com", label: "Com QR" }, { value: "sem", label: "Sem QR" }]}
              />
              <SelectFiltro
                valor={f.fluido} onChange={(v) => navegar({ fluido: v || null })}
                vazio="Fluido: todos" opcoes={opcoes.fluidos.map((x) => ({ value: x, label: x }))}
              />
            </>
          )}
          {filtrosAtivos > 0 && (
            <button onClick={limpar} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-red-500">
              <X className="w-3.5 h-3.5" /> Limpar filtros ({filtrosAtivos})
            </button>
          )}
        </div>

        {/* Trilha do local filtrado */}
        {clienteSel && (
          <div className="flex items-center gap-1.5 text-xs text-ink-muted flex-wrap pt-2 border-t border-surface-border/70">
            <span className="text-ink-subtle">Local:</span>
            <button onClick={() => navegar({ unidade: null, setor: null })} className="font-medium text-ink hover:text-primary-600">{clienteSel.label}</button>
            {unidadeSel && (<><ChevronRight className="w-3 h-3" /><button onClick={() => navegar({ setor: null })} className="font-medium text-ink hover:text-primary-600">{unidadeSel.label}</button></>)}
            {f.setor && (<><ChevronRight className="w-3 h-3" /><span className="font-medium text-ink">{f.setor}</span></>)}
          </div>
        )}
      </div>

      {/* ── Resultados ── */}
      <div className={cn("transition-opacity", pendente && "opacity-60")}>
        {itens.length === 0 ? (
          <div className="bg-white border border-surface-border rounded-xl text-center py-16">
            <Thermometer className="w-10 h-10 text-ink-subtle mx-auto mb-3" />
            <p className="text-ink font-medium">Nenhum equipamento encontrado</p>
            <p className="text-sm text-ink-muted mt-1">
              {filtrosAtivos > 0 ? "Ajuste a busca ou os filtros." : "Cadastre o primeiro equipamento."}
            </p>
            {filtrosAtivos > 0 && <button onClick={limpar} className="mt-4 text-sm font-medium text-primary-600 hover:text-primary-700">Limpar filtros</button>}
          </div>
        ) : (
          <>
            {/* Celular: lista compacta (sempre) */}
            <div className="md:hidden bg-white border border-surface-border rounded-xl divide-y divide-surface-border overflow-hidden">
              {itens.map((e) => <LinhaMobile key={e.id} e={e} />)}
            </div>
            {/* Desktop: tabela densa (padrão) ou cards */}
            <div className="hidden md:block">
              {visao === "lista"
                ? <Tabela itens={itens} f={f} onOrdenar={ordenar} onFiltrar={navegar} podeEditar={podeEditar} />
                : <Cards itens={itens} />}
            </div>
          </>
        )}
      </div>

      {/* ── Paginação ── */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
          <p className="text-ink-muted">
            <span className="font-medium text-ink">{inicio.toLocaleString("pt-BR")}–{fim.toLocaleString("pt-BR")}</span> de {total.toLocaleString("pt-BR")}
          </p>
          <div className="flex items-center gap-2">
            <select
              value={f.porPagina} onChange={(e) => navegar({ por: e.target.value === "50" ? null : e.target.value })}
              className="bg-white border border-surface-border rounded-lg px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-primary-500"
              title="Itens por página"
            >
              {TAMANHOS_PAGINA.map((n) => <option key={n} value={n}>{n} / pág.</option>)}
            </select>
            <button
              disabled={f.pagina <= 1} onClick={() => navegar({ pagina: String(f.pagina - 1) }, true)}
              className="p-2 rounded-lg border border-surface-border bg-white text-ink-muted hover:text-primary-600 disabled:opacity-40 disabled:pointer-events-none" title="Anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-ink-muted tabular-nums">{f.pagina} / {totalPaginas}</span>
            <button
              disabled={f.pagina >= totalPaginas} onClick={() => navegar({ pagina: String(f.pagina + 1) }, true)}
              className="p-2 rounded-lg border border-surface-border bg-white text-ink-muted hover:text-primary-600 disabled:opacity-40 disabled:pointer-events-none" title="Próxima"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Tabela (desktop) ───────── */
function Tabela({
  itens, f, onOrdenar, onFiltrar, podeEditar,
}: {
  itens: EquipLinha[]; f: FiltrosListagem; onOrdenar: (k: OrdemListagem) => void;
  onFiltrar: (m: Record<string, string | null>) => void; podeEditar: boolean;
}) {
  const router = useRouter();
  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-alt text-ink-muted text-[11px] uppercase tracking-wide border-b border-surface-border">
          <tr>
            <ThOrd label="Equipamento" k="nome" f={f} onOrdenar={onOrdenar} className="pl-4" />
            <ThOrd label="Tipo · Capacidade" k="tipo" f={f} onOrdenar={onOrdenar} />
            <ThOrd label="Cliente › Local" k="cliente" f={f} onOrdenar={onOrdenar} />
            <ThOrd label="Garantia" k="garantia" f={f} onOrdenar={onOrdenar} />
            <th className="text-left px-3 py-2.5 font-semibold">Status</th>
            <ThOrd label="Últ. atend." k="ultimo" f={f} onOrdenar={onOrdenar} className="hidden lg:table-cell" />
            <th className="text-right pl-2 pr-3 py-2.5 font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border/70">
          {itens.map((e) => (
            <tr
              key={e.id} onClick={() => router.push(`/equipamentos/${e.id}`)}
              className={cn("cursor-pointer hover:bg-primary-50/40 transition-colors", !e.ativo && "opacity-60")}
            >
              <td className="pl-4 pr-3 py-2">
                <div className="flex items-center gap-3 min-w-[180px]">
                  <Miniatura e={e} />
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate max-w-[190px] 2xl:max-w-[280px]">{e.nome}</p>
                    <p className="text-xs text-ink-muted truncate max-w-[190px] 2xl:max-w-[280px]">
                      {e.temNome && <span>{e.modelo} · {e.marca}</span>}
                      {identificadores(e) && (
                        <span className="font-mono text-[11px] text-ink-subtle">{e.temNome ? " · " : ""}{identificadores(e)}</span>
                      )}
                      {!e.temNome && !identificadores(e) && "—"}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2">
                <TipoBadge tipo={e.tipo} label={e.tipoLabel} className="max-w-[130px] 2xl:max-w-none" />
                {e.capacidade && <p className="text-xs text-ink-muted mt-1 pl-1 whitespace-nowrap">{e.capacidade}</p>}
              </td>
              <td className="px-3 py-2 max-w-[200px] 2xl:max-w-[300px]" onClick={(ev) => ev.stopPropagation()}>
                <button onClick={() => onFiltrar({ cliente: e.clienteId, unidade: null, setor: null })} className="block text-ink font-medium truncate max-w-full hover:text-primary-600 text-left" title="Ver equipamentos deste cliente">
                  {e.cliente}
                </button>
                <button onClick={() => onFiltrar({ cliente: e.clienteId, unidade: e.unidadeId, setor: e.setor ?? null })} className="block text-xs text-ink-muted truncate max-w-full hover:text-primary-600 text-left" title="Ver equipamentos deste local">
                  {localTexto(e)}
                </button>
              </td>
              <td className="px-3 py-2"><GarantiaSelo fim={e.garantiaAte} compacto /></td>
              <td className="px-3 py-2"><StatusSelo ativo={e.ativo} /></td>
              <td className="px-3 py-2 hidden lg:table-cell whitespace-nowrap">
                {e.ultimoAtendimento ? (
                  <div className="leading-tight">
                    <p className="text-ink">{formatarData(e.ultimoAtendimento)}</p>
                    <p className="text-[11px] text-ink-subtle">{haQuanto(e.ultimoAtendimento)}</p>
                  </div>
                ) : <span className="text-ink-subtle">—</span>}
              </td>
              <td className="pl-2 pr-3 py-2" onClick={(ev) => ev.stopPropagation()}>
                <AcoesLinha e={e} podeEditar={podeEditar} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AcoesLinha({ e, podeEditar }: { e: EquipLinha; podeEditar: boolean }) {
  const btn = "p-1 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt";
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link href={`/equipamentos/${e.id}`} title="Ver ficha" className={btn}><Eye className="w-4 h-4" /></Link>
      {podeEditar && (
        <>
          <Link
            href={`/equipamentos/${e.id}/editar?aba=qrcode`}
            title={e.qrcodeId ? "QR Code vinculado" : "Gerar/vincular QR Code"}
            className={cn(btn, e.qrcodeId && "text-emerald-600")}
          >
            <QrCode className="w-4 h-4" />
          </Link>
          <Link href={`/equipamentos/${e.id}/editar`} title="Editar" className={btn}><Pencil className="w-4 h-4" /></Link>
        </>
      )}
      <EquipamentoAtivoBotao id={e.id} nome={e.nome} ativo={e.ativo} />
    </div>
  );
}

/* ───────── Celular ───────── */
function LinhaMobile({ e }: { e: EquipLinha }) {
  return (
    <Link href={`/equipamentos/${e.id}`} className={cn("flex items-start gap-3 p-3 active:bg-surface-alt", !e.ativo && "opacity-60")}>
      <Miniatura e={e} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-ink leading-tight truncate">{e.nome}</p>
          <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" />
        </div>
        <p className="text-xs text-ink-muted truncate mt-0.5">{e.cliente} › {localTexto(e)}</p>
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          <TipoBadge tipo={e.tipo} label={e.tipoLabel} />
          {e.garantiaAte && <GarantiaSelo fim={e.garantiaAte} compacto />}
          {!e.ativo && <StatusSelo ativo={false} />}
          {e.ultimoAtendimento && (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted"><CalendarCheck className="w-3 h-3" />{formatarData(e.ultimoAtendimento)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ───────── Cards (desktop, alternativo) ───────── */
function Cards({ itens }: { itens: EquipLinha[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
      {itens.map((e) => (
        <Link key={e.id} href={`/equipamentos/${e.id}`} className={cn("group bg-white border border-surface-border rounded-xl overflow-hidden hover:shadow-md hover:border-primary-300 transition-all", !e.ativo && "opacity-60")}>
          <div className="aspect-[16/9] bg-surface-alt overflow-hidden">
            {e.foto
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={e.foto} alt={e.nome} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              : <TipoIcone tipo={e.tipo} tamanho="xl" className="rounded-none" />}
          </div>
          <div className="p-3.5 space-y-2">
            <div>
              <h3 className="font-semibold text-ink leading-tight truncate group-hover:text-primary-600">{e.nome}</h3>
              <p className="text-xs text-ink-muted truncate">{e.modelo} · {e.marca}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <TipoBadge tipo={e.tipo} label={e.tipoLabel} />
              <GarantiaSelo fim={e.garantiaAte} compacto />
              <StatusSelo ativo={e.ativo} />
            </div>
            <p className="text-xs text-ink-muted truncate flex items-center gap-1.5 pt-2 border-t border-surface-border/70">
              <MapPin className="w-3.5 h-3.5 shrink-0" /> {e.cliente} › {localTexto(e)}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ───────── Peças ───────── */
function Miniatura({ e }: { e: EquipLinha }) {
  if (!e.foto) return <TipoIcone tipo={e.tipo} tamanho="md" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={e.foto} alt={e.nome} loading="lazy" className="w-10 h-10 rounded-lg object-cover border border-surface-border shrink-0 bg-surface-alt" />
  );
}

function ThOrd({ label, k, f, onOrdenar, className }: { label: string; k: OrdemListagem; f: FiltrosListagem; onOrdenar: (k: OrdemListagem) => void; className?: string }) {
  const ativo = f.ordem === k;
  return (
    <th className={cn("text-left px-3 py-2.5 font-semibold whitespace-nowrap", className)}>
      <button onClick={() => onOrdenar(k)} className={cn("inline-flex items-center gap-1 hover:text-ink transition-colors uppercase", ativo && "text-ink")}>
        {label}
        {ativo ? (f.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}

function ChipResumo({ ativo, onClick, icone: Icone, cor, rotulo, valor }: {
  ativo: boolean; onClick: () => void; icone: typeof CheckCircle2; cor: string; rotulo: string; valor: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
        ativo ? "bg-primary-50 border-primary-300" : "bg-white border-surface-border hover:border-primary-200",
      )}
    >
      <Icone className={cn("w-4 h-4", cor)} />
      <span className="font-semibold text-ink tabular-nums">{valor.toLocaleString("pt-BR")}</span>
      <span className="text-ink-muted">{rotulo}</span>
    </button>
  );
}

function SelectFiltro({ valor, onChange, vazio, opcoes }: { valor: string; onChange: (v: string) => void; vazio: string; opcoes: OpcaoBusca[] }) {
  return (
    <select
      value={valor} onChange={(e) => onChange(e.target.value)}
      className={cn(
        "bg-white border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary-500 max-w-[200px]",
        valor ? "border-primary-300 text-primary-700 bg-primary-50/50" : "border-surface-border text-ink",
      )}
    >
      <option value="">{vazio}</option>
      {opcoes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function MultiSelect({ titulo, opcoes, selecionados, onChange }: { titulo: string; opcoes: OpcaoBusca[]; selecionados: string[]; onChange: (v: string[]) => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  function toggle(id: string) {
    onChange(selecionados.includes(id) ? selecionados.filter((s) => s !== id) : [...selecionados, id]);
  }
  return (
    <div ref={ref} className="relative">
      <button
        type="button" onClick={() => setAberto((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 bg-white border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none",
          selecionados.length ? "border-primary-300 text-primary-700 bg-primary-50/50" : "border-surface-border text-ink",
        )}
      >
        {selecionados.length === 0 ? `${titulo}: todos` : `${titulo} (${selecionados.length})`}
        <ChevronDown className="w-3.5 h-3.5 text-ink-muted" />
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-64 bg-white border border-surface-border rounded-lg shadow-lg max-h-72 overflow-y-auto py-1">
          {opcoes.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-alt cursor-pointer text-sm">
              <input type="checkbox" checked={selecionados.includes(o.value)} onChange={() => toggle(o.value)} className="accent-primary-600" />
              <TipoIcone tipo={o.value} tamanho="sm" className="w-6 h-6" />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
