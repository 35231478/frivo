"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronRight, Clock, HardDrive, MapPin, Navigation, Phone, RefreshCw, Sun } from "lucide-react";
import { cn, formatarData } from "@/lib/utils";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import type { CartaoTela, OperacaoFila } from "@/lib/tecnico/offline/tipos";
import { diaCivilDeChave, diasAteDiaCivil, horaBR } from "@/lib/fuso";

export const ROTULO_STATUS_ATIVIDADE: Record<string, { rotulo: string; classe: string }> = {
  AGENDADA: { rotulo: "Agendada", classe: "bg-violet-100 text-violet-700" },
  EM_ANDAMENTO: { rotulo: "Em andamento", classe: "bg-amber-100 text-amber-800" },
  CONCLUIDA: { rotulo: "Concluída", classe: "bg-success-100 text-success-700" },
  CANCELADA: { rotulo: "Cancelada", classe: "bg-red-100 text-red-700" },
};

/** Prioridades que merecem destaque no cartão */
const PRIORIDADE: Record<string, string> = { ALTA: "Prioridade alta", URGENTE: "Urgente", CRITICO: "Crítica" };

const horaBaixada = (ms: number | null) => (ms ? horaBR(ms) : null);

/** Situação que o técnico vê: a do servidor, ou a que ele já gravou no aparelho (iniciar/concluir ainda a enviar). */
export function situacaoLocal(c: CartaoTela, fila: OperacaoFila[]) {
  const minhas = fila.filter((o) => o.atividadeId === c.atividadeId && o.estado !== "enviada");
  const status = minhas.some((o) => o.tipo === "concluir") ? "CONCLUIDA" : minhas.some((o) => o.tipo === "iniciar") && c.status === "AGENDADA" ? "EM_ANDAMENTO" : c.status;
  return { status, aEnviar: minhas.length };
}

