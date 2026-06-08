"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  MouseSensor, TouchSensor, useSensor, useSensors, pointerWithin,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { cn, MESES_PT, LABELS_STATUS_OS, LABELS_PRIORIDADE } from "@/lib/utils";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { BuscaSelect, type OpcaoBusca } from "@/components/ui/busca-select";
import { Repeat, MapPin, CalendarClock, Wrench, AlertTriangle, X, Plus, Check, Lock } from "lucide-react";

export interface CardOs {
  id: string;
  numero: string;
  origem: string;
  atividadeId: string | null;
  clienteId: string;
  tecnicoId: string | null;
  tipoOsId: string | null;
  clienteCurto: string;
  clienteCompleto: string;
  unidade: string | null;
  tipoOs: string | null;
  hora: string | null;
  dataFmt: string;
  tecnicoNome: string | null;
  tecnicoAvatar: string | null;
  status: string;
  prioridade: string;
  atrasada: boolean;
}

export interface CelulaDia {
  dateKey: string;
  dayNum: number;
  inMonth: boolean;
  isToday: boolean;
  rowIndex: number;
}

interface TecnicoOpc extends OpcaoBusca { avatar?: string | null }
interface Opcoes { clientes: OpcaoBusca[]; tiposOs: OpcaoBusca[]; tecnicos: TecnicoOpc[] }

const DIAS_SEMANA = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const DIAS_LONGO = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const FINALIZADAS = ["CONCLUIDA", "CANCELADA"];

const PRIORIDADE_BG: Record<string, string> = {
  BAIXA: "bg-slate-100 hover:bg-slate-200",
  NORMAL: "bg-primary-50 hover:bg-primary-100",
  ALTA: "bg-orange-50 hover:bg-orange-100",
  URGENTE: "bg-red-50 hover:bg-red-100",
  CRITICO: "bg-red-100 hover:bg-red-200",
};
const STATUS_BORDA: Record<string, string> = {
  ABERTA: "border-l-blue-500",
  AGUARDANDO_ATENDIMENTO: "border-l-sky-400",
  AGENDADA: "border-l-blue-500",
  EM_ANDAMENTO: "border-l-amber-500",
  PAUSADA: "border-l-amber-400",
  AGUARDANDO_PECA: "border-l-orange-400",
  CONCLUIDA: "border-l-green-500",
  CANCELADA: "border-l-slate-400",
};

const corBorda = (c: CardOs) => (c.atrasada ? "border-l-red-500" : STATUS_BORDA[c.status] ?? "border-l-slate-300");
const corFundo = (c: CardOs) => PRIORIDADE_BG[c.prioridade] ?? PRIORIDADE_BG.NORMAL;
const badgeStatus = (s: string) => `badge-status-${s.toLowerCase()}`;
const badgePrioridade = (p: string) => `badge-prioridade-${p.toLowerCase()}`;
const bloqueada = (c: CardOs) => FINALIZADAS.includes(c.status);

function diaPorExtenso(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const data = new Date(y, m - 1, d);
  return `${DIAS_LONGO[data.getDay()]}, ${String(d).padStart(2, "0")} de ${MESES_PT[m - 1]} de ${y}`;
}
function dataCurta(dateKey: string) {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}

const MAX_CARDS = 3;

type ToastMsg = { id: number; texto: string; tipo: "ok" | "erro" };

