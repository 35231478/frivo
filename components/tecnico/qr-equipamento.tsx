"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, HardDrive, Loader2, QrCode, WifiOff } from "lucide-react";
import { cn, formatarData } from "@/lib/utils";
import { toast } from "@/components/ui/avisos";
import { ScannerQR } from "@/components/os/scanner-qr";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import { destinoDoQr, MSG_FICHA_SEM_SINAL, type AtividadeDoDia, type DestinoQr, type FichaEquipamento } from "@/lib/tecnico/qr-campo";
import { toqueLeve } from "@/lib/haptico";
import { SeloGarantia } from "@/components/tecnico/garantia";

/** Para onde o QR lido leva, com as OS do dia guardadas no aparelho (funciona sem sinal). */
export function useDestinoQr() {
  const { motor } = useTecnico();
  return async (valor: string, atividadeIds: string[]): Promise<DestinoQr> => {
    if (!motor) return { tipo: "ficha", valor };
    const [guardados, fila] = await Promise.all([Promise.all([...new Set(atividadeIds)].map((id) => motor.banco.retrato(id))), motor.banco.fila()]);
    const dia: AtividadeDoDia[] = guardados.flatMap((g) => {
      if (!g) return [];
      const x = estadoDaAtividade(g.retrato, fila);
      return [{ retrato: g.retrato, status: x.atividade.status, vinculados: x.equipamentos.map((e) => e.equipamento.id) }];
    });
    return destinoDoQr(valor, dia);
  };
}

/** Leva o técnico ao destino do QR. Ficha sem sinal: avisa e fica onde está. */
export function irParaDestino(d: DestinoQr, online = typeof navigator === "undefined" || navigator.onLine !== false) {
  if (d.tipo === "naAtividade") { irPara({ ver: "os", a: d.atividadeId, e: d.equipamentoId }); return true; }
  if (d.tipo === "naUnidade") { irPara({ ver: "os", a: d.atividadeId, inc: d.equipamentoId }); return true; }
  if (!online) { toast(MSG_FICHA_SEM_SINAL, "info"); return false; }
  irPara({ ver: "equipamento", q: d.valor });
  return true;
}

/** "Ler QR do equipamento" no Meu dia: aponta a câmera e o app abre o equipamento certo. */
export function BotaoQrEquipamento({ atividadeIds }: { atividadeIds: string[] }) {
  const { usuario } = useTecnico();
  const [aberto, setAberto] = useState(false);
  const destino = useDestinoQr();
  async function ler(valor: string) {
    setAberto(false);
    toqueLeve();
    irParaDestino(await destino(valor, atividadeIds));
  }
  // Sem o módulo QR Codes a etiqueta não existe para a empresa (o servidor também recusa a ficha)
  if (usuario.qrcodes === false) return null;
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} data-ler-qr-dia
        className="w-full rounded-card border-2 border-primary-600 bg-white text-primary-700 py-3.5 text-base font-bold inline-flex items-center justify-center gap-2 active:bg-primary-50 touch-target">
        <QrCode className="w-6 h-6" /> Ler QR do equipamento
      </button>
      {aberto && <ScannerQR onFechar={() => setAberto(false)} onLer={ler} />}
    </>
  );
}

type Estado = { fase: "carregando" } | { fase: "ok"; ficha: FichaEquipamento } | { fase: "erro"; texto: string; semSinal?: boolean };