export function CartaoAtividade({ c, fila, mostrarDia }: { c: CartaoTela; fila: OperacaoFila[]; mostrarDia?: boolean }) {
  const { status, aEnviar } = situacaoLocal(c, fila);
  const st = ROTULO_STATUS_ATIVIDADE[status] ?? { rotulo: status, classe: "bg-slate-100 text-slate-700" };
  return (
    <article className="bg-white rounded-2xl border border-surface-border shadow-card overflow-hidden" data-cartao={c.atividadeId}>
      <button type="button" onClick={() => irPara({ ver: "os", a: c.atividadeId })} className="w-full text-left p-4 flex gap-3 active:bg-surface-alt">
        <div className="w-16 shrink-0 text-center">
          <div className="text-xl font-bold text-ink leading-tight" data-hora>{c.hora ?? "—"}</div>
          <div className="text-[11px] text-ink-muted">{c.hora ? (c.duracaoMin ? `${c.duracaoMin} min` : "") : "sem horário"}</div>
          {mostrarDia && c.dia && <div className="text-[11px] text-ink-muted mt-0.5">{c.dia.split("-").reverse().slice(0, 2).join("/")}</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-ink text-base leading-snug truncate">{c.cliente}</h3>
            <ChevronRight className="w-5 h-5 text-ink-subtle shrink-0" />
          </div>
          <p className="text-sm text-ink-muted truncate">
            {c.osNumero} · {c.titulo}{c.unidade ? ` · ${c.unidade}` : ""}
          </p>
          {c.endereco && <p className="text-sm text-ink mt-1 flex gap-1"><MapPin className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" /><span className="line-clamp-2">{c.endereco}</span></p>}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5", st.classe)} data-status={status}>{st.rotulo}</span>
            <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-slate-100 text-slate-700 inline-flex items-center gap-1" data-equipamentos={c.equipamentos}>
              <HardDrive className="w-3 h-3" /> {c.equipamentos === 1 ? "1 equipamento" : `${c.equipamentos} equipamentos`}
            </span>
            {PRIORIDADE[c.prioridade] && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-red-100 text-red-700">{PRIORIDADE[c.prioridade]}</span>}
            {aEnviar > 0 && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800">{aEnviar} a enviar</span>}
          </div>
        </div>
      </button>
      {(c.rota || c.telefone) && (
        <div className="flex border-t border-surface-border divide-x divide-surface-border">
          {c.rota && (
            <a href={c.rota} target="_blank" rel="noopener noreferrer" data-rota className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold text-primary-700 active:bg-primary-50 touch-target">
              <Navigation className="w-4 h-4" /> Rota no mapa
            </a>
          )}
          {c.telefone && (
            <a href={`tel:${c.telefone.replace(/[^\d+]/g, "")}`} className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold text-ink active:bg-surface-alt touch-target">
              <Phone className="w-4 h-4" /> Ligar
            </a>
          )}
        </div>
      )}
    </article>
  );
}

interface RespostaMeuDia { tecnico: { id: string; nome: string } | null; aviso?: string; dia: string | null; atividades: CartaoTela[]; anteriores: CartaoTela[] }
interface RespostaAgenda { tecnico: { id: string; nome: string } | null; aviso?: string; dias: { dia: string; atividades: CartaoTela[] }[] }

function useFila() {
  const { motor, estado } = useTecnico();
  const [fila, setFila] = useState<OperacaoFila[]>([]);
  useEffect(() => { motor?.banco.fila().then(setFila); }, [motor, estado.versao]);
  return fila;
}

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function AvisoAparelho({ baixadoEm, onAtualizar, atualizando }: { baixadoEm: number | null; onAtualizar: () => void; atualizando: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
      <span>{baixadoEm ? `Atualizado às ${horaBaixada(baixadoEm)}` : ""}</span>
      <button type="button" onClick={onAtualizar} disabled={atualizando} className="inline-flex items-center gap-1 font-semibold text-primary-700 px-2 py-1 touch-target">
        <RefreshCw className={cn("w-3.5 h-3.5", atualizando && "animate-spin")} /> Atualizar
      </button>
    </div>
  );
}

/** "Meu dia": as OS de hoje atribuídas a mim, em ordem de horário — abre sem sinal (fica no aparelho). */
export function MeuDia() {
  const { motor, usuario } = useTecnico();
  const fila = useFila();
  const [r, setR] = useState<{ dados: RespostaMeuDia | null; baixadoEm: number | null; doAparelho: boolean } | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async () => {
    if (!motor) return;
    setAtualizando(true);
    const x = await motor.baixarLista<RespostaMeuDia>("meuDia", "/api/tecnico/meu-dia");
    setR(x);
    setAtualizando(false);
    // Deixa cada OS do dia pronta para abrir sem sinal
    if (!x.doAparelho && x.dados) void motor.prepararSemSinal([...x.dados.atividades, ...x.dados.anteriores].map((c) => c.atividadeId));
  }, [motor]);
  useEffect(() => { void carregar(); }, [carregar]);

  const d = r?.dados;
  const primeiroNome = (d?.tecnico?.nome ?? usuario.nome).split(" ")[0];
  return (
    <div className="space-y-4" data-vista="dia">
      <header className="space-y-1">
        <p className="text-sm text-ink-muted inline-flex items-center gap-1.5"><Sun className="w-4 h-4" /> {formatarData(new Date(), "EEEE, d 'de' MMMM")}</p>
        <h1 className="text-2xl font-bold text-ink">{saudacao()}, {primeiroNome}</h1>
        {d && d.tecnico && <p className="text-sm text-ink-muted">{d.atividades.length === 0 ? "Nenhuma OS para hoje." : d.atividades.length === 1 ? "1 OS para hoje." : `${d.atividades.length} OS para hoje, na ordem do horário.`}</p>}
        <AvisoAparelho baixadoEm={r?.baixadoEm ?? null} onAtualizar={carregar} atualizando={atualizando} />
      </header>

      {!r && <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-32 rounded-2xl bg-white border border-surface-border animate-pulse" />)}</div>}
      {r && !d && <p className="rounded-xl bg-white border border-surface-border p-4 text-sm text-ink-muted">Sem sinal e nada guardado no aparelho ainda. Abra o app com internet uma vez para baixar o seu dia.</p>}
      {d?.aviso && <p className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900" data-aviso>{d.aviso}</p>}

      {d && d.anteriores.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wide">Começadas antes — falta concluir</h2>
          {d.anteriores.map((c) => <CartaoAtividade key={c.atividadeId} c={c} fila={fila} mostrarDia />)}
        </section>
      )}
      {d && d.atividades.length > 0 && (
        <section className="space-y-3">
          {d.anteriores.length > 0 && <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wide">Hoje</h2>}
          {d.atividades.map((c) => <CartaoAtividade key={c.atividadeId} c={c} fila={fila} />)}
        </section>
      )}
      {d && d.tecnico && !d.atividades.length && !d.anteriores.length && (
        <div className="rounded-2xl bg-white border border-surface-border p-6 text-center space-y-2">
          <Clock className="w-8 h-8 text-ink-subtle mx-auto" />
          <p className="font-semibold text-ink">Dia livre por enquanto</p>
          <p className="text-sm text-ink-muted">Quando o escritório agendar uma OS para você, ela aparece aqui.</p>
          <button type="button" onClick={() => irPara({ ver: "agenda" })} className="text-sm font-semibold text-primary-700 inline-flex items-center gap-1 pt-1"><CalendarDays className="w-4 h-4" /> Ver a agenda</button>
        </div>
      )}
    </div>
  );
}

const nomeDia = (dia: string) => {
  // `dia` é a chave "AAAA-MM-DD" do dia em Brasília; "hoje" também é o de Brasília
  const dif = diasAteDiaCivil(diaCivilDeChave(dia)) ?? 0;
  const base = formatarData(diaCivilDeChave(dia), "EEEE, d 'de' MMM");
  return dif === 0 ? `Hoje · ${base}` : dif === 1 ? `Amanhã · ${base}` : base;
};

/** Agenda: hoje e os próximos 14 dias. */
export function Agenda() {
  const { motor } = useTecnico();
  const fila = useFila();
  const [r, setR] = useState<{ dados: RespostaAgenda | null; baixadoEm: number | null } | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const carregar = useCallback(async () => {
    if (!motor) return;
    setAtualizando(true);
    setR(await motor.baixarLista<RespostaAgenda>("agenda", "/api/tecnico/agenda?dias=14"));
    setAtualizando(false);
  }, [motor]);
  useEffect(() => { void carregar(); }, [carregar]);
  const d = r?.dados;
  return (
    <div className="space-y-4" data-vista="agenda">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">Agenda</h1>
        <p className="text-sm text-ink-muted">Hoje e os próximos 14 dias.</p>
        <AvisoAparelho baixadoEm={r?.baixadoEm ?? null} onAtualizar={carregar} atualizando={atualizando} />
      </header>
      {!r && <div className="h-32 rounded-2xl bg-white border border-surface-border animate-pulse" />}
      {d?.aviso && <p className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">{d.aviso}</p>}
      {d && d.tecnico && !d.dias.length && <p className="rounded-xl bg-white border border-surface-border p-4 text-sm text-ink-muted">Nada agendado nos próximos dias.</p>}
      {d?.dias.map((g) => (
        <section key={g.dia} className="space-y-2">
          <h2 className="text-sm font-bold text-ink capitalize">{nomeDia(g.dia)} <span className="text-ink-muted font-medium">· {g.atividades.length}</span></h2>
          {g.atividades.map((c) => <CartaoAtividade key={c.atividadeId} c={c} fila={fila} />)}
        </section>
      ))}
    </div>
  );
}
