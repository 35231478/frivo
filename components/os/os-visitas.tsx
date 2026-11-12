"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, CalendarRange, ChevronDown, ChevronRight, ListChecks, Loader2, MoveRight, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InputData } from "@/components/ui/input-data";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/avisos";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { SeletorExecucao, VALOR_EXECUCAO_VAZIO, corpoExecucao, useOpcoesExecucao, type ValorExecucao } from "@/components/os/seletor-execucao";
import { cn } from "@/lib/utils";
import {
  diaDaSemana, incluirDia, planejarVisitas, resumoDoPlano, tirarDia,
  type EstadoVisitasTela, type PlanoDeVisitas, type Resultado, type VisitaAtual, type VisitaTela,
} from "@/lib/os/visitas";

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const br = (dia: string | null) => (dia ? dia.split("-").reverse().join("/") : "sem data");
/** "qui, 12/11/2026" */
export const rotuloDia = (dia: string | null) => (dia ? `${SEMANA[diaDaSemana(dia)]}, ${br(dia)}` : "sem data");
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const STATUS: Record<string, { rotulo: string; classe: string }> = {
  AGENDADA: { rotulo: "Agendada", classe: "bg-acento-claro text-acento" },
  EM_ANDAMENTO: { rotulo: "Em andamento", classe: "bg-atencao-claro text-atencao-texto" },
  CONCLUIDA: { rotulo: "Concluída", classe: "bg-ok-claro text-ok-texto" },
  CANCELADA: { rotulo: "Cancelada", classe: "bg-atrasado-claro text-atrasado-texto" },
};

/** O estado da tela no formato das regras (as mesmas do servidor): é com ele que a prévia é calculada */
function regrasDe(e: EstadoVisitasTela): VisitaAtual[] {
  if (e.plano) return e.visitas.map((v) => ({ id: v.id, status: v.status, dia: v.dia, executada: v.status === "AGENDADA" && !v.pendente, equipamentos: v.equipamentos }));
  return e.origem ? [{ id: e.origem.id, status: "AGENDADA", dia: e.origem.dia, executada: false, equipamentos: e.origem.equipamentos }] : [];
}

type Dialogo = { tipo: "planejar" } | { tipo: "incluir" } | { tipo: "mover"; visita: VisitaTela } | { tipo: "tirar"; visita: VisitaTela } | null;

/**
 * OS EM CAMPANHA: divide os equipamentos da OS em visitas diárias (cada visita é uma atividade da OS)
 * e acompanha o progresso somado. Sem plano, oferece "Planejar visitas" quando a OS tem uma atividade
 * com vários equipamentos. Planejar e ajustar exigem "Ordens de serviço › Editar".
 */