/** A FICHA do equipamento (fora das OS de hoje): identificação e histórico, só leitura, sem valores. */
export function VistaFichaEquipamento({ valor }: { valor: string }) {
  const [e, setE] = useState<Estado>({ fase: "carregando" });
  useEffect(() => {
    let vivo = true;
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setE({ fase: "erro", texto: MSG_FICHA_SEM_SINAL, semSinal: true }); return; }
    fetch(`/api/tecnico/equipamentos/qr?valor=${encodeURIComponent(valor)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok) { setE({ fase: "erro", texto: j?.erro ?? "Não foi possível abrir a ficha agora." }); return; }
        const ficha = j as FichaEquipamento;
        // Está numa OS dele hoje (o aparelho não sabia): abre o equipamento dentro dela
        if (ficha.atividadeHoje) { irPara({ ver: "os", a: ficha.atividadeHoje.atividadeId, e: ficha.equipamento.id }, true); return; }
        setE({ fase: "ok", ficha });
      })
      .catch(() => { if (vivo) setE({ fase: "erro", texto: MSG_FICHA_SEM_SINAL, semSinal: true }); });
    return () => { vivo = false; };
  }, [valor]);

  return (
    <div className="space-y-4" data-vista="ficha-equipamento">
      <button type="button" onClick={() => irPara({ ver: "dia" })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 py-1 touch-target">
        <ArrowLeft className="w-4 h-4" /> Meu dia
      </button>
      {e.fase === "carregando" && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div>}
      {e.fase === "erro" && (
        <div className="rounded-card bg-white border border-surface-border p-6 text-center space-y-2" data-ficha-erro={e.semSinal ? "sem-sinal" : "erro"}>
          {e.semSinal ? <WifiOff className="w-8 h-8 text-ink-subtle mx-auto" /> : <AlertTriangle className="w-8 h-8 text-atencao mx-auto" />}
          <p className="font-semibold text-ink">{e.texto}</p>
        </div>
      )}
      {e.fase === "ok" && <Ficha f={e.ficha} />}
    </div>
  );
}

const ROTULO_STATUS: Record<string, string> = { CONCLUIDA: "Concluída", EM_ANDAMENTO: "Em andamento", AGENDADA: "Agendada", CANCELADA: "Cancelada", ABERTA: "Aberta" };

function Ficha({ f }: { f: FichaEquipamento }) {
  const q = f.equipamento;
  return (
    <>
      <header className="bg-white rounded-card border border-surface-border p-4 space-y-1.5" data-ficha={q.id}>
        <p className="text-sm font-semibold text-ink-muted inline-flex items-center gap-1.5"><HardDrive className="w-4 h-4" /> {q.tipo ?? "Equipamento"}</p>
        <h1 className="text-xl font-bold text-ink leading-tight">{q.titulo}</h1>
        <p className="text-sm text-ink-muted">{[q.fabricante, q.tag && `TAG ${q.tag}`, q.numeroSerie && `Série ${q.numeroSerie}`].filter(Boolean).join(" · ")}</p>
        {(q.cliente || q.unidade || q.local) && <p className="text-sm text-ink" data-ficha-local>{[q.cliente, q.unidade, q.local].filter(Boolean).join(" · ")}</p>}
        <SeloGarantia fim={q.garantiaAte} />
        {!q.ativo && <p className="text-xs font-semibold rounded-full px-2 py-0.5 bg-surface-linha text-ink-muted inline-block">Inativo</p>}
        <p className="text-xs text-ink-muted pt-1" data-fora-das-os>Fora das suas OS de hoje.</p>
      </header>
      <section className="space-y-2" data-ficha-historico>
        <h2 className="text-base font-bold text-ink inline-flex items-center gap-1.5"><ClipboardList className="w-4 h-4 text-ink-muted" /> Histórico</h2>
        {!f.historico.length && <p className="rounded-card bg-white border border-surface-border p-4 text-sm text-ink-muted">Nenhum atendimento registrado.</p>}
        <ul className="space-y-2">
          {f.historico.map((h) => (
            <li key={h.chave} className="rounded-card bg-white border border-surface-border p-3 space-y-1" data-atendimento>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-bold text-ink">{formatarData(h.data)} · {h.tipoServico ?? h.titulo}</span>
                <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 shrink-0", h.status === "CONCLUIDA" ? "bg-success-100 text-success-700" : "bg-surface-linha text-ink")}>{ROTULO_STATUS[h.status] ?? h.status}</span>
              </div>
              <p className="text-xs text-ink-muted">{[h.osNumero, h.tecnico].filter(Boolean).join(" · ")}</p>
              {h.checklist && (
                <p className="text-sm text-ink inline-flex items-center gap-1.5">
                  {h.checklist.atencao ? <AlertTriangle className="w-4 h-4 text-atencao" /> : <CheckCircle2 className="w-4 h-4 text-success-600" />}
                  {h.checklist.ok} OK{h.checklist.atencao ? ` · ${h.checklist.atencao} atenção` : ""}
                </p>
              )}
              {h.checklist?.itensAtencao.length ? <p className="text-xs text-atencao-texto">{h.checklist.itensAtencao.join(" · ")}</p> : null}
              {h.medicoes.length > 0 && <p className="text-xs text-ink">{h.medicoes.map((m) => `${m.texto}: ${String(m.valor).replace(".", ",")}${m.unidade ? ` ${m.unidade}` : ""}`).join(" · ")}</p>}
              {h.observacao && <p className="text-sm text-ink whitespace-pre-line">{h.observacao}</p>}
              {h.adicionais.length > 0 && <p className="text-xs text-ink-muted">Adicional: {h.adicionais.join("; ")}</p>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
