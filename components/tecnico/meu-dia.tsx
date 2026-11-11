"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronRight, Clock, HardDrive, MapPin, Phone, RefreshCw, Sun, WifiOff } from "lucide-react";
import { cn, formatarData } from "@/lib/utils";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { BotaoRota } from "@/components/tecnico/rota";
import type { CartaoTela, OperacaoFila } from "@/lib/tecnico/offline/tipos";
import { diaCivilDeChave, diasAteDiaCivil, horaBR, partesBR } from "@/lib/fuso";

export const ROTULO_STATUS_ATIVIDADE: Record<string, { rotulo: string; classe: string }> = {
  AGENDADA: { rotulo: "Agendada", classe: "bg-acento-claro text-acento-hover" },
  EM_ANDAMENTO: { rotulo: "Em andamento", classe: "bg-atencao-claro text-atencao-texto" },
  CONCLUIDA: { rotulo: "Concluída", classe: "bg-success-100 text-success-700" },
  CANCELADA: { rotulo: "Cancelada", classe: "bg-atrasado-claro text-atrasado-texto" },
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

export function CartaoAtividade({ c, fila, mostrarDia, proxima }: { c: CartaoTela; fila: OperacaoFila[]; mostrarDia?: boolean; /** A primeira OS do dia ainda por concluir */ proxima?: boolean }) {
  const { status, aEnviar } = situacaoLocal(c, fila);
  const { config } = useTecnico();
  const st = ROTULO_STATUS_ATIVIDADE[status] ?? { rotulo: status, classe: "bg-surface-linha text-ink" };
  // Permissões do app (Equipes › App do colaborador): com "Exibir dados do cliente" desligado o cartão
  // não mostra nome, unidade, endereço nem rota; com "Exibir contatos" desligado, nada de Ligar.
  const verDados = config.exibirDadosCliente;
  const verContatos = config.exibirContatosCliente;
  const cliente = verDados ? c.cliente : "";
  const rota = verDados ? c.rota : null;
  const telefone = verContatos ? c.telefone : null;
  const concluida = status === "CONCLUIDA";
  return (
    <article className={cn("bg-white rounded-card border shadow-card overflow-hidden", proxima ? "border-primary-300 ring-2 ring-primary-100" : "border-surface-border")}
      data-cartao={c.atividadeId} data-proxima={proxima || undefined}>
      <button type="button" onClick={() => irPara({ ver: "os", a: c.atividadeId })} className="w-full text-left p-4 flex gap-3 active:bg-surface-alt touch-target">
        <div className="w-16 shrink-0 text-center">
          <div className={cn("text-xl font-bold leading-tight", concluida ? "text-ink-muted" : "text-ink")} data-hora>{c.hora ?? "—"}</div>
          <div className="text-[11px] text-ink-muted">{c.hora ? (c.duracaoMin ? `${c.duracaoMin} min` : "") : "sem horário"}</div>
          {mostrarDia && c.dia && <div className="text-[11px] text-ink-muted mt-0.5">{c.dia.split("-").reverse().slice(0, 2).join("/")}</div>}
          {concluida && <CheckCircle2 className="w-5 h-5 text-success-600 mx-auto mt-1" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          {proxima && status === "AGENDADA" && <p className="text-[11px] font-bold uppercase tracking-wide text-primary-700 mb-0.5">Próxima</p>}
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn("font-bold text-base leading-snug truncate", concluida ? "text-ink-muted" : "text-ink")}>{cliente || c.titulo}</h3>
            <ChevronRight className="w-5 h-5 text-ink-subtle shrink-0" />
          </div>
          <p className="text-sm text-ink-muted truncate" data-linha-os>
            {[c.osNumero, cliente ? c.titulo : null, verDados ? c.unidade : null].filter(Boolean).join(" · ")}
          </p>
          {verDados && c.endereco && <p className="text-sm text-ink mt-1 flex gap-1" data-endereco><MapPin className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" /><span className="line-clamp-2">{c.endereco}</span></p>}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5", st.classe)} data-status={status}>{st.rotulo}</span>
            <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-surface-linha text-ink inline-flex items-center gap-1" data-equipamentos={c.equipamentos}>
              <HardDrive className="w-3 h-3" /> {c.equipamentos === 1 ? "1 equipamento" : `${c.equipamentos} equipamentos`}
            </span>
            {PRIORIDADE[c.prioridade] && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-atrasado-claro text-atrasado-texto" data-prioridade={c.prioridade}>{PRIORIDADE[c.prioridade]}</span>}
            {aEnviar > 0 && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-atencao-claro text-atencao-texto">{aEnviar} a enviar</span>}
          </div>
        </div>
      </button>
      {(rota || telefone) && (
        <div className="flex border-t border-surface-border divide-x divide-surface-border" data-acoes-cartao>
          {rota && <BotaoRota rota={rota} />}
          {telefone && (
            <a href={`tel:${telefone.replace(/[^\d+]/g, "")}`} data-ligar className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold text-ink active:bg-surface-alt touch-target">
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
  const h = partesBR().hora; // saudação pela hora de Brasília
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function AvisoAparelho({ baixadoEm, doAparelho, onAtualizar, atualizando }: { baixadoEm: number | null; doAparelho?: boolean; onAtualizar: () => void; atualizando: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
      {/* Sem sinal (ou servidor fora): diz que a lista é a que ficou guardada, e de que horas */}
      <span data-origem={doAparelho && baixadoEm ? "aparelho" : undefined}>{baixadoEm ? `${doAparelho ? "Guardado no aparelho · " : ""}Atualizado às ${horaBaixada(baixadoEm)}` : ""}</span>
      <button type="button" onClick={onAtualizar} disabled={atualizando} className="inline-flex items-center gap-1 font-semibold text-primary-700 px-2 py-1 touch-target">
        <RefreshCw className={cn("w-3.5 h-3.5", atualizando && "animate-spin")} /> Atualizar
      </button>
    </div>
  );
}

/** Resumo do dia para o cabeçalho: quantas OS e quantas já concluídas (contando o que ele gravou no aparelho). */
export function resumoDoDia(atividades: CartaoTela[], fila: OperacaoFila[]) {
  const total = atividades.length;
  const concluidas = atividades.filter((c) => situacaoLocal(c, fila).status === "CONCLUIDA").length;
  const proxima = atividades.find((c) => situacaoLocal(c, fila).status !== "CONCLUIDA")?.atividadeId ?? null;
  return { total, concluidas, proxima };
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
  // O sinal voltou, ou o técnico voltou para o app (saiu do mapa/telefone): a lista se atualiza sozinha
  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === "visible") void carregar(); };
    window.addEventListener("online", aoVoltar);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { window.removeEventListener("online", aoVoltar); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [carregar]);

  const d = r?.dados;
  const primeiroNome = (d?.tecnico?.nome ?? usuario.nome).split(" ")[0];
  const resumo = resumoDoDia(d?.atividades ?? [], fila);
  return (
    <div className="space-y-4" data-vista="dia">
      <header className="space-y-1">
        <p className="text-sm text-ink-muted inline-flex items-center gap-1.5"><Sun className="w-4 h-4" /> {formatarData(new Date(), "EEEE, d 'de' MMMM")}</p>
        <h1 className="text-2xl font-bold text-ink">{saudacao()}, {primeiroNome}</h1>
        {d && d.tecnico && (
          <p className="text-sm text-ink-muted" data-resumo-dia>
            {resumo.total === 0 ? "Nenhuma OS para hoje." : `${resumo.total === 1 ? "1 OS para hoje" : `${resumo.total} OS para hoje, na ordem do horário`}${resumo.concluidas ? ` · ${resumo.concluidas === resumo.total ? "todas concluídas" : `${resumo.concluidas} concluída${resumo.concluidas > 1 ? "s" : ""}`}` : ""}.`}
          </p>
        )}
        {resumo.total > 0 && (
          <div className="h-1.5 rounded-full bg-surface-linha overflow-hidden" role="progressbar" aria-label="OS concluídas hoje" aria-valuemin={0} aria-valuemax={resumo.total} aria-valuenow={resumo.concluidas} data-progresso-dia={`${resumo.concluidas}/${resumo.total}`}>
            <div className="h-full bg-success-600 rounded-full transition-all" style={{ width: `${(resumo.concluidas / resumo.total) * 100}%` }} />
          </div>
        )}
        <AvisoAparelho baixadoEm={r?.baixadoEm ?? null} doAparelho={r?.doAparelho} onAtualizar={carregar} atualizando={atualizando} />
      </header>

      {!r && <div className="space-y-3" data-carregando aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-32 rounded-card bg-white border border-surface-border animate-pulse" />)}</div>}
      {r && !d && (
        <div className="rounded-card bg-white border border-surface-border p-6 text-center space-y-2" data-sem-dados>
          <WifiOff className="w-8 h-8 text-ink-subtle mx-auto" />
          <p className="font-semibold text-ink">Sem sinal e nada guardado ainda</p>
          <p className="text-sm text-ink-muted">Abra o app com internet uma vez para baixar o seu dia.</p>
          <button type="button" onClick={carregar} disabled={atualizando} className="text-sm font-semibold text-primary-700 inline-flex items-center justify-center gap-1 px-3 touch-target"><RefreshCw className={cn("w-4 h-4", atualizando && "animate-spin")} /> Tentar de novo</button>
        </div>
      )}
      {d?.aviso && <p className="rounded-card bg-atencao-claro border border-atencao/20 p-4 text-sm text-atencao-texto" data-aviso>{d.aviso}</p>}

      {d && d.anteriores.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wide">Começadas antes — falta concluir</h2>
          {d.anteriores.map((c) => <CartaoAtividade key={c.atividadeId} c={c} fila={fila} mostrarDia />)}
        </section>
      )}
      {d && d.atividades.length > 0 && (
        <section className="space-y-3">
          {d.anteriores.length > 0 && <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wide">Hoje</h2>}
          {d.atividades.map((c) => <CartaoAtividade key={c.atividadeId} c={c} fila={fila} proxima={c.atividadeId === resumo.proxima} />)}
        </section>
      )}
      {d && d.tecnico && !d.atividades.length && !d.anteriores.length && (
        <div className="rounded-card bg-white border border-surface-border p-6 text-center space-y-2" data-dia-vazio>
          <Clock className="w-8 h-8 text-ink-subtle mx-auto" />
          <p className="font-semibold text-ink">Nenhuma OS para hoje</p>
          <p className="text-sm text-ink-muted">As agendadas pelo escritório aparecem aqui.</p>
          <button type="button" onClick={() => irPara({ ver: "agenda" })} className="text-sm font-semibold text-primary-700 inline-flex items-center justify-center gap-1 px-3 touch-target"><CalendarDays className="w-4 h-4" /> Ver a agenda</button>
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
  const [r, setR] = useState<{ dados: RespostaAgenda | null; baixadoEm: number | null; doAparelho: boolean } | null>(null);
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
        <AvisoAparelho baixadoEm={r?.baixadoEm ?? null} doAparelho={r?.doAparelho} onAtualizar={carregar} atualizando={atualizando} />
      </header>
      {!r && <div className="h-32 rounded-card bg-white border border-surface-border animate-pulse" />}
      {d?.aviso && <p className="rounded-card bg-atencao-claro border border-atencao/20 p-4 text-sm text-atencao-texto">{d.aviso}</p>}
      {d && d.tecnico && !d.dias.length && <p className="rounded-card bg-white border border-surface-border p-4 text-sm text-ink-muted">Nada agendado nos próximos dias.</p>}
      {d?.dias.map((g) => (
        <section key={g.dia} className="space-y-2">
          <h2 className="text-sm font-bold text-ink capitalize">{nomeDia(g.dia)} <span className="text-ink-muted font-medium">· {g.atividades.length}</span></h2>
          {g.atividades.map((c) => <CartaoAtividade key={c.atividadeId} c={c} fila={fila} />)}
        </section>
      ))}
    </div>
  );
}