export function CalendarioGrid({
  celulas, eventosPorDia, opcoes, dimmedIds,
}: { celulas: CelulaDia[]; eventosPorDia: Record<string, CardOs[]>; opcoes: Opcoes; dimmedIds?: Set<string> }) {
  const router = useRouter();
  const [eventos, setEventos] = useState(eventosPorDia);
  const [hover, setHover] = useState<{ card: CardOs; rect: DOMRect } | null>(null);
  const [modalDia, setModalDia] = useState<string | null>(null);
  const [criarDia, setCriarDia] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<{ card: CardOs; fromDay: string } | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const arrastouRef = useRef(false);
  const toastSeq = useRef(0);

  // Reconcilia com os dados do servidor após refresh
  useEffect(() => { setEventos(eventosPorDia); }, [eventosPorDia]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }), // long press no mobile
  );

  function toast(texto: string, tipo: "ok" | "erro" = "ok") {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, texto, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  function navegar(card: CardOs) {
    if (arrastouRef.current) return;
    router.push(`/ordens/${card.id}`);
  }

  function aoIniciarArrasto(e: DragStartEvent) {
    arrastouRef.current = true;
    setHover(null);
    const data = e.active.data.current as { card: CardOs; fromDay: string } | undefined;
    if (data) setArrastando(data);
  }

  async function aoTerminarArrasto(e: DragEndEvent) {
    setArrastando(null);
    setTimeout(() => { arrastouRef.current = false; }, 0);
    const data = e.active.data.current as { card: CardOs; fromDay: string } | undefined;
    const destino = e.over?.id ? String(e.over.id) : null;
    if (!data || !destino || destino === data.fromDay) return;

    const { card, fromDay } = data;
    // Move otimista
    setEventos((prev) => {
      const origem = (prev[fromDay] ?? []).filter((c) => c.id !== card.id);
      const movido = { ...card, dataFmt: dataCurta(destino) };
      const alvo = [...(prev[destino] ?? []), movido].sort((a, b) => (a.hora ?? "99").localeCompare(b.hora ?? "99"));
      return { ...prev, [fromDay]: origem, [destino]: alvo };
    });

    try {
      const res = await fetch(`/api/ordens/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: destino, atividadeId: card.atividadeId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.erro ?? "Falha ao reagendar.");
      }
      toast(`OS #${card.numero} movida para ${dataCurta(destino)}`);
      router.refresh();
    } catch (err: any) {
      // Reverte
      setEventos((prev) => {
        const alvo = (prev[destino] ?? []).filter((c) => c.id !== card.id);
        const origem = [...(prev[fromDay] ?? []), card].sort((a, b) => (a.hora ?? "99").localeCompare(b.hora ?? "99"));
        return { ...prev, [destino]: alvo, [fromDay]: origem };
      });
      toast(err.message ?? "Falha ao reagendar.", "erro");
    }
  }

  return (
    <div className="p-2 md:p-4">
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={aoIniciarArrasto} onDragEnd={aoTerminarArrasto}>
        <div className="grid grid-cols-7 gap-px bg-surface-border rounded-lg overflow-hidden min-w-[760px]">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="bg-surface-alt text-center py-2 text-xs font-semibold text-ink-muted uppercase tracking-wider">{d}</div>
          ))}

          {celulas.map((cel) => (
            <Celula
              key={cel.dateKey}
              cel={cel}
              cards={eventos[cel.dateKey] ?? []}
              dimmedIds={dimmedIds}
              arrastando={arrastando}
              arrastouRef={arrastouRef}
              onNavegar={navegar}
              onHover={(card, rect) => setHover({ card, rect })}
              onSairHover={() => setHover(null)}
              onVerMais={() => setModalDia(cel.dateKey)}
              onCriar={() => setCriarDia(cel.dateKey)}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {arrastando ? <CardVisual card={arrastando.card} className="shadow-2xl ring-2 ring-primary-400 cursor-grabbing rotate-1" /> : null}
        </DragOverlay>
      </DndContext>

      {/* Tooltip flutuante (oculto durante o arrasto) */}
      {hover && !arrastando && <Tooltip card={hover.card} rect={hover.rect} />}

      {/* Modal "ver mais" do dia */}
      {modalDia && (
        <ModalDia dateKey={modalDia} eventos={eventos[modalDia] ?? []} onClose={() => setModalDia(null)} onNavegar={(c) => { setModalDia(null); router.push(`/ordens/${c.id}`); }} />
      )}

      {/* Modal de criação rápida */}
      {criarDia && (
        <CriarOsModal
          dateKey={criarDia}
          opcoes={opcoes}
          onClose={() => setCriarDia(null)}
          onCriada={(numero) => { toast(`OS #${numero} criada em ${dataCurta(criarDia)}`); router.refresh(); }}
        />
      )}

      {/* Toasts (canto inferior direito) */}
      <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={cn(
            "anim-tooltip flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium text-white",
            t.tipo === "ok" ? "bg-ink" : "bg-red-600",
          )}>
            {t.tipo === "ok" ? <Check className="w-4 h-4 text-success-400" /> : <AlertTriangle className="w-4 h-4" />}
            {t.texto}
          </div>
        ))}
      </div>
    </div>
  );
}

