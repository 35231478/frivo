"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { acento } from "@/lib/ui/tokens";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  MouseSensor, TouchSensor, useSensor, useSensors, pointerWithin,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { cn, iniciais, MESES_PT, LABELS_STATUS_OS, LABELS_PRIORIDADE } from "@/lib/utils";
import { ESTILO_CARTAO, ESTILO_GRUPO, LARGURA_BARRA, grupoDoCard, type GrupoStatus } from "@/lib/calendario/cores";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { InputHora } from "@/components/ui/input-hora";
import { MSG_HORA_INVALIDA, horaValida } from "@/components/ui/input-data-hora";
import { SeletorExecucao, VALOR_EXECUCAO_VAZIO, aplicarExecutor, corpoExecucao, temExecutor, useOpcoesExecucao, type ValorExecucao } from "@/components/os/seletor-execucao";
import { Sugestao, useSugestoesAbertura } from "@/components/os/sugestao-abertura";
import { SelectCadastroRapido } from "@/components/ui/select-cadastro-rapido";
import { CLIENTE, TIPO_OS } from "@/components/cadastro-rapido/definicoes";
import { MSG_SEM_EXECUTOR_TELA } from "@/lib/atividade-equipe";
import { type OpcaoBusca } from "@/components/ui/busca-select";
import { Repeat, MapPin, CalendarClock, Wrench, AlertTriangle, X, Plus, Check, Maximize2, Minimize2, GripHorizontal, Car, ListChecks } from "lucide-react";
import { deLocalBR } from "@/lib/fuso";
import { toast } from "@/components/ui/avisos";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { GavetaOsCalendario, diaDoCartao } from "@/components/calendario/gaveta-os";

