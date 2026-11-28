"use client";

/**
 * D1 — PAUSAR / IMPEDIMENTO no app do técnico (sem sinal também: grava na fila e vale já na tela).
 *  - "Pausar atividade": motivo obrigatório da lista da empresa (Configurações › Motivos de pausa); observação e foto
 *    opcionais (o "Outro" pede o texto). A foto vai para as fotos do serviço com a legenda "Pausa — <motivo>".
 *  - Pausada: a faixa diz o motivo e há quanto tempo; "Retomar" volta para a execução. Impedimento também permite
 *    "Encerrar a visita: não concluída" (precisa voltar: o escritório reagenda, com o motivo).
 */
import { useEffect, useState } from "react";
import { PauseCircle, PlayCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { confirmar, toast } from "@/components/ui/avisos";
import { BotaoFoto, Miniatura } from "@/components/tecnico/captura";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { MOTIVOS_PADRAO, OBSERVACAO_MAX, problemaDaPausa, textoPausada, type MotivoPausaTela } from "@/lib/pausas/regras";
import type { ExecucaoTela, NovaOperacao, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

type Registrar = (ops: NovaOperacao[]) => Promise<void>;
const semSinal = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Os motivos que o técnico vê: os da empresa (retrato); retrato antigo = os padrões (o servidor confere pelo nome) */
export function motivosDoRetrato(r: Pick<RetratoAtividade, "motivosPausa">): MotivoPausaTela[] {
  if (r.motivosPausa?.length) return r.motivosPausa;
  return MOTIVOS_PADRAO.map((m) => ({ id: `padrao:${m.nome}`, nome: m.nome, tipo: m.tipo, pedeTexto: m.pedeTexto }));
}

function useMinuto() {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return agora;
}

/** A faixa da atividade pausada: motivo, há quanto tempo, Retomar (e, impedimento, encerrar como não concluída) */
export function FaixaPausa({ x, registrar }: { x: ExecucaoTela; registrar: Registrar }) {
  const agora = useMinuto();
  const [gravando, setGravando] = useState(false);
  if (x.naoConcluida) {
    return (
      <p className="rounded-card border border-atencao/20 bg-atencao-claro px-3 py-3 text-sm text-atencao-texto" data-visita-nao-concluida>
        Visita encerrada como não concluída ({x.naoConcluida.motivo}). O escritório vai reagendar.
      </p>
    );
  }
  const p = x.pausa;
  if (!p) return null;
  const atividadeId = x.atividade.id;
  async function retomar() {
    setGravando(true);
    try { await registrar([{ tipo: "retomar", atividadeId, dados: { pausaClientId: p!.clientId } }]); toast("Atividade retomada."); }
    finally { setGravando(false); }
  }
  async function encerrar() {
    if (!(await confirmar({ titulo: "Encerrar a visita como não concluída?", mensagem: `“${p!.motivo}”: o escritório vai reagendar a visita.`, perigo: true, confirmarTexto: "Encerrar visita" }))) return;
    setGravando(true);
    try {
      await registrar([{ tipo: "naoConcluida", atividadeId, dados: { pausaClientId: p!.clientId } }]);
      toast(semSinal() ? "Visita encerrada no aparelho: sobe quando houver sinal." : "Visita encerrada como não concluída. O escritório vai reagendar.");
    } finally { setGravando(false); }
  }
  return (
    <section className="rounded-card border-2 border-atencao bg-atencao-claro p-4 space-y-3" data-pausada={p.impedimento ? "impedimento" : "intervalo"} aria-live="polite">
      <p className="flex items-start gap-2 text-base font-bold text-atencao-texto">
        <PauseCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
        <span data-texto-pausada>{textoPausada(p, new Date(agora))}</span>
      </p>
      {p.observacao && <p className="text-sm text-ink break-words" data-observacao-pausa>{p.observacao}</p>}
      {p.impedimento && <p className="text-xs text-ink-muted">O escritório foi avisado.{p.pendente ? " (sobe quando houver sinal)" : ""}</p>}
      <button type="button" onClick={retomar} disabled={gravando} data-retomar
        className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold inline-flex items-center justify-center gap-2 touch-target disabled:opacity-50">
        <PlayCircle className="w-5 h-5" aria-hidden /> Retomar
      </button>
      {p.impedimento && (
        <button type="button" onClick={encerrar} disabled={gravando} data-encerrar-nao-concluida
          className="w-full rounded-card border border-atrasado/30 bg-white text-atrasado-texto py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target disabled:opacity-50">
          <XCircle className="w-4 h-4" aria-hidden /> Encerrar a visita: não concluída (precisa voltar)
        </button>
      )}
    </section>
  );
}

/** O botão "Pausar atividade" (atividade em andamento, sem pausa aberta) e o modal do motivo */
export function BotaoPausar({ r, x, registrar }: { r: RetratoAtividade; x: ExecucaoTela; registrar: Registrar }) {
  const [aberto, setAberto] = useState(false);
  if (x.atividade.status !== "EM_ANDAMENTO" || x.pausa || x.bloqueada) return null;
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} data-pausar
        className="w-full rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
        <PauseCircle className="w-5 h-5 text-atencao-texto" aria-hidden /> Pausar atividade (impedimento ou intervalo)
      </button>
      {aberto && <ModalPausar r={r} x={x} registrar={registrar} onFechar={() => setAberto(false)} />}
    </>
  );
}