export function OsVisitas({ osId, onMudou }: { osId: string; onMudou?: () => void }) {
  const { pode } = usePermissoes();
  const podeEditar = pode("ordens", "editar");
  const [estado, setEstado] = useState<EstadoVisitasTela | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/ordens/${osId}/visitas`);
      if (res.ok) setEstado(await res.json());
    } catch { /* sem as visitas a OS continua utilizável */ }
  }, [osId]);
  useEffect(() => { carregar(); }, [carregar]);

  /** Envia uma operação; devolve true se deu certo (a tela já fica com o estado novo) */
  async function enviar(corpo: Record<string, unknown>, feito: string): Promise<boolean> {
    setErro(""); setEnviando(true);
    try {
      const res = await fetch(`/api/ordens/${osId}/visitas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível salvar as visitas."); return false; }
      setEstado(d.estado); setDialogo(null); setMarcados(new Set()); setDestino("");
      toast(feito);
      onMudou?.();
      return true;
    } catch { setErro("Erro de conexão."); return false; } finally { setEnviando(false); }
  }
  const abrir = (d: Dialogo) => { setErro(""); setDialogo(d); };

  if (!estado) return null;
  const { plano, visitas, progresso } = estado;

  // Sem plano: só o convite, quando há o que dividir
  if (!plano) {
    if (!estado.origem || estado.bloqueio || !podeEditar) return null;
    return (
      <>
        <div className="flex items-center gap-3 flex-wrap border border-surface-border bg-surface-alt rounded-lg px-4 py-3" data-convite-visitas>
          <CalendarRange className="w-5 h-5 text-ink-muted shrink-0" aria-hidden />
          <p className="text-sm text-ink flex-1 min-w-[14rem]">
            <strong>{plural(estado.origem.equipamentos.length, "equipamento", "equipamentos")}</strong> numa atividade só.
            {" "}Não cabe num dia? Divida em visitas diárias, sem criar outra OS.
          </p>
          <Button type="button" variant="secondary" onClick={() => abrir({ tipo: "planejar" })} data-planejar-visitas><CalendarPlus className="w-4 h-4" /> Planejar visitas</Button>
        </div>
        {dialogo?.tipo === "planejar" && <DialogoPlanejar estado={estado} enviando={enviando} erro={erro} onFechar={() => setDialogo(null)} onConfirmar={(c) => enviar(c, "Visitas planejadas.")} />}
      </>
    );
  }

  const pendentes = visitas.filter((v) => v.pendente);
  const pct = progresso.total ? Math.round((progresso.feitos / progresso.total) * 100) : 0;
  const mover = () => enviar({ acao: "MOVER_EQUIPAMENTOS", equipamentoIds: [...marcados], paraVisitaId: destino }, "Equipamentos movidos.");

  return (
    <section className="border border-surface-border rounded-lg" data-visitas>
      <div className="px-4 py-3 border-b border-surface-linha space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5"><ListChecks className="w-4 h-4" aria-hidden /> Visitas</h3>
          <span className="text-sm text-ink" data-progresso><strong>{progresso.feitos} de {progresso.total}</strong> equipamentos</span>
          <span className="text-xs text-ink-muted" data-visitas-concluidas>{progresso.concluidas} de {plural(progresso.visitas, "visita concluída", "visitas concluídas")}</span>
          {podeEditar && !estado.bloqueio && (
            <span className="ml-auto flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => abrir({ tipo: "incluir" })} disabled={!pendentes.length} data-incluir-dia><CalendarPlus className="w-4 h-4" /> Incluir dia</Button>
              <Button type="button" variant="secondary" onClick={() => abrir({ tipo: "planejar" })} data-replanejar><RefreshCw className="w-4 h-4" /> Replanejar</Button>
            </span>
          )}
        </div>
        <div className="h-2 rounded-full bg-surface-linha overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Equipamentos atendidos">
          <div className="h-full bg-ok rounded-full" style={{ width: `${pct}%` }} />
        </div>
        {estado.sobras > 0 && (
          <p className="text-xs text-atencao-texto" data-sobras>
            {plural(estado.sobras, "equipamento ficou", "equipamentos ficaram")} sem atendimento em visita concluída. Replaneje para voltar a eles.
          </p>
        )}
      </div>

      <ul className="divide-y divide-surface-linha">
        {visitas.map((v) => {
          const feitos = v.equipamentos.filter((e) => e.feito).length;
          const expandida = aberta === v.id;
          const st = STATUS[v.status] ?? STATUS.AGENDADA;
          const outras = pendentes.filter((p) => p.id !== v.id);
          const podeMover = podeEditar && v.pendente && outras.length > 0;
          return (
            <li key={v.id} data-visita={v.id} data-pendente={v.pendente} data-dia={v.dia ?? ""}>
              <div className="flex items-center gap-2 flex-wrap px-4 py-2.5">
                <button type="button" onClick={() => { setAberta(expandida ? null : v.id); setMarcados(new Set()); setDestino(""); setErro(""); }}
                  className="flex items-center gap-2 text-left min-w-0 flex-1" aria-expanded={expandida} data-ver-equipamentos>
                  {expandida ? <ChevronDown className="w-4 h-4 text-ink-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" />}
                  <span className="text-sm font-medium text-ink whitespace-nowrap">{v.numero ? `Visita ${v.numero}` : "Visita"}</span>
                  <span className="text-sm text-ink-muted whitespace-nowrap" data-dia-visita>{rotuloDia(v.dia)}</span>
                </button>
                <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded-full", st.classe)}>{st.rotulo}</span>
                <span className="text-xs text-ink-muted whitespace-nowrap" data-lote>{feitos} de {plural(v.equipamentos.length, "equipamento", "equipamentos")}</span>
                <span className={cn("text-xs truncate max-w-[16rem]", v.executor ? "text-ink-muted" : "text-atencao-texto")} data-executor>{v.executor ?? "Sem quem execute"}</span>
                {podeEditar && v.pendente && (
                  <span className="flex items-center gap-1">
                    <button type="button" title="Mover de dia" aria-label="Mover de dia" onClick={() => abrir({ tipo: "mover", visita: v })} data-mover-visita
                      className="p-1.5 rounded-md text-ink-muted hover:text-acento hover:bg-surface-alt"><MoveRight className="w-4 h-4" /></button>
                    <button type="button" title="Tirar o dia" aria-label="Tirar o dia" onClick={() => abrir({ tipo: "tirar", visita: v })} disabled={!outras.length} data-tirar-dia
                      className="p-1.5 rounded-md text-ink-muted hover:text-atrasado hover:bg-atrasado-claro disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                  </span>
                )}
              </div>
              {expandida && (
                <div className="px-4 pb-3 space-y-2 bg-surface-page" data-equipamentos-da-visita>
                  <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 pt-2">
                    {v.equipamentos.map((e) => (
                      <li key={e.id} className="text-xs text-ink flex items-center gap-2 min-w-0" data-equipamento={e.id}>
                        {podeMover && !e.feito
                          ? <input type="checkbox" className="shrink-0" checked={marcados.has(e.id)} aria-label={`Mover ${e.rotulo}`}
                              onChange={() => setMarcados((m) => { const n = new Set(m); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />
                          : <span className={cn("w-2 h-2 rounded-full shrink-0", e.feito ? "bg-ok" : "bg-surface-border")} aria-hidden />}
                        <span className="truncate">{e.rotulo}{e.local ? <span className="text-ink-muted"> · {e.local}</span> : null}</span>
                        {e.feito && <span className="text-ok-texto shrink-0">atendido</span>}
                      </li>
                    ))}
                  </ul>
                  {podeMover && (
                    <div className="flex items-center gap-2 flex-wrap pt-1" data-mover-para>
                      <span className="text-xs text-ink-muted">Mover {plural(marcados.size, "marcado", "marcados")} para</span>
                      <Select value={destino} onChange={(ev) => setDestino(ev.target.value)} className="text-xs w-auto py-1.5" aria-label="Visita de destino">
                        <option value="">Escolha a visita</option>
                        {outras.map((o) => <option key={o.id} value={o.id}>Visita {o.numero} · {rotuloDia(o.dia)}</option>)}
                      </Select>
                      <Button type="button" variant="secondary" loading={enviando} disabled={!marcados.size || !destino} onClick={mover} data-mover-equipamentos>Mover</Button>
                    </div>
                  )}
                  {erro && !dialogo && <p role="alert" className="text-xs text-atrasado-texto" data-erro-visitas>{erro}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {dialogo?.tipo === "planejar" && <DialogoPlanejar estado={estado} enviando={enviando} erro={erro} onFechar={() => setDialogo(null)} onConfirmar={(c) => enviar(c, "Visitas replanejadas.")} />}
      {dialogo?.tipo === "incluir" && (
        <DialogoDia titulo="Incluir um dia" rotulo="Dia da nova visita" confirmar="Incluir dia" inicial="" estado={estado} enviando={enviando} erro={erro} onFechar={() => setDialogo(null)}
          calcular={(dia) => incluirDia(regrasDe(estado), dia, estado.hoje)} texto="Mais uma visita, nesse dia. Os equipamentos pendentes são repartidos por igual."
          onConfirmar={(dia) => enviar({ acao: "INCLUIR_DIA", dia }, "Dia incluído.")} />
      )}
      {dialogo?.tipo === "mover" && (
        <DialogoDia titulo={`Mover a visita ${dialogo.visita.numero ?? ""}`.trim()} rotulo="Novo dia da visita" confirmar="Mover visita" inicial={dialogo.visita.dia ?? ""} estado={estado}
          enviando={enviando} erro={erro} onFechar={() => setDialogo(null)} texto={`Hoje em ${rotuloDia(dialogo.visita.dia)}. Só esta visita muda; as outras ficam como estão.`}
          onConfirmar={(dia) => enviar({ acao: "MOVER_VISITA", visitaId: dialogo.visita.id, dia }, "Visita movida.")} />
      )}
      {dialogo?.tipo === "tirar" && (() => {
        const r = tirarDia(regrasDe(estado), dialogo.visita.id);
        return (
          <Modal aberto onFechar={() => setDialogo(null)} titulo="Tirar o dia" tamanho="sm">
            <div className="space-y-4" data-modal-tirar>
              <p className="text-sm text-ink">
                A visita de <strong>{rotuloDia(dialogo.visita.dia)}</strong> deixa de existir.
                {" "}Os {plural(dialogo.visita.equipamentos.length, "equipamento vai", "equipamentos vão")} para as outras visitas pendentes.
              </p>
              {r.plano && <Previa plano={r.plano} />}
              {(r.erro || erro) && <p role="alert" className="text-sm text-atrasado-texto" data-erro-visitas>{r.erro ?? erro}</p>}
              <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
                <Button type="button" variant="secondary" onClick={() => setDialogo(null)}>Cancelar</Button>
                <Button type="button" variant="danger" loading={enviando} disabled={!r.plano} data-confirmar-visitas
                  onClick={() => enviar({ acao: "TIRAR_DIA", visitaId: dialogo.visita.id }, "Dia retirado.")}>Tirar o dia</Button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </section>
  );
}

/** A prévia: quantas visitas, de que dia a que dia, e o lote de cada dia */
function Previa({ plano }: { plano: PlanoDeVisitas }) {
  const r = resumoDoPlano(plano);
  const MOSTRAR = 14;
  return (
    <div className="border border-ok/20 bg-ok-claro rounded-lg px-3 py-2.5 space-y-2" data-previa>
      <p className="text-sm text-ok-texto font-semibold" data-previa-resumo>
        {plural(r.visitas, "visita", "visitas")}, {r.de === r.ate ? `em ${rotuloDia(r.de)}` : `de ${rotuloDia(r.de)} a ${rotuloDia(r.ate)}`}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {plano.visitas.slice(0, MOSTRAR).map((v, i) => (
          <li key={`${v.dia}-${i}`} className="text-xs bg-white border border-ok/20 rounded-md px-2 py-1 text-ink" data-previa-dia={v.dia}>
            {rotuloDia(v.dia).slice(0, -5)} · <strong>{v.equipamentoIds.length}</strong>
          </li>
        ))}
        {plano.visitas.length > MOSTRAR && <li className="text-xs text-ink-muted px-1 py-1">e mais {plano.visitas.length - MOSTRAR}</li>}
      </ul>
    </div>
  );
}

/** Planejar e replanejar: data de início, quantidade por dia, pular fim de semana e quem executa */
function DialogoPlanejar({ estado, enviando, erro, onFechar, onConfirmar }: {
  estado: EstadoVisitasTela; enviando: boolean; erro: string; onFechar: () => void; onConfirmar: (corpo: Record<string, unknown>) => void;
}) {
  const replanejando = !!estado.plano;
  const [inicio, setInicio] = useState(estado.proposta.inicio);
  const [porDia, setPorDia] = useState(String(estado.proposta.porDia));
  const [pular, setPular] = useState(estado.proposta.pularFimSemana);
  const [sobras, setSobras] = useState(estado.sobras > 0);
  // No primeiro planejamento o executor vale para todas as visitas; ao replanejar, só se pedir para trocar
  const [trocar, setTrocar] = useState(!replanejando);
  const [executor, setExecutor] = useState<ValorExecucao>(estado.executorModelo ? { ...VALOR_EXECUCAO_VAZIO, ...estado.executorModelo, responsavelId: estado.executorModelo.responsavelId ?? null,
    equipeId: estado.executorModelo.equipeId ?? null, veiculoId: estado.executorModelo.veiculoId ?? null } : VALOR_EXECUCAO_VAZIO);
  const opcoes = useOpcoesExecucao(trocar);
  const n = porDia.trim() === "" ? Number.NaN : Number(porDia);
  const r: Resultado = useMemo(
    () => planejarVisitas(regrasDe(estado), { inicio, porDia: n, pularFimSemana: pular, incluirSobras: sobras && estado.sobras > 0 }, estado.hoje),
    [estado, inicio, n, pular, sobras],
  );
  const total = r.plano ? resumoDoPlano(r.plano).equipamentos : 0;
  const confirmar = () => onConfirmar({
    acao: "PLANEJAR", inicio, porDia: n, pularFimSemana: pular, ...(estado.sobras > 0 ? { incluirSobras: sobras } : {}),
    ...(estado.origem ? { atividadeId: estado.origem.id } : {}), ...(trocar ? { executor: corpoExecucao(executor) } : {}),
  });

  return (
    <Modal aberto onFechar={onFechar} titulo={replanejando ? "Replanejar as visitas" : "Planejar visitas"} tamanho="lg">
      <div className="space-y-4" data-modal-planejar>
        <p className="text-sm text-ink-muted">
          {replanejando
            ? <span>Refaz só as visitas que ainda não começaram. O que já foi feito não é mexido.</span>
            : <span>Divide os equipamentos em visitas diárias. Continua sendo uma OS só, com uma cobrança.</span>}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Data de início" required>
            <InputData aria-label="Data de início das visitas" value={inicio} onChange={setInicio} />
          </FormField>
          <FormField label="Equipamentos por dia" required hint={total ? `${total} a distribuir` : undefined}>
            <Input aria-label="Equipamentos por dia" type="number" inputMode="numeric" min={1} step={1} value={porDia} onChange={(e) => setPorDia(e.target.value)} />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={pular} onChange={(e) => setPular(e.target.checked)} data-pular-fim-semana /> Pular sábado e domingo
        </label>
        {estado.sobras > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={sobras} onChange={(e) => setSobras(e.target.checked)} data-incluir-sobras />
            Incluir {plural(estado.sobras, "equipamento que ficou", "equipamentos que ficaram")} sem atendimento
          </label>
        )}
        {replanejando && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={trocar} onChange={(e) => setTrocar(e.target.checked)} data-trocar-executor /> Trocar quem executa as visitas pendentes
          </label>
        )}
        {trocar && (
          <FormField label="Quem executa" hint="Opcional. Em branco, as visitas nascem sem quem execute, para distribuir depois.">
            <SeletorExecucao opcoes={opcoes} tipoOsId={estado.tipoOsId ?? ""} valor={executor} onChange={setExecutor} />
          </FormField>
        )}
        {r.plano ? <Previa plano={r.plano} /> : <p className="text-sm text-atencao-texto" data-previa-erro>{r.erro}</p>}
        {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-visitas>{erro}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="button" loading={enviando} disabled={!r.plano} onClick={confirmar} data-confirmar-visitas>
            <CalendarPlus className="w-4 h-4" /> {replanejando ? "Replanejar" : "Planejar visitas"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Um dia só: incluir um dia (com a prévia de como ficam os lotes) ou mover uma visita */
function DialogoDia({ titulo, rotulo, confirmar, inicial, texto, enviando, erro, calcular, onFechar, onConfirmar }: {
  titulo: string; rotulo: string; confirmar: string; inicial: string; texto: string; estado: EstadoVisitasTela; enviando: boolean; erro: string;
  calcular?: (dia: string) => Resultado; onFechar: () => void; onConfirmar: (dia: string) => void;
}) {
  const [dia, setDia] = useState(inicial);
  const r = dia && calcular ? calcular(dia) : null;
  return (
    <Modal aberto onFechar={onFechar} titulo={titulo} tamanho="sm">
      <div className="space-y-4" data-modal-dia>
        <p className="text-sm text-ink-muted">{texto}</p>
        <FormField label={rotulo} required>
          <InputData aria-label={rotulo} value={dia} onChange={setDia} />
        </FormField>
        {r?.plano && <Previa plano={r.plano} />}
        {(r?.erro || erro) && <p role="alert" className="text-sm text-atrasado-texto" data-erro-visitas>{r?.erro ?? erro}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="button" loading={enviando} disabled={!dia || !!r?.erro} onClick={() => onConfirmar(dia)} data-confirmar-visitas>{confirmar}</Button>
        </div>
      </div>
    </Modal>
  );
}