export interface CardOs {
  /** Chave única do card (OS + dia): uma OS com visitas em dias diferentes gera um card por dia. */
  chave: string;
  id: string;
  numero: string;
  origem: string;
  atividadeId: string | null;
  clienteId: string;
  tecnicoId: string | null;
  tipoOsId: string | null;
  clienteCurto: string;
  clienteCompleto: string;
  /** A unidade/local da OS: o id é o que o filtro usa; o nome é o que o cartão mostra. */
  unidadeId: string | null;
  unidade: string | null;
  tipoOs: string | null;
  hora: string | null;
  dataFmt: string;
  tecnicoNome: string | null;
  tecnicoAvatar: string | null;
  /** Responsável + demais técnicos da atividade (para o filtro por técnico). */
  tecnicoIds?: string[];
  /** Demais técnicos (além do responsável) e a equipe usada, se houver. */
  membros?: { nome: string; avatar: string | null }[];
  equipeNome?: string | null;
  equipeCor?: string | null;
  /** Veículo desta atividade ("ABC1D23 — Strada"), se houver. */
  veiculo?: string | null;
  /** OS dividida em visitas diárias: "Visita 3 de 12" (a deste dia). */
  visita?: string | null;
  status: string;
  prioridade: string;
  atrasada: boolean;
  /** Alguma atividade da OS NESTE dia está "Em deslocamento" (técnico a caminho, ainda sem "Cheguei") */
  deslocamento?: boolean;
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
/** O cadastro do tipo de OS (o que o "editar no contexto" mostra), além do par value/label. */
type TipoOsCadastro = { id: string; nome: string; ativo?: boolean; descricao?: string | null; cor?: string | null };

const DIAS_SEMANA = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const DIAS_LONGO = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const FINALIZADAS = ["CONCLUIDA", "CANCELADA"];

// A cor é acento, não fundo (lib/calendario/cores.ts): cartão neutro, sem contorno, e uma barra fina
// à esquerda na cor do status. A prioridade alta/urgente é um ícone em tom neutro (o nome está no balão).
const PRIORIDADE_ALERTA = ["ALTA", "URGENTE", "CRITICO"];

const estilo = (c: CardOs) => ESTILO_GRUPO[grupoDoCard(c)];

/** A barra do status (o texto do status vai junto, só para o leitor de tela) */
function BarraStatus({ card }: { card: CardOs }) {
  return (
    <>
      <span className={cn(LARGURA_BARRA, "shrink-0 self-stretch", estilo(card).barra)} aria-hidden="true" data-barra-status />
      <span className="sr-only">{estilo(card).rotulo}:</span>
    </>
  );
}

/** Alerta de prioridade, só quando é alta ou urgente — em tom neutro */
function AlertaPrioridade({ card, grande }: { card: CardOs; grande?: boolean }) {
  if (!PRIORIDADE_ALERTA.includes(card.prioridade)) return null;
  return <AlertTriangle className={cn("shrink-0 text-ink-muted", grande ? "w-3.5 h-3.5" : "w-3 h-3")} aria-label={`Prioridade ${card.prioridade.toLowerCase()}`} data-alerta-prioridade />;
}
/** Os status presentes num dia, na ordem da legenda (para os pontos do dia no celular) */
const ORDEM_GRUPOS: GrupoStatus[] = ["atrasada", "deslocamento", "andamento", "aberta", "concluida", "neutra"];
const gruposDoDia = (cards: CardOs[]) => { const tem = new Set(cards.map(grupoDoCard)); return ORDEM_GRUPOS.filter((g) => tem.has(g)); };
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

/** Cards visíveis no dia recolhido (o resto vai para o "+N mais" — nada some). */
const MAX_CARDS_MES = 3;
const MAX_CARDS_SEMANA = 10;
/** Altura padrão do quadrado do dia (px) e limites da alça de redimensionar. */
const ALTURA_MES = 120;
const ALTURA_SEMANA = 360;
const ALTURA_MAX = 900;
/** Tamanho "expandido rápido": cabe tudo (com rolagem se passar de 70% da tela). */
const AUTO = -1;
const CHAVE_TAMANHOS = "frivo:calendario:tamanhos-dia";

function lerTamanhos(): Record<string, number> {
  try { return JSON.parse(window.localStorage.getItem(CHAVE_TAMANHOS) ?? "{}") ?? {}; } catch { return {}; }
}
function gravarTamanhos(t: Record<string, number>) {
  try { window.localStorage.setItem(CHAVE_TAMANHOS, JSON.stringify(t)); } catch { /* modo privado */ }
}


export function CalendarioGrid({
  celulas, eventosPorDia, opcoes, dimmedIds,
}: { celulas: CelulaDia[]; eventosPorDia: Record<string, CardOs[]>; opcoes: Opcoes; dimmedIds?: Set<string> }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  // Prioridade 1: quem não pode criar não vê "Nova OS neste dia"; quem não pode editar não arrasta
  const podeCriar = pode("ordens", "criar");
  const podeReagendar = pode("ordens", "editar");
  const [eventos, setEventos] = useState(eventosPorDia);
  const [hover, setHover] = useState<{ card: CardOs; rect: DOMRect } | null>(null);
  const [modalDia, setModalDia] = useState<string | null>(null);
  const [criarDia, setCriarDia] = useState<string | null>(null);
  // O cartão aberto na gaveta "Editar OS" (clique no cartão ou na lista do dia)
  const [gavetaCard, setGavetaCard] = useState<CardOs | null>(null);
  const [arrastando, setArrastando] = useState<{ card: CardOs; fromDay: string } | null>(null);
  const arrastouRef = useRef(false);
  const semanal = celulas.length === 7;
  // Tamanho escolhido por dia (expandir/arrastar), lembrado neste navegador
  const [tamanhos, setTamanhos] = useState<Record<string, number>>({});
  useEffect(() => { setTamanhos(lerTamanhos()); }, []);
  function definirTamanho(dateKey: string, valor: number | null) {
    setTamanhos((prev) => {
      const novo = { ...prev };
      if (valor === null) delete novo[dateKey]; else novo[dateKey] = valor;
      gravarTamanhos(novo);
      return novo;
    });
  }

  // Reconcilia com os dados do servidor após refresh
  useEffect(() => { setEventos(eventosPorDia); }, [eventosPorDia]);

  const sensorMouse = useSensor(MouseSensor, { activationConstraint: { distance: 6 } });
  const sensorToque = useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }); // long press no mobile
  // Sem "ordens › editar" o arrasto nem começa (o servidor também recusa: PATCH /api/ordens/:id → 403)
  const sensors = useSensors(...(podeReagendar ? [sensorMouse, sensorToque] : []));

  // Clicar no cartão abre a gaveta "Editar OS" por cima do calendário (a página inteira da OS fica
  // a um clique, no rodapé da gaveta). Até esta leva o clique navegava para /ordens/[id].
  function navegar(card: CardOs) {
    if (arrastouRef.current) return;
    setHover(null);
    setGavetaCard(card);
  }

  /** Move um cartão de dia (e hora) só na tela — o mesmo passo otimista do arrastar e da gaveta. */
  function moverNaTela(card: CardOs, fromDay: string, destino: string, hora?: string) {
    setEventos((prev) => {
      const origem = (prev[fromDay] ?? []).filter((c) => c.chave !== card.chave);
      const movido = { ...card, chave: `${card.id}:${destino}`, dataFmt: dataCurta(destino), hora: hora ?? card.hora };
      const alvo = [...(prev[destino] ?? []).filter((c) => c.chave !== movido.chave), movido].sort((a, b) => (a.hora ?? "99").localeCompare(b.hora ?? "99"));
      return { ...prev, [fromDay]: origem, [destino]: alvo };
    });
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
    if (!podeReagendar || !data || !destino || destino === data.fromDay) return;

    const { card, fromDay } = data;
    // Move otimista
    moverNaTela(card, fromDay, destino);

    try {
      const res = await fetch(`/api/ordens/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: destino, atividadeId: card.atividadeId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.erro ?? "Não foi possível reagendar a OS.");
      }
      toast(`OS ${card.numero} movida para ${dataCurta(destino)}.`);
      router.refresh();
    } catch (err: any) {
      // Reverte
      setEventos((prev) => {
        const alvo = (prev[destino] ?? []).filter((c) => c.chave !== `${card.id}:${destino}`);
        const origem = [...(prev[fromDay] ?? []), card].sort((a, b) => (a.hora ?? "99").localeCompare(b.hora ?? "99"));
        return { ...prev, [destino]: alvo, [fromDay]: origem };
      });
      toast(err.message ?? "Não foi possível reagendar a OS.", "erro");
    }
  }

  return (
    <div className="p-2 md:p-3" data-arrastando={arrastando ? "" : undefined}>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={aoIniciarArrasto} onDragEnd={aoTerminarArrasto}>
        {/* Sem overflow-hidden: o dia expandido cresce POR CIMA dos vizinhos sem mexer na grade */}
        <div className="grid grid-cols-7 gap-px bg-surface-border rounded-lg md:min-w-[680px]">
          {DIAS_SEMANA.map((d, i) => (
            <div key={d} className={cn("bg-surface-alt text-center py-2 text-[10px] md:text-xs font-semibold text-ink-muted uppercase tracking-wider", i === 0 && "rounded-tl-lg", i === 6 && "rounded-tr-lg")}>{d}</div>
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
              onCriar={podeCriar ? () => setCriarDia(cel.dateKey) : undefined}
              podeArrastar={podeReagendar}
              maxCards={semanal ? MAX_CARDS_SEMANA : MAX_CARDS_MES}
              alturaBase={semanal ? ALTURA_SEMANA : ALTURA_MES}
              tamanho={tamanhos[cel.dateKey] ?? null}
              onTamanho={(v) => definirTamanho(cel.dateKey, v)}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {arrastando ? <CardVisual card={arrastando.card} className="shadow-lg ring-1 ring-primary-300 cursor-grabbing" /> : null}
        </DragOverlay>
      </DndContext>

      {/* Tooltip flutuante (oculto durante o arrasto) */}
      {hover && !arrastando && <Tooltip card={hover.card} rect={hover.rect} />}

      {/* Modal "ver mais" do dia */}
      {modalDia && (
        <ModalDia
          dateKey={modalDia} eventos={eventos[modalDia] ?? []} dimmedIds={dimmedIds}
          onClose={() => setModalDia(null)}
          onNavegar={(c) => { setModalDia(null); setGavetaCard(c); }}
          onCriar={podeCriar ? () => { const d = modalDia; setModalDia(null); setCriarDia(d); } : undefined}
        />
      )}

      {/* A gaveta "Editar OS" do cartão clicado (a mesma da central da OS) */}
      {gavetaCard && (
        <GavetaOsCalendario
          card={gavetaCard}
          onFechar={() => setGavetaCard(null)}
          onReagendado={(v) => moverNaTela(gavetaCard, diaDoCartao(gavetaCard), v.data, v.hora)}
        />
      )}

      {/* Modal de criação rápida */}
      {criarDia && (
        <CriarOsModal
          dateKey={criarDia}
          opcoes={opcoes}
          onClose={() => setCriarDia(null)}
          onCriada={(numero) => { toast(`OS ${numero} criada em ${dataCurta(criarDia)}.`); router.refresh(); }}
        />
      )}

    </div>
  );
}

function Celula({
  cel, cards: cardsDia, dimmedIds, arrastando, arrastouRef, onNavegar, onHover, onSairHover, onVerMais, onCriar, podeArrastar,
  maxCards, alturaBase, tamanho, onTamanho,
}: {
  cel: CelulaDia; cards: CardOs[]; dimmedIds?: Set<string>; arrastando: { card: CardOs; fromDay: string } | null;
  arrastouRef: React.MutableRefObject<boolean>;
  onNavegar: (c: CardOs) => void; onHover: (c: CardOs, r: DOMRect) => void; onSairHover: () => void;
  onVerMais: () => void;
  /** Sem a permissão de criar OS, não vem: o dia não oferece "criar aqui". */
  onCriar?: () => void;
  /** Sem a permissão de editar OS, o cartão não é arrastável. */
  podeArrastar: boolean;
  maxCards: number; alturaBase: number; tamanho: number | null; onTamanho: (v: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cel.dateKey, disabled: !cel.inMonth });
  const conteudoRef = useRef<HTMLDivElement>(null);
  const [redimensionando, setRedimensionando] = useState<number | null>(null);
  // Altura do dia recolhido: ao expandir, o quadrado continua ocupando esse espaço na grade
  // (a linha da semana não encolhe nem cresce — só o painel sobreposto muda).
  const [alturaRecolhida, setAlturaRecolhida] = useState<number | null>(null);
  const recolhido = (redimensionando ?? tamanho) === null;
  useLayoutEffect(() => {
    if (!recolhido || !conteudoRef.current) return;
    const h = Math.round(conteudoRef.current.getBoundingClientRect().height);
    if (h > 0 && h !== alturaRecolhida) setAlturaRecolhida(h);
  });

  if (!cel.inMonth) {
    return <div className="min-h-[56px] md:min-h-[120px] bg-surface-page" />;
  }

  // As OS que batem com o filtro vêm primeiro (as esmaecidas não "roubam" as vagas visíveis)
  const cards = dimmedIds ? [...cardsDia].sort((x, y) => Number(dimmedIds.has(x.chave)) - Number(dimmedIds.has(y.chave))) : cardsDia;
  const alturaAtual = redimensionando ?? tamanho;
  const expandido = alturaAtual !== null;
  const visiveis = expandido ? cards : cards.slice(0, maxCards);
  const extra = cards.length - visiveis.length;
  const ehOrigem = arrastando?.fromDay === cel.dateKey;

  function aoClicarCelula() {
    if (arrastouRef.current) return;
    onCriar?.();
  }

  // Alça: arrasta a base do dia para esticar/encolher só este dia (sobreposto aos vizinhos)
  function iniciarRedimensionar(e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation();
    const inicioY = e.clientY;
    const inicioH = conteudoRef.current?.getBoundingClientRect().height ?? alturaBase;
    let ultimo = inicioH;
    const mover = (ev: PointerEvent) => {
      ultimo = Math.round(Math.min(ALTURA_MAX, Math.max(alturaBase, inicioH + ev.clientY - inicioY)));
      setRedimensionando(ultimo);
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      setRedimensionando(null);
      // Voltou ao tamanho padrão → esquece; senão lembra a altura
      onTamanho(ultimo <= alturaBase + 4 ? null : ultimo);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  // Recolhido: ocupa a altura padrão (alça na base). Expandido: sobreposto, nunca menor que o padrão.
  const estiloConteudo: React.CSSProperties = !expandido ? { minHeight: alturaBase }
    : alturaAtual === AUTO ? { minHeight: alturaBase, maxHeight: "70vh" }
    : { minHeight: alturaBase, height: alturaAtual! };

  return (
    <>
      {/* ── Celular: dia compacto; tocar abre a lista completa ── */}
      <button
        type="button"
        data-dia-mobile={cel.dateKey}
        onClick={onVerMais}
        className={cn("md:hidden bg-white min-h-[56px] p-1 flex flex-col items-center gap-1 text-left", cel.isToday && "bg-primary-50/50")}
      >
        <span
          className={cn("text-[11px] font-semibold w-5 h-5 flex items-center justify-center rounded-full", cel.isToday ? "bg-primary-500 text-white anim-hoje-pulso" : "text-ink")}
          {...(cel.isToday ? { "data-hoje": "", "aria-current": "date" as const } : {})}
        >
          {cel.dayNum}
        </span>
        {cards.length > 0 && (
          <>
            <span className="text-[10px] font-semibold px-1.5 rounded-full tabular-nums bg-surface-alt text-ink" data-contagem-dia>
              {cards.length}
            </span>
            {/* O que tem no dia, de relance: um ponto por status presente */}
            <span className="flex items-center gap-0.5" aria-hidden="true" data-pontos-dia>
              {gruposDoDia(cards).map((g) => <span key={g} className={cn("w-1.5 h-1.5 rounded-full", ESTILO_GRUPO[g].barra)} />)}
            </span>
          </>
        )}
      </button>

      {/* ── Desktop: quadrado do dia (a grade mantém a altura padrão; o expandido é sobreposto) ── */}
      <div
        ref={setNodeRef}
        data-dia={cel.dateKey}
        onClick={aoClicarCelula}
        style={{ minHeight: Math.max(alturaBase, alturaRecolhida ?? 0) }}
        className={cn(
          "hidden md:block group/cel relative bg-white align-top cursor-pointer",
          expandido && "z-30",
        )}
      >
        <div
          ref={conteudoRef}
          data-conteudo-dia={cel.dateKey}
          style={estiloConteudo}
          className={cn(
            "p-1.5 flex flex-col transition-colors",
            expandido
              ? "absolute inset-x-0 top-0 bg-white shadow-2xl ring-1 ring-primary-300 rounded-b-md"
              : "relative",
            isOver && "ring-2 ring-inset ring-primary-500 bg-primary-50/60",
            ehOrigem && !isOver && "outline-dashed outline-2 -outline-offset-2 outline-primary-400 bg-primary-50/20",
          )}
        >
          <div className="flex items-center justify-between gap-1 shrink-0">
            <div
              className={cn(
                "text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full",
                cel.isToday ? "bg-primary-500 text-white anim-hoje-pulso" : "text-ink",
              )}
              {...(cel.isToday ? { "data-hoje": "", "aria-current": "date" as const } : {})}
            >
              {cel.dayNum}
            </div>
            <div className="flex items-center">
              {(expandido || cards.length > maxCards) && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTamanho(expandido ? null : AUTO); }}
                  title={expandido ? "Recolher o dia" : `Expandir o dia (mostrar as ${cards.length} OS)`}
                  className={cn("p-0.5 rounded-md text-ink-muted hover:text-primary-600 hover:bg-primary-50", !expandido && "opacity-60 group-hover/cel:opacity-100")}
                >
                  {expandido ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              )}
              {onCriar && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onCriar(); }}
                  title="Criar OS neste dia" aria-label="Criar OS neste dia" data-criar-no-dia
                  className="opacity-0 group-hover/cel:opacity-100 transition-opacity p-0.5 rounded-md text-primary-600 hover:bg-primary-100"
                >
                  <Plus className="w-4 h-4" aria-hidden />
                </button>
              )}
            </div>
          </div>

          <div className={cn("space-y-1 mt-1 min-h-0", expandido && "flex-1 overflow-y-auto pr-0.5")}>
            {visiveis.map((card) => (
              <CardArrastavel key={card.chave} card={card} fromDay={cel.dateKey} dimmed={dimmedIds?.has(card.chave) ?? false} podeArrastar={podeArrastar} onNavegar={onNavegar} onHover={onHover} onSairHover={onSairHover} />
            ))}
          </div>

          {/* Rede de segurança: o que não coube fica SEMPRE indicado e a um clique */}
          {extra > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onVerMais(); }}
              className="mt-1 w-full text-left text-[11px] font-semibold text-primary-600 hover:text-primary-700 px-1.5 py-0.5 rounded hover:bg-primary-50 transition-colors shrink-0"
            >
              +{extra} mais
            </button>
          )}

          {/* Alça para esticar só este dia */}
          <div
            onPointerDown={iniciarRedimensionar}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => { e.stopPropagation(); onTamanho(null); }}
            title="Arraste para ajustar a altura deste dia (duplo clique volta ao padrão)"
            className={cn(
              "absolute left-0 right-0 bottom-0 h-2.5 flex items-center justify-center cursor-ns-resize touch-none",
              "opacity-0 group-hover/cel:opacity-100 transition-opacity",
              expandido && "opacity-100",
            )}
          >
            <GripHorizontal className="w-4 h-3 text-ink-subtle" />
          </div>
        </div>
      </div>
    </>
  );
}

function CardArrastavel({
  card, fromDay, dimmed, podeArrastar, onNavegar, onHover, onSairHover,
}: {
  card: CardOs; fromDay: string; dimmed: boolean;
  /** Sem "ordens › editar" o cartão só abre a OS: nem arrasta nem parece arrastável. */
  podeArrastar: boolean;
  onNavegar: (c: CardOs) => void; onHover: (c: CardOs, r: DOMRect) => void; onSairHover: () => void;
}) {
  // "travada" é a OS concluída (a barra verde e o aviso ao passar o mouse dizem isso). Falta de permissão não trava:
  // o cartão fica normal, só não arrasta.
  const travada = bloqueada(card);
  const semArrasto = travada || !podeArrastar;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.chave,
    data: { card, fromDay },
    disabled: semArrasto || dimmed,
  });

  // Fora do filtro: apenas contexto visual (esmaecido e não-interativo)
  if (dimmed) {
    return (
      <div className="opacity-30 pointer-events-none select-none">
        <CardVisual card={card} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...(semArrasto ? {} : listeners)}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onNavegar(card); }}
      onMouseEnter={(e) => onHover(card, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onSairHover}
      title={!podeArrastar ? undefined : travada ? "Não é possível reagendar OS concluída" : undefined}
      className={cn(
        !podeArrastar ? "cursor-pointer" : travada ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing touch-none",
        isDragging && "opacity-40",
      )}
    >
      <CardVisual card={card} />
    </div>
  );
}

function CardVisual({ card, className }: { card: CardOs; className?: string }) {
  return (
    <div className={cn("flex items-stretch rounded-md overflow-hidden transition-colors", ESTILO_CARTAO, className)} data-cartao-os={grupoDoCard(card)}>
      <BarraStatus card={card} />
      <div className="flex items-center gap-1.5 flex-1 min-w-0 pl-1.5 pr-1.5 py-1">
        <span className={cn("text-[11px] font-semibold tabular-nums shrink-0", estilo(card).hora)} data-hora-card>{card.hora ?? "--:--"}</span>
        <span className="text-[11px] text-ink truncate flex-1 min-w-0" data-cliente-card>{card.clienteCurto}</span>
        <AlertaPrioridade card={card} />
        {card.origem === "RECORRENTE" && <Repeat className="w-3 h-3 shrink-0 text-ink-muted" aria-label="OS recorrente" />}
        <SiglaTecnico card={card} />
      </div>
    </div>
  );
}

/** A sigla do responsável, discreta (cinza, pequena) — "+N" quando a atividade tem mais técnicos. Sem cor por técnico. */
function SiglaTecnico({ card }: { card: CardOs }) {
  const extra = card.membros?.length ?? 0;
  const nomes = [card.tecnicoNome, ...(card.membros ?? []).map((m) => m.nome)].filter(Boolean).join(", ");
  return (
    <span className="text-[9px] font-medium text-ink-muted tracking-wide shrink-0" data-sigla-tecnico title={nomes || "Sem técnico definido"}>
      {card.tecnicoNome ? iniciais(card.tecnicoNome) : "—"}{extra > 0 ? `+${extra}` : ""}
    </span>
  );
}

/** Avatar do responsável + "+N" quando a atividade tem mais técnicos (equipe). */
function AvataresCard({ card, size }: { card: CardOs; size: number }) {
  const extra = card.membros?.length ?? 0;
  return (
    <span className="flex items-center shrink-0" data-avatares-card title={[card.tecnicoNome, ...(card.membros ?? []).map((m) => m.nome)].filter(Boolean).join(", ")}>
      <AvatarTecnico nome={card.tecnicoNome} fotoUrl={card.tecnicoAvatar} size={size} />
      {extra > 0 && (
        <span className="-ml-1.5 rounded-full bg-primary-600 text-white font-semibold border border-white flex items-center justify-center"
          style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }}>+{extra}</span>
      )}
    </span>
  );
}

/** "Equipe Alfa" + responsável e membros (tooltip / lista do dia). */
function EquipeCard({ card }: { card: CardOs }) {
  const membros = card.membros ?? [];
  if (!card.equipeNome && !membros.length) {
    return (
      <div className="flex items-center gap-2 pt-1.5 border-t border-surface-border">
        <AvatarTecnico nome={card.tecnicoNome} fotoUrl={card.tecnicoAvatar} size={28} />
        <span className="text-xs font-medium text-ink">{card.tecnicoNome ?? "Sem técnico definido"}</span>
      </div>
    );
  }
  return (
    <div className="pt-1.5 border-t border-surface-border space-y-1.5" data-equipe-card>
      {card.equipeNome && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: card.equipeCor ?? acento.DEFAULT }} />Equipe {card.equipeNome}
        </p>
      )}
      <ul className="space-y-1">
        {card.tecnicoNome && (
          <li className="flex items-center gap-2 text-xs text-ink"><AvatarTecnico nome={card.tecnicoNome} fotoUrl={card.tecnicoAvatar} size={20} />{card.tecnicoNome}<span className="text-[10px] text-atencao-texto bg-atencao-claro px-1.5 rounded">responsável</span></li>
        )}
        {membros.map((m) => (
          <li key={m.nome} className="flex items-center gap-2 text-xs text-ink-muted"><AvatarTecnico nome={m.nome} fotoUrl={m.avatar} size={20} />{m.nome}</li>
        ))}
      </ul>
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
          <span className="flex items-center gap-1.5">
            {card.deslocamento && <span className="pill-deslocamento" data-selo-deslocamento>{ESTILO_GRUPO.deslocamento.rotulo}</span>}
            <span className={badgeStatus(card.status)}>{LABELS_STATUS_OS[card.status] ?? card.status}</span>
          </span>
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
          {card.visita && (
            <div className="flex items-center gap-1.5" data-visita><ListChecks className="w-3.5 h-3.5 shrink-0 text-ink-subtle" /><span>{card.visita}</span></div>
          )}
        </div>
        <EquipeCard card={card} />
        {card.veiculo && (
          <div className="flex items-center gap-1.5 text-xs text-ink-muted mt-1.5" data-veiculo-card><Car className="w-3.5 h-3.5 shrink-0 text-ink-subtle" />{card.veiculo}</div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={badgePrioridade(card.prioridade)}>{LABELS_PRIORIDADE[card.prioridade] ?? card.prioridade}</span>
          {card.atrasada && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-atrasado-claro text-atrasado-texto border border-atrasado/20 px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-3 h-3" /> Atrasada
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ModalDia({
  dateKey, eventos, dimmedIds, onClose, onNavegar, onCriar,
}: { dateKey: string; eventos: CardOs[]; dimmedIds?: Set<string>; onClose: () => void; onNavegar: (c: CardOs) => void; onCriar?: () => void }) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-card shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col anim-tooltip" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 p-4 border-b border-surface-border">
          <div>
            <h3 className="font-semibold text-ink capitalize">{diaPorExtenso(dateKey)}</h3>
            <p className="text-xs text-ink-muted">{eventos.length} {eventos.length === 1 ? "ordem de serviço" : "ordens de serviço"}</p>
          </div>
          <button type="button" title="Fechar" onClick={onClose} className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-alt"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto p-3 space-y-2">
          {eventos.length === 0 && <p className="text-sm text-ink-subtle text-center py-6">Nenhuma OS neste dia.</p>}
          {eventos.map((card) => (
            <button
              key={card.chave}
              type="button"
              onClick={() => onNavegar(card)}
              className={cn("w-full flex items-stretch rounded-lg overflow-hidden text-left transition-colors", ESTILO_CARTAO, dimmedIds?.has(card.chave) && "opacity-40")}
              data-cartao-os={grupoDoCard(card)}
            >
              <BarraStatus card={card} />
              <span className="flex items-center gap-2.5 flex-1 min-w-0 px-3 py-2.5">
                <span className={cn("text-xs font-semibold tabular-nums shrink-0 w-10", estilo(card).hora)}>{card.hora ?? "--:--"}</span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-ink truncate flex items-center gap-1.5">
                    <span className="truncate">{card.clienteCurto}</span>
                    <AlertaPrioridade card={card} grande />
                    {card.origem === "RECORRENTE" && <Repeat className="w-3 h-3 shrink-0 text-ink-muted" aria-label="OS recorrente" />}
                  </span>
                  <span className="block text-[11px] text-ink-muted truncate">
                    <span className="font-mono">{card.numero}</span>
                    {card.unidade ? ` · ${card.unidade}` : ""}
                    {card.atrasada ? " · Atrasada" : ""}
                    {card.equipeNome ? ` · Equipe ${card.equipeNome}` : ""}
                  </span>
                </span>
                <AvataresCard card={card} size={28} />
              </span>
            </button>
          ))}
        </div>
        {onCriar && (
          <div className="p-3 border-t border-surface-border">
            <button type="button" onClick={onCriar} data-criar-no-dia
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-primary-600 border border-dashed border-primary-300 hover:bg-primary-50">
              <Plus className="w-4 h-4" aria-hidden /> Nova OS neste dia
            </button>
          </div>
        )}
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
  // Cadastro inline e editar no contexto, como na abertura da OS: as opções já vêm prontas do
  // servidor, e o cadastro completo dos tipos chega depois (é o que o "editar no contexto" precisa).
  const [clientes, setClientes] = useState<OpcaoBusca[]>(opcoes.clientes);
  const [tipos, setTipos] = useState<TipoOsCadastro[]>([]);
  const tiposOpcoes = tipos.length ? tipos.filter((t) => t.ativo !== false).map((t) => ({ value: t.id, label: t.nome })) : opcoes.tiposOs;
  useEffect(() => {
    fetch("/api/tipos-os").then((r) => (r.ok ? r.json() : [])).then((d) => setTipos(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  // Quem executa (OBRIGATÓRIO): equipe ou colaboradores + veículo puxado automaticamente
  const opcoesExecucao = useOpcoesExecucao();
  const [execucao, setExecucao] = useState<ValorExecucao>(VALOR_EXECUCAO_VAZIO);
  const [faltaExecutor, setFaltaExecutor] = useState(false);
  const [hora, setHora] = useState("08:00");
  const [faltaHora, setFaltaHora] = useState(false);
  const [prioridade, setPrioridade] = useState("NORMAL");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Princípio 9: o histórico do cliente SUGERE o tipo e quem executa — a pessoa é que aplica
  const sugestoes = useSugestoesAbertura(clienteId);
  const execSugerido = sugestoes.executor ? aplicarExecutor(sugestoes.executor, opcoesExecucao, tipoOsId) : null;

  const inputCls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  async function criar(abrir: boolean) {
    setErro("");
    if (!clienteId) { setErro("Selecione o cliente."); return; }
    if (descricao.trim().length < 5) { setErro("Descreva o serviço (mínimo 5 caracteres)."); return; }
    if (!temExecutor(execucao)) { setFaltaExecutor(true); setErro(MSG_SEM_EXECUTOR_TELA); return; }
    // Hora vazia ou que não existe NÃO vira 08:00 escondido: a OS só é agendada com horário válido
    if (!horaValida(hora)) { setFaltaHora(true); setErro(MSG_HORA_INVALIDA); return; }
    setSalvando(true);
    try {
      // A hora escolhida é de Brasília (qualquer que seja o fuso do navegador)
      const dataAgendada = deLocalBR(`${dateKey}T${hora}`)!.toISOString();
      // OS + atividade agendada (com quem executa e o veículo) numa única chamada — tudo ou nada
      const titulo = tiposOpcoes.find((t) => t.value === tipoOsId)?.label ?? "Atendimento agendado";
      const resOs = await fetch("/api/ordens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId, descricao: descricao.trim(), prioridade, previsaoConclusao: dateKey, // previsão é o dia
          execucao: { titulo, tipoOsId: tipoOsId || null, dataAgendada, ...corpoExecucao(execucao) },
        }),
      });
      if (!resOs.ok) {
        const err = await resOs.json().catch(() => ({}));
        throw new Error(err.erro ?? "Erro ao criar OS.");
      }
      const os = await resOs.json();

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
      <div className="bg-white rounded-card shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col anim-tooltip" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 p-4 border-b border-surface-border">
          <div>
            <h3 className="font-semibold text-ink">Nova OS</h3>
            <p className="text-xs text-ink-muted capitalize">{diaPorExtenso(dateKey)}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-alt"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">{erro}</div>}

          <div>
            <label className="text-[11px] font-semibold text-ink-muted">Cliente *</label>
            <SelectCadastroRapido
              value={clienteId} onChange={setClienteId} opcoes={clientes}
              entidade={CLIENTE.entidade} placeholder="Pesquisar cliente…"
              campos={CLIENTE.campos} campoBusca="nome" permissao={CLIENTE.permissao}
              linkCadastroCompleto={CLIENTE.link} valoresIniciais={CLIENTE.valoresIniciais}
              criar={async (v) => {
                const c = await CLIENTE.criar(v);
                const o = CLIENTE.opcao(c);
                setClientes((l) => [...l, { value: o.value, label: o.label }]);
                return o;
              }}
              edicao={CLIENTE.edicao()}
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-ink-muted">Tipo de OS</label>
            <SelectCadastroRapido
              value={tipoOsId} onChange={setTipoOsId} opcoes={tiposOpcoes}
              entidade={TIPO_OS.entidade} placeholder="Selecionar tipo…"
              campos={TIPO_OS.campos} campoBusca="nome" permissao={TIPO_OS.permissao} linkCadastroCompleto={TIPO_OS.link}
              criar={async (v) => {
                const t = await TIPO_OS.criar(v);
                setTipos((l) => [...l, { id: t.id, nome: t.nome, ativo: true }]);
                return { value: t.id, label: t.nome };
              }}
              edicao={TIPO_OS.edicao(tipos, (t) => setTipos((l) => l.map((x) => (x.id === t.id ? { ...x, ...t } : x))))}
            />
            {sugestoes.tipoOs && (
              <Sugestao oQue="tipo" atributo="tipo" nome={sugestoes.tipoOs.nome} vezes={sugestoes.tipoOs.vezes}
                escondida={!!tipoOsId} onUsar={() => setTipoOsId(sugestoes.tipoOs!.id)} />
            )}
          </div>

          <div data-quem-executa>
            <label className="text-[11px] font-semibold text-ink-muted">Quem executa *</label>
            <SeletorExecucao opcoes={opcoesExecucao} tipoOsId={tipoOsId} valor={execucao}
              onChange={(v) => { setExecucao(v); if (temExecutor(v)) { setFaltaExecutor(false); setErro((e) => (e === MSG_SEM_EXECUTOR_TELA ? "" : e)); } }} erro={faltaExecutor} />
            {sugestoes.executor && execSugerido && (
              <Sugestao oQue="executor" atributo="executor" nome={sugestoes.executor.nome} vezes={sugestoes.executor.vezes}
                escondida={temExecutor(execucao)} onUsar={() => { setExecucao(execSugerido); setFaltaExecutor(false); setErro((e) => (e === MSG_SEM_EXECUTOR_TELA ? "" : e)); }} />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-ink-muted">Hora de agendamento *</label>
              <InputHora value={hora} invalido={faltaHora} aria-label="Hora de agendamento"
                onChange={(h) => { setHora(h); if (horaValida(h)) { setFaltaHora(false); setErro((e) => (e === MSG_HORA_INVALIDA ? "" : e)); } }} />
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
