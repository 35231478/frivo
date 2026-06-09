"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Thermometer, Plus, Search, MapPin, Building2, LayoutGrid, List as ListIcon,
  SlidersHorizontal, X, ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown,
  Eye, Pencil, QrCode,
} from "lucide-react";

type Equip = {
  id: string;
  nome: string; marca: string; modelo: string; numeroSerie: string | null;
  tipo: string; tipoLabel: string;
  foto: string | null; ambiente: string | null; fluido: string | null;
  ativo: boolean; temQr: boolean; dataInstalacao: string | null;
  clienteId: string; cliente: string; unidadeId: string; unidade: string;
};

const BADGE_CORES = [
  "bg-sky-50 text-sky-700", "bg-emerald-50 text-emerald-700", "bg-violet-50 text-violet-700",
  "bg-amber-50 text-amber-700", "bg-rose-50 text-rose-700", "bg-indigo-50 text-indigo-700",
  "bg-teal-50 text-teal-700", "bg-orange-50 text-orange-700",
];
const ICONE_CORES = [
  "bg-sky-100 text-sky-600", "bg-emerald-100 text-emerald-600", "bg-violet-100 text-violet-600",
  "bg-amber-100 text-amber-600", "bg-rose-100 text-rose-600", "bg-indigo-100 text-indigo-600",
  "bg-teal-100 text-teal-600", "bg-orange-100 text-orange-600",
];
function hashIdx(s: string, n: number) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % n;
  return h;
}
function dataBR(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type SortKey = "nome" | "cliente" | "tipo" | "dataInstalacao";

export function EquipamentosListaClient({ equipamentos }: { equipamentos: Equip[] }) {
  const router = useRouter();
  const sp = useSearchParams();

  const [view, setView] = useState<"cards" | "lista">("cards");
  const [avancadoAberto, setAvancadoAberto] = useState(false);

  // Estado dos filtros (inicializado a partir da URL)
  const [busca, setBusca] = useState(sp.get("q") ?? "");
  const [clienteId, setClienteId] = useState(sp.get("cliente") ?? "");
  const [tipos, setTipos] = useState<string[]>((sp.get("tipos") ?? "").split(",").filter(Boolean));
  const [unidadeId, setUnidadeId] = useState(sp.get("unidade") ?? "");
  const [ambiente, setAmbiente] = useState(sp.get("ambiente") ?? "");
  const [fluidos, setFluidos] = useState<string[]>((sp.get("fluidos") ?? "").split(",").filter(Boolean));
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [qr, setQr] = useState(sp.get("qr") ?? "");
  const [sortKey, setSortKey] = useState<SortKey>((sp.get("sort") as SortKey) || "nome");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(sp.get("dir") === "desc" ? "desc" : "asc");

  // Preferência de visualização (localStorage)
  useEffect(() => {
    const v = localStorage.getItem("equip-view");
    if (v === "lista" || v === "cards") setView(v);
    if (sp.get("status") || sp.get("fluidos") || sp.get("unidade") || sp.get("ambiente") || sp.get("qr")) setAvancadoAberto(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function trocarView(v: "cards" | "lista") {
    setView(v);
    localStorage.setItem("equip-view", v);
  }

  // Sincroniza filtros com a URL (debounce 400ms)
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (busca) p.set("q", busca);
      if (clienteId) p.set("cliente", clienteId);
      if (tipos.length) p.set("tipos", tipos.join(","));
      if (unidadeId) p.set("unidade", unidadeId);
      if (ambiente) p.set("ambiente", ambiente);
      if (fluidos.length) p.set("fluidos", fluidos.join(","));
      if (status) p.set("status", status);
      if (qr) p.set("qr", qr);
      if (sortKey !== "nome") p.set("sort", sortKey);
      if (sortDir !== "asc") p.set("dir", sortDir);
      const qs = p.toString();
      router.replace(qs ? `/equipamentos?${qs}` : "/equipamentos", { scroll: false });
    }, 400);
    return () => clearTimeout(t);
  }, [busca, clienteId, tipos, unidadeId, ambiente, fluidos, status, qr, sortKey, sortDir, router]);

  // Opções de filtro derivadas da lista
  const clientes = useMemo(() => {
    const m = new Map<string, string>();
    equipamentos.forEach((e) => m.set(e.clienteId, e.cliente));
    return [...m.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [equipamentos]);
  const tiposOpc = useMemo(() => {
    const m = new Map<string, string>();
    equipamentos.forEach((e) => m.set(e.tipo, e.tipoLabel));
    return [...m.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [equipamentos]);
  const unidadesOpc = useMemo(() => {
    const m = new Map<string, { nome: string; clienteId: string }>();
    equipamentos.forEach((e) => m.set(e.unidadeId, { nome: e.unidade, clienteId: e.clienteId }));
    return [...m.entries()].map(([id, v]) => ({ id, ...v }))
      .filter((u) => !clienteId || u.clienteId === clienteId)
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [equipamentos, clienteId]);
  const fluidosOpc = useMemo(() => {
    const s = new Set<string>();
    equipamentos.forEach((e) => { if (e.fluido) s.add(e.fluido); });
    return [...s].sort().map((f) => ({ id: f, label: f }));
  }, [equipamentos]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const amb = ambiente.trim().toLowerCase();
    const arr = equipamentos.filter((e) => {
      if (clienteId && e.clienteId !== clienteId) return false;
      if (tipos.length && !tipos.includes(e.tipo)) return false;
      if (unidadeId && e.unidadeId !== unidadeId) return false;
      if (fluidos.length && (!e.fluido || !fluidos.includes(e.fluido))) return false;
      if (status === "ativo" && !e.ativo) return false;
      if (status === "inativo" && e.ativo) return false;
      if (qr === "com" && !e.temQr) return false;
      if (qr === "sem" && e.temQr) return false;
      if (amb && !(e.ambiente ?? "").toLowerCase().includes(amb)) return false;
      if (termo) {
        const alvo = `${e.nome} ${e.marca} ${e.modelo} ${e.numeroSerie ?? ""} ${e.ambiente ?? ""}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av: string | number = "", bv: string | number = "";
      if (sortKey === "nome") { av = a.nome.toLowerCase(); bv = b.nome.toLowerCase(); }
      else if (sortKey === "cliente") { av = a.cliente.toLowerCase(); bv = b.cliente.toLowerCase(); }
      else if (sortKey === "tipo") { av = a.tipoLabel.toLowerCase(); bv = b.tipoLabel.toLowerCase(); }
      else if (sortKey === "dataInstalacao") { av = a.dataInstalacao ?? ""; bv = b.dataInstalacao ?? ""; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [equipamentos, busca, clienteId, tipos, unidadeId, ambiente, fluidos, status, qr, sortKey, sortDir]);

  const filtrosAtivos = [clienteId, tipos.length, unidadeId, ambiente, fluidos.length, status, qr, busca].filter(Boolean).length;

  function limpar() {
    setBusca(""); setClienteId(""); setTipos([]); setUnidadeId(""); setAmbiente(""); setFluidos([]); setStatus(""); setQr("");
  }
  function ordenar(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><Thermometer className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Equipamentos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">
            Exibindo {filtrados.length} de {equipamentos.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-surface-alt border border-surface-border rounded-lg p-0.5">
            <button onClick={() => trocarView("cards")} title="Cards" className={cn("p-1.5 rounded-md transition-colors", view === "cards" ? "bg-white text-primary-600 shadow-sm" : "text-ink-muted hover:text-ink")}>
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button onClick={() => trocarView("lista")} title="Lista" className={cn("p-1.5 rounded-md transition-colors", view === "lista" ? "bg-white text-primary-600 shadow-sm" : "text-ink-muted hover:text-ink")}>
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
          <Link href="/equipamentos/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
            <Plus className="w-4 h-4" /> Novo Equipamento
          </Link>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-surface-border rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="relative md:col-span-5">
            <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, modelo, marca, série, ambiente…"
              className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10" />
          </div>
          <select value={clienteId} onChange={(e) => { setClienteId(e.target.value); setUnidadeId(""); }}
            className="md:col-span-4 bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
            <option value="">Todos os clientes</option>
            {clientes.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}
          </select>
          <div className="md:col-span-3">
            <MultiSelect titulo="Tipos" opcoes={tiposOpc} selecionados={tipos} onChange={setTipos} />
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <button onClick={() => setAvancadoAberto((v) => !v)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700">
            <SlidersHorizontal className="w-4 h-4" /> Filtros avançados
            {avancadoAberto ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {filtrosAtivos > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[11px] font-bold text-white bg-primary-500 rounded-full">{filtrosAtivos}</span>}
          </button>
          {filtrosAtivos > 0 && (
            <button onClick={limpar} className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-red-500">
              <X className="w-3.5 h-3.5" /> Limpar filtros
            </button>
          )}
        </div>

        {avancadoAberto && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-3 border-t border-gray-100">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Endereço/Unidade</label>
              <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}
                className="w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
                <option value="">Todos os endereços</option>
                {unidadesOpc.map((u) => (<option key={u.id} value={u.id}>{u.nome}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Ambiente</label>
              <input value={ambiente} onChange={(e) => setAmbiente(e.target.value)} placeholder="Ex: Recepção"
                className="w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Fluido refrigerante</label>
              <MultiSelect titulo="Fluidos" opcoes={fluidosOpc} selecionados={fluidos} onChange={setFluidos} compacto />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)}
                  className="w-full bg-white border border-surface-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-primary-500">
                  <option value="">Todos</option>
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">QR Code</label>
                <select value={qr} onChange={(e) => setQr(e.target.value)}
                  className="w-full bg-white border border-surface-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-primary-500">
                  <option value="">Todos</option>
                  <option value="com">Com QR</option>
                  <option value="sem">Sem QR</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Conteúdo */}
      {filtrados.length === 0 ? (
        <div className="text-center text-ink-subtle py-16 bg-white border border-surface-border rounded-xl">Nenhum equipamento encontrado</div>
      ) : view === "cards" ? (
        <CardsView itens={filtrados} />
      ) : (
        <ListaView itens={filtrados} sortKey={sortKey} sortDir={sortDir} onOrdenar={ordenar} />
      )}
    </div>
  );
}

/* ───────── Cards ───────── */
function CardsView({ itens }: { itens: Equip[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {itens.map((e) => (
        <Link key={e.id} href={`/equipamentos/${e.id}`} className="group bg-white border border-surface-border rounded-xl overflow-hidden hover:shadow-md hover:border-primary-300 transition-all">
          <div className="aspect-video bg-surface-alt flex items-center justify-center overflow-hidden">
            {e.foto ? <img src={e.foto} alt={e.nome} className="w-full h-full object-cover group-hover:scale-105 transition-transform" /> : <Thermometer className="w-10 h-10 text-ink-subtle" />}
          </div>
          <div className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-ink leading-tight group-hover:text-primary-600 transition-colors truncate">{e.nome}</h3>
              <StatusBadge ativo={e.ativo} />
            </div>
            <p className="text-xs text-ink-muted">{e.marca} · {e.modelo}{e.numeroSerie ? ` · N° ${e.numeroSerie}` : ""}</p>
            <TipoBadge tipo={e.tipo} label={e.tipoLabel} />
            <div className="pt-1 space-y-1 text-xs text-ink-muted border-t border-gray-100 mt-2">
              <p className="flex items-center gap-1.5 truncate"><Building2 className="w-3.5 h-3.5 shrink-0" /> {e.cliente}</p>
              <p className="flex items-center gap-1.5 truncate"><MapPin className="w-3.5 h-3.5 shrink-0" /> {e.unidade}{e.ambiente ? ` · ${e.ambiente}` : ""}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ───────── Lista ───────── */
function ListaView({ itens, sortKey, sortDir, onOrdenar }: { itens: Equip[]; sortKey: SortKey; sortDir: "asc" | "desc"; onOrdenar: (k: SortKey) => void }) {
  const router = useRouter();
  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-alt text-ink-muted text-xs uppercase tracking-wide">
          <tr>
            <th className="w-14 px-3 py-3"></th>
            <ThOrd label="Nome" k="nome" sortKey={sortKey} sortDir={sortDir} onOrdenar={onOrdenar} />
            <th className="text-left px-3 py-3 font-semibold hidden md:table-cell">Modelo / Marca</th>
            <ThOrd label="Tipo" k="tipo" sortKey={sortKey} sortDir={sortDir} onOrdenar={onOrdenar} />
            <ThOrd label="Cliente" k="cliente" sortKey={sortKey} sortDir={sortDir} onOrdenar={onOrdenar} className="hidden lg:table-cell" />
            <th className="text-left px-3 py-3 font-semibold hidden lg:table-cell">Endereço</th>
            <th className="text-left px-3 py-3 font-semibold hidden xl:table-cell">Ambiente</th>
            <th className="text-left px-3 py-3 font-semibold">Status</th>
            <th className="text-right px-3 py-3 font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {itens.map((e, idx) => (
            <tr key={e.id} onClick={() => router.push(`/equipamentos/${e.id}`)}
              className={cn("cursor-pointer hover:bg-primary-50/40 transition-colors", idx % 2 === 1 && "bg-surface-alt/30")}>
              <td className="px-3 py-2"><Miniatura equip={e} /></td>
              <td className="px-3 py-2 font-medium text-ink">{e.nome}</td>
              <td className="px-3 py-2 text-ink-muted hidden md:table-cell">{e.modelo}<span className="text-ink-subtle"> · {e.marca}</span></td>
              <td className="px-3 py-2"><TipoBadge tipo={e.tipo} label={e.tipoLabel} /></td>
              <td className="px-3 py-2 text-ink-muted hidden lg:table-cell truncate max-w-[180px]">{e.cliente}</td>
              <td className="px-3 py-2 text-ink-muted hidden lg:table-cell">{e.unidade}</td>
              <td className="px-3 py-2 text-ink-muted hidden xl:table-cell">{e.ambiente ?? "—"}</td>
              <td className="px-3 py-2"><StatusBadge ativo={e.ativo} /></td>
              <td className="px-3 py-2" onClick={(ev) => ev.stopPropagation()}>
                <div className="flex items-center justify-end gap-1">
                  <Link href={`/equipamentos/${e.id}`} title="Ver" className="p-1.5 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><Eye className="w-4 h-4" /></Link>
                  <Link href={`/equipamentos/${e.id}/editar`} title="Editar" className="p-1.5 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><Pencil className="w-4 h-4" /></Link>
                  <Link href={`/equipamentos/${e.id}/editar?aba=qrcode`} title="QR Code" className={cn("p-1.5 rounded-md hover:bg-surface-alt", e.temQr ? "text-emerald-600" : "text-ink-muted hover:text-primary-600")}><QrCode className="w-4 h-4" /></Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ThOrd({ label, k, sortKey, sortDir, onOrdenar, className }: { label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onOrdenar: (k: SortKey) => void; className?: string }) {
  const ativo = sortKey === k;
  return (
    <th className={cn("text-left px-3 py-3 font-semibold", className)}>
      <button onClick={() => onOrdenar(k)} className="inline-flex items-center gap-1 hover:text-ink transition-colors">
        {label}
        {ativo ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}

function Miniatura({ equip }: { equip: Equip }) {
  const idx = hashIdx(equip.tipo, ICONE_CORES.length);
  return (
    <div className="relative group/mini">
      {equip.foto ? (
        <img src={equip.foto} alt={equip.nome} className="w-12 h-12 rounded-lg object-cover border border-surface-border" />
      ) : (
        <div className={cn("w-12 h-12 rounded-lg flex items-center justify-center", ICONE_CORES[idx])}>
          <Thermometer className="w-5 h-5" />
        </div>
      )}
      {equip.foto && (
        <div className="hidden group-hover/mini:block absolute z-40 left-14 top-1/2 -translate-y-1/2 pointer-events-none">
          <img src={equip.foto} alt={equip.nome} className="w-[200px] h-[200px] object-cover rounded-lg border border-surface-border shadow-xl bg-white" />
        </div>
      )}
    </div>
  );
}

function TipoBadge({ tipo, label }: { tipo: string; label: string }) {
  const idx = hashIdx(tipo, BADGE_CORES.length);
  return <span className={cn("inline-flex text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap", BADGE_CORES[idx])}>{label}</span>;
}
function StatusBadge({ ativo }: { ativo: boolean }) {
  return <span className={cn("inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full", ativo ? "text-emerald-700 bg-emerald-50" : "text-gray-500 bg-gray-100")}>{ativo ? "Ativo" : "Inativo"}</span>;
}

/* ───────── MultiSelect ───────── */
function MultiSelect({ titulo, opcoes, selecionados, onChange, compacto }: { titulo: string; opcoes: { id: string; label: string }[]; selecionados: string[]; onChange: (v: string[]) => void; compacto?: boolean }) {
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
      <button type="button" onClick={() => setAberto((v) => !v)}
        className={cn("w-full flex items-center justify-between gap-2 bg-white border border-surface-border rounded-lg px-3 text-sm text-ink focus:outline-none focus:border-primary-500", compacto ? "py-2" : "py-2.5")}>
        <span className="truncate text-left">
          {selecionados.length === 0 ? <span className="text-ink-subtle">{titulo}</span> : `${titulo} (${selecionados.length})`}
        </span>
        <ChevronDown className="w-4 h-4 text-ink-muted shrink-0" />
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-surface-border rounded-lg shadow-lg max-h-60 overflow-y-auto py-1">
          {opcoes.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-subtle">Nenhuma opção.</p>
          ) : opcoes.map((o) => (
            <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-alt cursor-pointer text-sm">
              <input type="checkbox" checked={selecionados.includes(o.id)} onChange={() => toggle(o.id)} />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