function Celula({
  cel, cards, dimmedIds, arrastando, arrastouRef, onNavegar, onHover, onSairHover, onVerMais, onCriar,
}: {
  cel: CelulaDia; cards: CardOs[]; dimmedIds?: Set<string>; arrastando: { card: CardOs; fromDay: string } | null;
  arrastouRef: React.MutableRefObject<boolean>;
  onNavegar: (c: CardOs) => void; onHover: (c: CardOs, r: DOMRect) => void; onSairHover: () => void;
  onVerMais: () => void; onCriar: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cel.dateKey, disabled: !cel.inMonth });

  if (!cel.inMonth) {
    return <div className="min-h-[120px]" style={{ backgroundColor: "#F8FAFC" }} />;
  }

  const visiveis = cards.slice(0, MAX_CARDS);
  const extra = cards.length - visiveis.length;
  const ehOrigem = arrastando?.fromDay === cel.dateKey;

  function aoClicarCelula() {
    if (arrastouRef.current) return;
    onCriar();
  }

  return (
    <div
      ref={setNodeRef}
      onClick={aoClicarCelula}
      className={cn(
        "group/cel relative bg-white min-h-[120px] p-1.5 align-top transition-colors cursor-pointer",
        isOver && "ring-2 ring-inset ring-primary-500 bg-primary-50/60",
        ehOrigem && !isOver && "outline-dashed outline-2 -outline-offset-2 outline-primary-400 bg-primary-50/20",
      )}
    >
      <div className="flex items-center justify-between">
        <div className={cn(
          "text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full",
          cel.isToday ? "bg-primary-500 text-white shadow-sm" : "text-ink",
        )}>
          {cel.dayNum}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCriar(); }}
          title="Criar OS neste dia"
          className="opacity-0 group-hover/cel:opacity-100 transition-opacity p-0.5 rounded-md text-primary-600 hover:bg-primary-100"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1 mt-1">
        {visiveis.map((card) => (
          <CardArrastavel key={card.id} card={card} fromDay={cel.dateKey} dimmed={dimmedIds?.has(card.id) ?? false} onNavegar={onNavegar} onHover={onHover} onSairHover={onSairHover} />
        ))}

        {extra > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onVerMais(); }}
            className="w-full text-left text-[10px] font-semibold text-primary-600 hover:text-primary-700 px-1.5 py-0.5 rounded hover:bg-primary-50 transition-colors"
          >
            +{extra} mais
          </button>
        )}
      </div>
    </div>
  );
}

function CardArrastavel({
  card, fromDay, dimmed, onNavegar, onHover, onSairHover,
}: {
  card: CardOs; fromDay: string; dimmed: boolean;
  onNavegar: (c: CardOs) => void; onHover: (c: CardOs, r: DOMRect) => void; onSairHover: () => void;
}) {
  const travada = bloqueada(card);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { card, fromDay },
    disabled: travada || dimmed,
  });

  // Fora do filtro: apenas contexto visual (esmaecido e não-interativo)
  if (dimmed) {
    return (
      <div className="opacity-30 pointer-events-none select-none">
        <CardVisual card={card} travada={travada} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...(travada ? {} : listeners)}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onNavegar(card); }}
      onMouseEnter={(e) => onHover(card, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onSairHover}
      title={travada ? "Não é possível reagendar OS concluída" : undefined}
      className={cn(
        travada ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing touch-none",
        isDragging && "opacity-40",
      )}
    >
      <CardVisual card={card} travada={travada} />
    </div>
  );
}