export function ModalPausar({ r, x, registrar, onFechar }: { r: RetratoAtividade; x: ExecucaoTela; registrar: Registrar; onFechar: () => void }) {
  const motivos = motivosDoRetrato(r);
  const [escolhido, setEscolhido] = useState<MotivoPausaTela | null>(null);
  const [observacao, setObservacao] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const problema = problemaDaPausa(escolhido, observacao);
  async function pausar() {
    if (problema || !escolhido) return;
    setGravando(true);
    try {
      const atividadeId = x.atividade.id;
      const obs = observacao.trim() || null;
      const ops: NovaOperacao[] = [{
        tipo: "pausar", atividadeId,
        dados: { clientId: novoClientId(), motivoId: escolhido.id.startsWith("padrao:") ? null : escolhido.id, motivo: escolhido.nome, impedimento: escolhido.tipo === "IMPEDIMENTO", observacao: obs },
      }];
      // A foto da pausa é uma foto do serviço (um jeito só): a legenda diz de qual pausa
      if (foto) ops.push({ tipo: "fotoOs", atividadeId, dados: { dataUrl: foto, equipamentoId: null, legenda: `Pausa — ${escolhido.nome}`.slice(0, 120), clientId: novoClientId() } });
      await registrar(ops);
      toast(escolhido.tipo === "IMPEDIMENTO" ? "Atividade pausada. O escritório vai ser avisado." : "Atividade pausada.");
      if (semSinal()) toast("Sem sinal agora: a pausa ficou no aparelho e sobe sozinha quando o sinal voltar.", "info");
      onFechar();
    } finally { setGravando(false); }
  }
  return (
    <Modal aberto titulo="Pausar atividade" onFechar={onFechar}>
      <div className="space-y-4" data-modal-pausar>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink mb-1">Motivo</legend>
          <div className="grid gap-2" role="radiogroup" aria-label="Motivo da pausa">
            {motivos.map((m) => {
              const sel = escolhido?.id === m.id;
              return (
                <button key={m.id} type="button" role="radio" aria-checked={sel} onClick={() => setEscolhido(m)} data-motivo-pausa={m.nome}
                  className={cn("w-full text-left rounded-card border px-4 py-3 min-h-[48px] text-base font-medium inline-flex items-center justify-between gap-2",
                    sel ? "border-primary-500 bg-primary-50 text-ink ring-2 ring-primary-500/30" : "border-surface-border bg-white text-ink")}>
                  <span>{m.nome}</span>
                  <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 shrink-0", m.tipo === "INTERVALO" ? "bg-surface-linha text-ink-muted" : "bg-atencao-claro text-atencao-texto")}>
                    {m.tipo === "INTERVALO" ? "Intervalo" : "Avisa o escritório"}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">{escolhido?.pedeTexto ? "Qual o motivo?" : "Observação (opcional)"}</span>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} maxLength={OBSERVACAO_MAX} data-observacao-pausar
            placeholder={escolhido?.pedeTexto ? "Escreva o motivo" : "Ex.: peça chega amanhã às 10h"} className="w-full rounded-card border border-surface-border px-3 py-3 text-base" />
        </label>
        <div className="space-y-2">
          {foto ? <Miniatura src={foto} alt="foto da pausa" pendente onRemover={() => setFoto(null)} /> : <BotaoFoto rotulo="Foto (opcional)" onFoto={setFoto} />}
        </div>
        <button type="button" disabled={!!problema || gravando} onClick={pausar} data-confirmar-pausa
          className="w-full rounded-card bg-atencao text-white py-4 text-base font-bold disabled:opacity-40 touch-target">Pausar</button>
        {problema && <p className="text-sm text-ink-muted text-center" data-falta-pausa>{problema}</p>}
      </div>
    </Modal>
  );
}
