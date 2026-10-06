"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  AlertTriangle, Check, ChevronLeft, Crown, GripVertical, Loader2, Plus, Search, Truck, UserX, Users, X, Lock, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { InativarRegistro } from "@/components/ui/inativar-registro";

export interface ColabMontador { id: string; nome: string; funcao: string; ausente: string | null; foto: string | null }
export interface EquipeMontador {
  /** Identificador estável na tela (o id da equipe, ou "nova-N" para as criadas aqui). */
  chave: string; id?: string; nome: string; cor: string; liderId: string | null; membros: string[]; veiculos: string[];
}

const CORES = ["#0EA5E9", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#EC4899", "#06B6D4", "#6366F1"];
const POOL = "pool";

/** Assinatura da composição (para saber se há alterações não salvas). */
const assinatura = (eqs: EquipeMontador[]) => JSON.stringify(eqs.map((e) => [e.chave, e.nome.trim(), e.cor, e.liderId, [...e.membros].sort()]));

/**
 * Montador visual de equipes: pool de colaboradores à esquerda e as equipes como blocos.
 * - Arrastar do pool para uma equipe ADICIONA (a pessoa pode estar em mais de uma equipe);
 * - arrastar de uma equipe para outra MOVE; para o pool, TIRA da equipe;
 * - soltar na faixa "Líder" (ou clicar na 👑) define o líder.
 * No celular: segurar para arrastar, ou usar o botão "+" do colaborador.
 * Nada é gravado até "Salvar composição". Veículos não são alterados aqui.
 */
export function MontadorEquipes({ equipesIniciais, colaboradores, podeGerenciar }: {
  equipesIniciais: EquipeMontador[]; colaboradores: ColabMontador[]; podeGerenciar: boolean;
}) {
  const router = useRouter();
  const [base, setBase] = useState(equipesIniciais);
  const [equipes, setEquipes] = useState(equipesIniciais);
  const [busca, setBusca] = useState("");
  const [buscaEquipe, setBuscaEquipe] = useState("");
  const [soSemEquipe, setSoSemEquipe] = useState(false);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [adicionarDe, setAdicionarDe] = useState<string | null>(null);
  const [seq, setSeq] = useState(1);

  useEffect(() => { setBase(equipesIniciais); setEquipes(equipesIniciais); }, [equipesIniciais]);
  const porId = useMemo(() => new Map(colaboradores.map((c) => [c.id, c])), [colaboradores]);
  const alterado = assinatura(equipes) !== assinatura(base);

  // Aviso ao sair com alterações não salvas
  useEffect(() => {
    if (!alterado) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [alterado]);

  const equipesDe = useMemo(() => {
    const m = new Map<string, EquipeMontador[]>();
    for (const e of equipes) for (const id of e.membros) m.set(id, [...(m.get(id) ?? []), e]);
    return m;
  }, [equipes]);
  const semEquipe = colaboradores.filter((c) => !equipesDe.get(c.id)?.length);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }), // segurar para arrastar no celular
  );

  /* ───────── Operações sobre a composição ───────── */
  const mudar = (fn: (eqs: EquipeMontador[]) => EquipeMontador[]) => { setOk(""); setEquipes((eqs) => fn(eqs)); };
  function adicionar(chave: string, tecId: string, comoLider = false) {
    mudar((eqs) => eqs.map((e) => e.chave !== chave ? e : {
      ...e, membros: e.membros.includes(tecId) ? e.membros : [...e.membros, tecId], liderId: comoLider ? tecId : e.liderId,
    }));
  }
  function remover(chave: string, tecId: string) {
    mudar((eqs) => eqs.map((e) => e.chave !== chave ? e : { ...e, membros: e.membros.filter((m) => m !== tecId), liderId: e.liderId === tecId ? null : e.liderId }));
  }
  function mover(de: string, para: string, tecId: string, comoLider = false) {
    if (de === para) { if (comoLider) adicionar(para, tecId, true); return; }
    mudar((eqs) => eqs.map((e) => {
      if (e.chave === de) return { ...e, membros: e.membros.filter((m) => m !== tecId), liderId: e.liderId === tecId ? null : e.liderId };
      if (e.chave === para) return { ...e, membros: e.membros.includes(tecId) ? e.membros : [...e.membros, tecId], liderId: comoLider ? tecId : e.liderId };
      return e;
    }));
  }
  function novaEquipe() {
    const chave = `nova-${seq}`; setSeq((n) => n + 1);
    mudar((eqs) => [...eqs, { chave, nome: `Nova equipe ${seq}`, cor: CORES[(eqs.length) % CORES.length], liderId: null, membros: [], veiculos: [] }]);
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-nome-equipe="${chave}"]`)?.select(), 50);
  }

  function aoIniciar(e: DragStartEvent) { setArrastando(String(e.active.id)); }
  function aoSoltar(e: DragEndEvent) {
    setArrastando(null);
    const origem = String(e.active.id); const destino = e.over ? String(e.over.id) : null;
    if (!destino) return;
    // ids: "pool|<tec>" ou "eq|<chave>|<tec>"; destinos: "pool", "eq|<chave>", "lider|<chave>"
    const [tipoO, a, b] = origem.split("|");
    const tecId = tipoO === "pool" ? a : b; const de = tipoO === "eq" ? a : null;
    const [tipoD, para] = destino.split("|");
    if (tipoD === "pool") { if (de) remover(de, tecId); return; }
    const comoLider = tipoD === "lider";
    if (de) mover(de, para, tecId, comoLider); else adicionar(para, tecId, comoLider);
  }

  async function salvar() {
    setErro(""); setOk("");
    const semNome = equipes.find((e) => !e.nome.trim());
    if (semNome) { setErro("Toda equipe precisa de um nome."); return; }
    setSalvando(true);
    try {
      const res = await fetch("/api/equipes/montador", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipes: equipes.map((e) => ({ id: e.id, chave: e.chave, nome: e.nome.trim(), cor: e.cor, liderId: e.liderId, membroIds: e.membros })) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível salvar."); return; }
      const salvas = equipes.map((e) => (d.criadas?.[e.chave] ? { ...e, id: d.criadas[e.chave], chave: d.criadas[e.chave] } : e));
      setEquipes(salvas); setBase(salvas);
      setOk("Composição salva.");
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  const termo = busca.trim().toLowerCase();
  const pool = colaboradores.filter((c) => (!soSemEquipe || !equipesDe.get(c.id)?.length) && (!termo || `${c.nome} ${c.funcao}`.toLowerCase().includes(termo)));
  const arrastado = arrastando ? porId.get(arrastando.split("|").at(-1)!) : null;

  return (
    <div className="space-y-4 pb-24" data-montador>
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <Link href="/equipes" title="Voltar" className="mt-1 p-1.5 -ml-1 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><ChevronLeft className="w-5 h-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-ink tracking-tight">Montar equipes</h1>
            <p className="text-sm text-ink-muted mt-0.5">
              {podeGerenciar
                ? <>Arraste os colaboradores para dentro das equipes. Solte na faixa <Crown className="inline w-3.5 h-3.5 text-amber-500" /> para definir o líder.</>
                : <>Somente consulta — você não tem permissão para alterar equipes.</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm" data-resumo-montador>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-white px-3 py-2"><Users className="w-4 h-4 text-primary-600" /><b className="tabular-nums">{equipes.length}</b> equipes</span>
          <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-2", semEquipe.length ? "border-amber-200 bg-amber-50 text-amber-800" : "border-surface-border bg-white")} data-sem-equipe-total>
            <UserX className="w-4 h-4" /><b className="tabular-nums">{semEquipe.length}</b> sem equipe
          </span>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={aoIniciar} onDragEnd={aoSoltar} onDragCancel={() => setArrastando(null)}>
        <div className="grid gap-4 lg:grid-cols-[300px_1fr] items-start">
          {/* ── Pool ── */}
          <Pool>
            <div className="p-3 border-b border-surface-border space-y-2">
              <p className="text-sm font-semibold text-ink flex items-center gap-1.5"><Users className="w-4 h-4 text-ink-subtle" /> Colaboradores <span className="text-xs font-normal text-ink-muted">({colaboradores.length})</span></p>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar colaborador…" aria-label="Buscar colaborador no montador"
                  className="w-full bg-white border border-surface-border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
              </div>
              <label className="flex items-center gap-2 text-xs text-ink-muted select-none">
                <input type="checkbox" checked={soSemEquipe} onChange={(e) => setSoSemEquipe(e.target.checked)} className="accent-primary-600" aria-label="Só sem equipe" /> Só quem está sem equipe
              </label>
            </div>
            <ul className="p-2 space-y-1.5 max-h-[60vh] lg:max-h-[calc(100vh-280px)] overflow-y-auto" data-pool>
              {pool.length === 0 && <li className="text-xs text-ink-subtle text-center py-6">Ninguém aqui.</li>}
              {pool.map((c) => (
                <CartaoColab key={c.id} id={`pool|${c.id}`} c={c} desabilitado={!podeGerenciar}
                  equipes={equipesDe.get(c.id) ?? []}
                  onAdicionar={podeGerenciar ? () => setAdicionarDe(c.id) : undefined} />
              ))}
            </ul>
            {podeGerenciar && <p className="px-3 pb-3 text-[11px] text-ink-subtle">Solte aqui para tirar alguém de uma equipe.</p>}
          </Pool>

          {/* ── Equipes ── */}
          <div className="space-y-3 min-w-0">
          {equipes.length > 6 && (
            <div className="relative max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
              <input value={buscaEquipe} onChange={(ev) => setBuscaEquipe(ev.target.value)} placeholder="Buscar equipe…" aria-label="Buscar equipe"
                className="w-full bg-white border border-surface-border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3 items-start" data-equipes>
            {equipes.filter((e) => !buscaEquipe.trim() || !e.id || e.nome.toLowerCase().includes(buscaEquipe.trim().toLowerCase())).map((e) => (
              <CaixaEquipe key={e.chave} e={e} porId={porId} podeGerenciar={podeGerenciar}
                onNome={(nome) => mudar((eqs) => eqs.map((x) => (x.chave === e.chave ? { ...x, nome } : x)))}
                onCor={() => mudar((eqs) => eqs.map((x) => (x.chave === e.chave ? { ...x, cor: CORES[(CORES.indexOf(x.cor) + 1) % CORES.length] } : x)))}
                onLider={(id) => adicionar(e.chave, id, true)}
                onRemover={(id) => remover(e.chave, id)}
                onDescartarNova={() => mudar((eqs) => eqs.filter((x) => x.chave !== e.chave))}
                onInativada={() => { setEquipes((eqs) => eqs.filter((x) => x.chave !== e.chave)); setBase((eqs) => eqs.filter((x) => x.chave !== e.chave)); router.refresh(); }}
              />
            ))}
            {podeGerenciar && (
              <button type="button" onClick={novaEquipe} data-nova-equipe
                className="min-h-[180px] rounded-2xl border-2 border-dashed border-surface-border hover:border-primary-400 text-ink-muted hover:text-primary-600 flex flex-col items-center justify-center gap-1.5 transition-colors">
                <Plus className="w-6 h-6" /><span className="text-sm font-semibold">Nova equipe</span>
              </button>
            )}
          </div>
          </div>
        </div>

        <DragOverlay>
          {arrastado ? (
            <div className="flex items-center gap-2 rounded-lg border border-primary-300 bg-white px-2.5 py-1.5 shadow-lg text-sm">
              <AvatarTecnico nome={arrastado.nome} fotoUrl={arrastado.foto} size={24} /> {arrastado.nome}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Adicionar sem arrastar (celular / acessibilidade) */}
      {adicionarDe && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setAdicionarDe(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3" onClick={(ev) => ev.stopPropagation()} data-escolher-equipe>
            <p className="font-semibold text-ink">Adicionar {porId.get(adicionarDe)?.nome} em…</p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {equipes.map((e) => {
                const ja = e.membros.includes(adicionarDe);
                return (
                  <button key={e.chave} type="button" disabled={ja} onClick={() => { adicionar(e.chave, adicionarDe); setAdicionarDe(null); }}
                    className="w-full flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-sm text-left hover:border-primary-300 disabled:opacity-50">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: e.cor }} />{e.nome}{ja && <span className="ml-auto text-xs text-ink-subtle">já está</span>}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => setAdicionarDe(null)} className="w-full text-sm text-ink-muted py-1.5">Cancelar</button>
          </div>
        </div>
      )}

      {/* Barra de salvar */}
      {podeGerenciar && (
        <div className="fixed bottom-16 lg:bottom-4 inset-x-0 lg:left-auto lg:right-6 z-30 px-4 lg:px-0" data-barra-montador>
          <div className="mx-auto lg:mx-0 max-w-xl flex items-center gap-3 bg-white/95 backdrop-blur border border-surface-border rounded-xl shadow-lg px-4 py-3">
            <span className={cn("text-xs flex-1", erro ? "text-red-600" : ok ? "text-emerald-700" : alterado ? "text-amber-700" : "text-ink-muted")} data-status-montador>
              {erro ? <><AlertTriangle className="inline w-3.5 h-3.5" /> {erro}</> : ok ? <><Check className="inline w-3.5 h-3.5" /> {ok}</> : alterado ? "Há alterações não salvas." : "Nenhuma alteração."}
            </span>
            <button type="button" disabled={!alterado || salvando} onClick={() => { setEquipes(base); setErro(""); }}
              className="px-3 py-2 text-sm rounded-lg border border-surface-border text-ink hover:bg-surface-alt disabled:opacity-40">Descartar</button>
            <button type="button" disabled={!alterado || salvando} onClick={salvar}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-40">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar composição
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Peças ───────── */
function Pool({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: POOL });
  return (
    <section ref={setNodeRef} className={cn("bg-white border rounded-2xl lg:sticky lg:top-20 transition-colors", isOver ? "border-primary-400 bg-primary-50/40" : "border-surface-border")}>
      {children}
    </section>
  );
}

function CartaoColab({ id, c, equipes, desabilitado, onAdicionar }: {
  id: string; c: ColabMontador; equipes: EquipeMontador[]; desabilitado: boolean; onAdicionar?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: desabilitado });
  return (
    <li ref={setNodeRef} data-colab-pool={c.id} data-sem-equipe={!equipes.length || undefined}
      className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-white", isDragging && "opacity-40",
        !equipes.length ? "border-amber-200 bg-amber-50/40" : "border-surface-border")}>
      <span {...listeners} {...attributes} className={cn("flex items-center gap-2 min-w-0 flex-1 touch-none", !desabilitado && "cursor-grab active:cursor-grabbing")}>
        {!desabilitado && <GripVertical className="w-3.5 h-3.5 text-ink-subtle shrink-0" />}
        <AvatarTecnico nome={c.nome} fotoUrl={c.foto} size={28} />
        <span className="min-w-0">
          <span className="block text-sm text-ink truncate">{c.nome}</span>
          <span className="block text-[11px] text-ink-muted truncate">{c.funcao}{c.ausente ? ` · ${c.ausente}` : ""}</span>
        </span>
      </span>
      <span className="flex items-center gap-0.5 shrink-0">
        {equipes.length
          ? equipes.slice(0, 3).map((e) => <span key={e.chave} title={e.nome} className="w-2.5 h-2.5 rounded-full border border-white" style={{ backgroundColor: e.cor }} />)
          : <span className="text-[10px] font-semibold text-amber-700">sem equipe</span>}
      </span>
      {onAdicionar && (
        <button type="button" onClick={onAdicionar} title="Adicionar a uma equipe" aria-label={`Adicionar ${c.nome} a uma equipe`}
          className="p-1 rounded text-ink-subtle hover:text-primary-600 hover:bg-primary-50 shrink-0"><Plus className="w-4 h-4" /></button>
      )}
    </li>
  );
}

function CaixaEquipe({ e, porId, podeGerenciar, onNome, onCor, onLider, onRemover, onDescartarNova, onInativada }: {
  e: EquipeMontador; porId: Map<string, ColabMontador>; podeGerenciar: boolean;
  onNome: (n: string) => void; onCor: () => void; onLider: (id: string) => void; onRemover: (id: string) => void;
  onDescartarNova: () => void; onInativada: () => void;
}) {
  const caixa = useDroppable({ id: `eq|${e.chave}`, disabled: !podeGerenciar });
  const lider = useDroppable({ id: `lider|${e.chave}`, disabled: !podeGerenciar });
  const liderC = e.liderId ? porId.get(e.liderId) : null;
  const membros = e.membros.filter((m) => m !== e.liderId);
  return (
    <section ref={caixa.setNodeRef} data-equipe={e.chave} data-equipe-nome={e.nome}
      className={cn("bg-white border-2 rounded-2xl overflow-hidden transition-colors", caixa.isOver ? "border-primary-400 bg-primary-50/30" : "border-surface-border")}>
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-border" style={{ borderTop: `4px solid ${e.cor}` }}>
        <button type="button" onClick={onCor} disabled={!podeGerenciar} title="Trocar cor" className="w-4 h-4 rounded-full shrink-0 border border-white shadow" style={{ backgroundColor: e.cor }} />
        {podeGerenciar ? (
          <input value={e.nome} onChange={(ev) => onNome(ev.target.value)} data-nome-equipe={e.chave} aria-label={`Nome da equipe ${e.nome}`} maxLength={60}
            className="flex-1 min-w-0 font-semibold text-ink bg-transparent rounded px-1 -mx-1 focus:outline-none focus:bg-surface-alt" />
        ) : <h3 className="flex-1 min-w-0 font-semibold text-ink truncate">{e.nome}</h3>}
        <span className="text-xs text-ink-muted tabular-nums shrink-0" data-qtd-membros>{e.membros.length} {e.membros.length === 1 ? "pessoa" : "pessoas"}</span>
        {podeGerenciar && !e.id && (
          <button type="button" onClick={onDescartarNova} title="Descartar equipe nova" className="p-1 rounded text-ink-subtle hover:text-red-600"><X className="w-4 h-4" /></button>
        )}
        {podeGerenciar && e.id && <Pencil className="w-3.5 h-3.5 text-ink-subtle shrink-0" aria-hidden />}
        {e.id && <InativarRegistro url={`/api/equipes/${e.id}`} modulo="equipes" acaoReativar="gerenciar" ativo nome={e.nome} entidade="equipe" feminino aoConcluir={onInativada} />}
      </header>

      {/* Líder */}
      <div ref={lider.setNodeRef} data-lider-zona={e.chave}
        className={cn("mx-3 mt-3 rounded-lg border border-dashed px-2.5 py-2 flex items-center gap-2 transition-colors",
          lider.isOver ? "border-amber-400 bg-amber-50" : liderC ? "border-amber-200 bg-amber-50/50" : "border-surface-border")}>
        <Crown className="w-4 h-4 text-amber-500 shrink-0" />
        {liderC
          ? <ChipMembro chave={e.chave} c={liderC} lider podeGerenciar={podeGerenciar} onRemover={() => onRemover(liderC.id)} />
          : <span className="text-xs text-ink-subtle">{podeGerenciar ? "Solte aqui o líder" : "Sem líder"}</span>}
      </div>

      {/* Membros */}
      <div role="list" className="p-3 flex flex-wrap gap-1.5 min-h-[72px]" data-membros={e.chave}>
        {membros.length === 0 && !liderC && <p className="text-xs text-ink-subtle w-full text-center py-3">{podeGerenciar ? "Arraste colaboradores para cá" : "Sem membros"}</p>}
        {membros.map((id) => {
          const c = porId.get(id);
          return c ? <ChipMembro key={id} chave={e.chave} c={c} podeGerenciar={podeGerenciar} onLider={() => onLider(id)} onRemover={() => onRemover(id)} /> : null;
        })}
      </div>

      {e.veiculos.length > 0 && (
        <p className="px-3 pb-3 text-[11px] text-ink-muted flex items-center gap-1" data-veiculos-caixa title="Os veículos não mudam no montador">
          <Truck className="w-3.5 h-3.5" /> {e.veiculos.join(", ")} <Lock className="w-3 h-3 ml-0.5 text-ink-subtle" />
        </p>
      )}
    </section>
  );
}

function ChipMembro({ chave, c, lider, podeGerenciar, onLider, onRemover }: {
  chave: string; c: ColabMontador; lider?: boolean; podeGerenciar: boolean; onLider?: () => void; onRemover: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `eq|${chave}|${c.id}`, disabled: !podeGerenciar });
  return (
    <span ref={setNodeRef} role="listitem" data-membro={c.id} data-lider={lider || undefined}
      className={cn("inline-flex items-center gap-1.5 rounded-full border pl-0.5 pr-1 py-0.5 text-sm bg-white", isDragging && "opacity-40",
        lider ? "border-amber-300" : "border-surface-border")}>
      <span {...listeners} {...attributes} className={cn("inline-flex items-center gap-1.5 touch-none", podeGerenciar && "cursor-grab active:cursor-grabbing")}>
        <AvatarTecnico nome={c.nome} fotoUrl={c.foto} size={24} />
        <span className="max-w-[130px] truncate">{c.nome}</span>
        {c.ausente && <span className="text-[10px] text-sky-700">{c.ausente}</span>}
      </span>
      {podeGerenciar && !lider && onLider && (
        <button type="button" onClick={onLider} title="Tornar líder" aria-label={`Tornar ${c.nome} líder`} className="p-0.5 rounded text-ink-subtle hover:text-amber-600"><Crown className="w-3.5 h-3.5" /></button>
      )}
      {podeGerenciar && (
        <button type="button" onClick={onRemover} title="Tirar da equipe" aria-label={`Tirar ${c.nome} da equipe`} className="p-0.5 rounded text-ink-subtle hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
      )}
    </span>
  );
}