function CardVisual({ card, travada, className }: { card: CardOs; travada?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 border-l-[3px] rounded px-1.5 py-1 transition-colors", corFundo(card), corBorda(card), className)}>
      <span className="text-[10px] font-semibold text-ink-muted tabular-nums shrink-0">{card.hora ?? "--:--"}</span>
      <span className="flex items-center gap-0.5 text-[11px] font-medium text-ink truncate flex-1 min-w-0">
        {travada && <Lock className="w-2.5 h-2.5 shrink-0 text-ink-subtle" />}
        {card.origem === "RECORRENTE" && <Repeat className="w-2.5 h-2.5 shrink-0 text-ink-subtle" />}
        <span className="truncate">{card.clienteCurto}</span>
      </span>
      <AvatarTecnico nome={card.tecnicoNome} fotoUrl={card.tecnicoAvatar} size={22} />
    </div>
  );
}

function Tooltip({ card, rect }: { card: CardOs; rect: DOMRect }) {
  const LARGURA = 264;
  const ALTURA_EST = 220;
  const abaixo = rect.bottom + ALTURA_EST + 12 < window.innerHeight;
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - LARGURA - 8);
  const estilo: React.CSSProperties = abaixo
    ? { position: "fixed", top: rect.bottom + 6, left, width: LARGURA }
    : { position: "fixed", top: rect.top - 6, left, width: LARGURA, transform: "translateY(-100%)" };

  return (
    <div style={estilo} className="z-50 pointer-events-none anim-tooltip">
      <div className="bg-white rounded-lg shadow-xl border border-surface-border p-4 space-y-2.5 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono font-bold text-primary-600 text-sm">OS #{card.numero}</span>
          <span className={badgeStatus(card.status)}>{LABELS_STATUS_OS[card.status] ?? card.status}</span>
        </div>
        <div className="text-sm font-semibold text-ink leading-snug">{card.clienteCompleto}</div>
        <div className="space-y-1.5 text-xs text-ink-muted">
          {card.unidade && (
            <div className="flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 mt-px shrink-0 text-ink-subtle" /><span>{card.unidade}</span></div>
          )}
          <div className="flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5 shrink-0 text-ink-subtle" /><span>{card.dataFmt}{card.hora ? ` às ${card.hora}` : ""}</span></div>
          {card.tipoOs && (
            <div className="flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5 shrink-0 text-ink-subtle" /><span>{card.tipoOs}</span></div>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1.5 border-t border-surface-border">
          <AvatarTecnico nome={card.tecnicoNome} fotoUrl={card.tecnicoAvatar} size={28} />
          <span className="text-xs font-medium text-ink">{card.tecnicoNome ?? "Sem técnico definido"}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={badgePrioridade(card.prioridade)}>{LABELS_PRIORIDADE[card.prioridade] ?? card.prioridade}</span>
          {card.atrasada && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-3 h-3" /> Atrasada
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ModalDia({
  dateKey, eventos, onClose, onNavegar,
}: { dateKey: string; eventos: CardOs[]; onClose: () => void; onNavegar: (c: CardOs) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col anim-tooltip" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 p-4 border-b border-surface-border">
          <div>
            <h3 className="font-semibold text-ink capitalize">{diaPorExtenso(dateKey)}</h3>
            <p className="text-xs text-ink-muted">{eventos.length} {eventos.length === 1 ? "ordem de serviço" : "ordens de serviço"}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-alt"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-3 space-y-2">
          {eventos.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => onNavegar(card)}
              className={cn("w-full flex items-center gap-2.5 border-l-4 rounded-lg px-3 py-2.5 text-left transition-colors", corFundo(card), corBorda(card))}
            >
              <span className="text-xs font-semibold text-ink-muted tabular-nums shrink-0 w-10">{card.hora ?? "--:--"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate flex items-center gap-1">
                  {card.origem === "RECORRENTE" && <Repeat className="w-3 h-3 shrink-0 text-ink-subtle" />}
                  {card.clienteCurto}
                </p>
                <p className="text-[11px] text-ink-muted truncate">
                  <span className="font-mono">{card.numero}</span>
                  {card.unidade ? ` · ${card.unidade}` : ""}
                  {card.atrasada ? " · Atrasada" : ""}
                </p>
              </div>
              <AvatarTecnico nome={card.tecnicoNome} fotoUrl={card.tecnicoAvatar} size={28} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const PRIORIDADES: { value: string; label: string }[] = [
  { value: "BAIXA", label: "Baixa" }, { value: "NORMAL", label: "Normal" },
  { value: "ALTA", label: "Alta" }, { value: "URGENTE", label: "Urgente" }, { value: "CRITICO", label: "Crítico" },
];

function CriarOsModal({
  dateKey, opcoes, onClose, onCriada,
}: { dateKey: string; opcoes: Opcoes; onClose: () => void; onCriada: (numero: string) => void }) {
  const router = useRouter();
  const [clienteId, setClienteId] = useState("");
  const [tipoOsId, setTipoOsId] = useState("");
  const [tecnicoId, setTecnicoId] = useState("");
  const [hora, setHora] = useState("08:00");
  const [prioridade, setPrioridade] = useState("NORMAL");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const tecnicoSel = opcoes.tecnicos.find((t) => t.value === tecnicoId);
  const inputCls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  async function criar(abrir: boolean) {
    setErro("");
    if (!clienteId) { setErro("Selecione o cliente."); return; }
    if (descricao.trim().length < 5) { setErro("Descreva o serviço (mínimo 5 caracteres)."); return; }
    setSalvando(true);
    try {
      const dataAgendada = `${dateKey}T${hora || "08:00"}:00`;
      const resOs = await fetch("/api/ordens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, descricao: descricao.trim(), prioridade, previsaoConclusao: dataAgendada }),
      });
      if (!resOs.ok) {
        const err = await resOs.json().catch(() => ({}));
        throw new Error(err.erro ?? "Erro ao criar OS.");
      }
      const os = await resOs.json();

      // Cria a atividade agendada (posiciona o card no dia e horário)
      const titulo = opcoes.tiposOs.find((t) => t.value === tipoOsId)?.label ?? "Atendimento agendado";
      await fetch(`/api/ordens/${os.id}/atividades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, tipoOsId: tipoOsId || undefined, tecnicoId: tecnicoId || undefined, dataAgendada, status: "AGENDADA" }),
      });

      if (abrir) { router.push(`/ordens/${os.id}`); return; }
      onCriada(os.numero);
      onClose();
    } catch (e: any) {
      setErro(e.message ?? "Erro ao criar OS.");
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col anim-tooltip" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 p-4 border-b border-surface-border">
          <div>
            <h3 className="font-semibold text-ink">Nova OS</h3>
            <p className="text-xs text-ink-muted capitalize">{diaPorExtenso(dateKey)}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-alt"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

          <div>
            <label className="text-[11px] font-semibold text-ink-muted">Cliente *</label>
            <BuscaSelect value={clienteId} onChange={setClienteId} options={opcoes.clientes} placeholder="Buscar cliente…" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-ink-muted">Tipo de OS</label>
              <BuscaSelect value={tipoOsId} onChange={setTipoOsId} options={opcoes.tiposOs} placeholder="Selecionar tipo…" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-muted">Técnico responsável</label>
              <div className="flex items-center gap-2">
                {tecnicoId && <AvatarTecnico nome={tecnicoSel?.label} fotoUrl={tecnicoSel?.avatar} size={28} />}
                <div className="flex-1 min-w-0"><BuscaSelect value={tecnicoId} onChange={setTecnicoId} options={opcoes.tecnicos} placeholder="Selecionar técnico…" /></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-ink-muted">Hora de agendamento</label>
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-muted">Prioridade</label>
              <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} className={inputCls}>
                {PRIORIDADES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-ink-muted">Descrição rápida *</label>
            <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} placeholder="O que precisa ser feito…" className={inputCls} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-surface-border">
          <button type="button" onClick={onClose} disabled={salvando} className="px-4 py-2 rounded-lg text-sm font-medium border border-surface-border text-ink hover:bg-surface-alt disabled:opacity-60">Cancelar</button>
          <button type="button" onClick={() => criar(true)} disabled={salvando} className="px-4 py-2 rounded-lg text-sm font-medium border border-primary-500 text-primary-600 hover:bg-primary-50 disabled:opacity-60">Criar e abrir</button>
          <button type="button" onClick={() => criar(false)} disabled={salvando} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary-500 text-white hover:bg-primary-600 shadow-sm disabled:opacity-60">
            {salvando ? "Criando…" : "Criar OS"}
          </button>
        </div>
      </div>
    </div>
  );
}
