"use client";

import { confirmar } from "@/components/ui/avisos";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, QrCode, X, CircleCheck, AlertCircle, Loader2, HardDrive, ListPlus, Lock, ClipboardCheck,
} from "lucide-react";
import { SeletorEquipamentos } from "@/components/os/seletor-equipamentos";
import { ScannerQR } from "@/components/os/scanner-qr";
import { EquipamentoExecucaoCard, type AcoesEquipamento, type CampoTela, type EquipamentoTela } from "@/components/os/execucao-equipamento";
import { ConcluirSemEquipamento } from "@/components/os/concluir-sem-equipamento";
import { completo, faltasEquipamento, paraPendencia, textoFaltas, verificarConclusao, type DispensaEquipamento, type ResultadoConclusao, type StatusItem } from "@/lib/execucao/pendencias";

interface Props {
  osId: string;
  atividadeId: string;
  titulo: string;
  osNumero: string;
  tipoOs: { id: string; nome: string; cor: string } | null;
}

interface ExecucaoTela {
  atividade: { id: string; titulo: string; status: string };
  os: { id: string; numero: string; status: string; clienteId: string; unidadeId: string | null };
  bloqueada: boolean;
  equipamentos: EquipamentoTela[];
  conclusao: ResultadoConclusao;
  /** Saída da exigência de equipamento (tipo, recorrente, justificada); ausente em retratos antigos */
  dispensaEquipamento?: DispensaEquipamento | null;
}
/** `servidor`: recusa do servidor (fica até a próxima tentativa); senão é a conferência da tela, que some quando tudo fica respondido */
type Pendencias = { erro: string; pendencias?: { equipamentoId: string; titulo: string }[]; servidor: boolean };

const RESPOSTA_VAZIA = { status: null, observacao: null, valor: null, unidade: null, audio: false, audioId: null };

/** Recalcula, na tela, o que falta (as MESMAS regras do servidor) depois de cada resposta. */
function recalcular(x: ExecucaoTela): ExecucaoTela {
  const equipamentos = x.equipamentos.map((e) => {
    const faltas = faltasEquipamento(paraPendencia(e));
    return { ...e, faltas, completo: completo(faltas) };
  });
  return { ...x, equipamentos, conclusao: verificarConclusao(equipamentos.map((e) => paraPendencia(e)), x.dispensaEquipamento ?? null) };
}

/**
 * Execução da atividade POR EQUIPAMENTO: cada equipamento atendido tem o seu checklist (do tipo dele),
 * as suas fotos, a sua observação e o seu formulário. Vincula equipamento pelo QR Code ou pela lista
 * da unidade. Cada toque grava na hora, só aquele dado — reabrir nunca apaga nada. "Concluir" só passa
 * com pelo menos 1 equipamento atendido e o checklist dele completo (a tela mostra o que falta).
 */
export function AtividadeExecucao({ osId, atividadeId, titulo, osNumero, tipoOs }: Props) {
  const base = `/api/ordens/${osId}/atividades/${atividadeId}`;
  const [exec, setExec] = useState<ExecucaoTela | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [scanAberto, setScanAberto] = useState(false);
  const [listaAberta, setListaAberta] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [pendencias, setPendencias] = useState<Pendencias | null>(null);
  const [concluindo, setConcluindo] = useState(false);
  const primeiraCarga = useRef(true);

  const carregar = useCallback(async () => {
    const r = await fetch(`${base}/execucao`);
    if (!r.ok) { setMensagem({ tipo: "erro", texto: "Não foi possível carregar a execução." }); return; }
    const d: ExecucaoTela = await r.json();
    setExec(d);
    if (primeiraCarga.current) {
      primeiraCarga.current = false;
      // Abre o 1º equipamento que ainda tem o que fazer
      const prox = d.equipamentos.find((e) => !e.feito || !e.completo);
      if (prox) setAbertos(new Set([prox.equipamento.id]));
    }
  }, [base]);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!mensagem || mensagem.tipo === "erro") return;
    const t = setTimeout(() => setMensagem(null), 3500);
    return () => clearTimeout(t);
  }, [mensagem]);

  /** Altera um equipamento na tela (e recalcula o que falta). */
  const mudarEquip = (equipamentoId: string, f: (e: EquipamentoTela) => EquipamentoTela) =>
    setExec((x) => (x ? recalcular({ ...x, equipamentos: x.equipamentos.map((e) => (e.equipamento.id === equipamentoId ? f(e) : e)) }) : x));

  async function enviar(url: string, init: RequestInit): Promise<any | null> {
    try {
      const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMensagem({ tipo: "erro", texto: d.erro ?? "Não foi possível gravar." }); return null; }
      return d;
    } catch {
      setMensagem({ tipo: "erro", texto: "Sem conexão: a resposta não foi gravada. Tente de novo." });
      return null;
    }
  }

  function acoesDe(e: EquipamentoTela): AcoesEquipamento {
    const eq = e.equipamento.id;
    const urlEq = `${base}/execucao/equipamentos/${eq}`;
    return {
      async responder(itemId: string, status: StatusItem) {
        const antes = e.respostas[itemId];
        mudarEquip(eq, (x) => ({ ...x, feito: true, respostas: { ...x.respostas, [itemId]: { ...(antes ?? RESPOSTA_VAZIA), status } } }));
        const d = await enviar(`${urlEq}/itens/${itemId}`, { method: "PUT", body: JSON.stringify({ status }) });
        if (!d) mudarEquip(eq, (x) => ({ ...x, feito: e.feito, respostas: { ...x.respostas, [itemId]: antes ?? RESPOSTA_VAZIA } }));
      },
      async tudoOk() {
        const d = await enviar(`${urlEq}/tudo-ok`, { method: "POST", body: JSON.stringify({}) });
        if (d) mudarEquip(eq, (x) => {
          const respostas = { ...x.respostas };
          for (const id of (d.marcados ?? []) as string[]) respostas[id] = { ...(respostas[id] ?? RESPOSTA_VAZIA), status: "OK" };
          return { ...x, feito: d.feito ?? x.feito, respostas };
        });
      },
      async medir(itemId, dados) {
        const d = await enviar(`${urlEq}/itens/${itemId}`, { method: "PUT", body: JSON.stringify(dados) });
        if (d) mudarEquip(eq, (x) => ({ ...x, feito: d.feito ?? x.feito, respostas: { ...x.respostas, [itemId]: { ...(x.respostas[itemId] ?? RESPOSTA_VAZIA), status: d.status, valor: d.valor, unidade: d.unidade } } }));
      },
      async observarItem(itemId: string, texto: string) {
        const d = await enviar(`${urlEq}/itens/${itemId}`, { method: "PUT", body: JSON.stringify({ observacao: texto }) });
        if (d) mudarEquip(eq, (x) => ({ ...x, feito: d.feito ?? x.feito, respostas: { ...x.respostas, [itemId]: { ...(x.respostas[itemId] ?? RESPOSTA_VAZIA), status: d.status, observacao: d.observacao } } }));
      },
      async adicionarFoto(itemId: string | null, arquivo: File) {
        setMensagem({ tipo: "ok", texto: "Enviando foto…" });
        let dataUrl: string;
        try {
          const { reduzirImagem, FOTO_GALERIA } = await import("@/lib/imagem-cliente");
          dataUrl = (await reduzirImagem(arquivo, FOTO_GALERIA.ladoMax, FOTO_GALERIA.qualidade)).imagem.dataUrl;
        } catch {
          setMensagem({ tipo: "erro", texto: "Não foi possível ler a foto." }); return;
        }
        const d = await enviar(`${urlEq}/fotos`, { method: "POST", body: JSON.stringify({ dataUrl, itemId }) });
        if (d) { mudarEquip(eq, (x) => ({ ...x, feito: true, fotos: [...x.fotos, { id: d.id, itemId: d.itemId, criadoEm: d.criadoEm }] })); setMensagem({ tipo: "ok", texto: "Foto salva." }); }
      },
      async removerFoto(fotoId: string) {
        if (!(await confirmar({ mensagem: "Remover esta foto?", perigo: true, confirmarTexto: "Remover" }))) return;
        const d = await enviar(`${base}/execucao/fotos/${fotoId}`, { method: "DELETE" });
        if (d) mudarEquip(eq, (x) => ({ ...x, fotos: x.fotos.filter((f) => f.id !== fotoId) }));
      },
      async observarEquipamento(texto: string) {
        const d = await enviar(urlEq, { method: "PATCH", body: JSON.stringify({ observacao: texto }) });
        if (d) mudarEquip(eq, (x) => ({ ...x, feito: d.feito, observacao: d.observacao }));
      },
      async marcarAtendido(feito: boolean) {
        const d = await enviar(urlEq, { method: "PATCH", body: JSON.stringify({ feito }) });
        if (d) mudarEquip(eq, (x) => ({ ...x, feito: d.feito }));
      },
      async responderCampo(campo: CampoTela, valor: { resposta?: string | null; arquivoUrl?: string | null }) {
        if (!e.formulario) return;
        const d = await enviar(`${urlEq}/formulario`, { method: "PUT", body: JSON.stringify({ formularioId: e.formulario.id, campoId: campo.id, ...valor }) });
        if (d) mudarEquip(eq, (x) => x.formulario ? ({
          ...x, feito: d.feito ?? x.feito,
          formulario: { ...x.formulario, respostas: { ...x.formulario.respostas, [campo.id]: { resposta: d.resposta, arquivoUrl: d.arquivoUrl } } },
        }) : x);
      },
    };
  }

  async function processarScan(valor: string) {
    const d = await enviar(`${base}/scan`, { method: "POST", body: JSON.stringify({ valor }) });
    if (!d) return;
    setMensagem({ tipo: "ok", texto: d.vinculado ? `${d.nome} vinculado à atividade.` : `${d.nome} marcado como atendido.` });
    setAbertos((a) => new Set(a).add(d.equipamentoId));
    await carregar();
  }

  async function vincular(ids: string[]) {
    const d = await enviar(`${base}/equipamentos`, { method: "POST", body: JSON.stringify({ equipamentoIds: ids }) });
    if (!d) return false;
    setMensagem({ tipo: "ok", texto: ids.length === 1 ? "Equipamento vinculado." : `${ids.length} equipamentos vinculados.` });
    setAbertos((a) => new Set([...a, ids[0]]));
    await carregar();
    return true;
  }

  async function concluir() {
    if (!exec) return;
    setPendencias(null);
    if (!exec.conclusao.ok) { setPendencias({ erro: exec.conclusao.mensagem ?? "Faltam respostas.", pendencias: exec.conclusao.pendencias, servidor: false }); return; }
    const nao = exec.conclusao.naoAtendidos;
    if (nao && !(await confirmar({
      titulo: "Concluir com pendência?",
      mensagem: `${nao === 1 ? "1 equipamento vinculado não foi atendido e vai" : `${nao} equipamentos vinculados não foram atendidos e vão`} como “não atendido” no relatório.`,
      confirmarTexto: "Concluir mesmo assim", cancelarTexto: "Voltar",
    }))) return;
    setConcluindo(true);
    try {
      const r = await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CONCLUIDA" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setPendencias({ erro: d.erro ?? "Não foi possível concluir.", pendencias: d.pendencias, servidor: true }); return; }
      setMensagem({ tipo: "ok", texto: "Atividade concluída." });
      await carregar();
    } finally { setConcluindo(false); }
  }

  const resumo = useMemo(() => {
    if (!exec) return null;
    const total = exec.equipamentos.length;
    const atendidos = exec.equipamentos.filter((e) => e.feito).length;
    return { total, atendidos };
  }, [exec]);

  const somenteLeitura = !!exec?.bloqueada;
  return (
    <div className="max-w-2xl mx-auto pb-28" data-execucao>
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/ordens/${osId}`} className="p-2 -ml-2 text-ink-muted hover:text-ink" aria-label="Voltar para a OS"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="min-w-0">
          <p className="text-xs text-ink-muted font-mono">OS {osNumero}</p>
          <h1 className="text-lg font-bold text-ink truncate">{titulo}</h1>
        </div>
        {tipoOs && <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted bg-surface-page border border-surface-border px-2 py-0.5 rounded-full whitespace-nowrap"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tipoOs.cor }} aria-hidden />{tipoOs.nome}</span>}
      </div>

      {mensagem && (
        <div role={mensagem.tipo === "erro" ? "alert" : "status"} className={cn("flex items-center gap-2 text-sm rounded-lg px-3 py-2 mb-3 border",
          mensagem.tipo === "ok" ? "bg-ok-claro border-ok/20 text-ok-texto" : "bg-atrasado-claro border-atrasado/20 text-atrasado-texto")} data-mensagem>
          {mensagem.tipo === "ok" ? <CircleCheck className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />} <span className="flex-1">{mensagem.texto}</span>
          {mensagem.tipo === "erro" && <button type="button" onClick={() => setMensagem(null)} aria-label="Fechar"><X className="w-4 h-4" /></button>}
        </div>
      )}

      {!exec ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>
      ) : (
        <>
          {somenteLeitura && (
            <p className="text-sm bg-surface-page border border-surface-border text-ink rounded-lg px-3 py-2 mb-3 flex items-center gap-2" data-somente-leitura>
              <Lock className="w-4 h-4 shrink-0" /> Atividade {exec.atividade.status === "CANCELADA" ? "cancelada" : "concluída"}: só leitura. Para alterar, reabra a atividade na OS — nada do que foi respondido se perde.
            </p>
          )}

          {!somenteLeitura && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Button type="button" onClick={() => setScanAberto(true)} className="justify-center" data-ler-qr>
                <QrCode className="w-4 h-4" /> Ler QR Code
              </Button>
              <Button type="button" variant="secondary" onClick={() => setListaAberta(true)} className="justify-center" data-escolher-lista>
                <ListPlus className="w-4 h-4" /> Escolher da lista
              </Button>
            </div>
          )}

          <div className="bg-white rounded-card border border-surface-border px-4 py-3 mb-3 flex items-center justify-between gap-3" data-resumo-execucao>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{resumo!.atendidos} de {resumo!.total} equipamento{resumo!.total === 1 ? "" : "s"} atendido{resumo!.atendidos === 1 ? "" : "s"}</p>
              <p className="text-xs text-ink-muted">
                {exec.conclusao.ok && exec.conclusao.dispensa ? <span data-dispensa-equipamento={exec.conclusao.dispensa.motivo}>{exec.conclusao.dispensa.texto}</span>
                  : exec.conclusao.ok ? "Tudo respondido: pronto para concluir." : exec.conclusao.semEquipamento ? "Nenhum equipamento atendido ainda." : `${exec.conclusao.pendencias.length} equipamento${exec.conclusao.pendencias.length === 1 ? "" : "s"} com pendência.`}
              </p>
            </div>
            {exec.conclusao.ok ? <CircleCheck className="w-6 h-6 text-success-600 shrink-0" /> : <ClipboardCheck className="w-6 h-6 text-ink-subtle shrink-0" />}
          </div>

          {exec.equipamentos.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8 flex flex-col items-center gap-2 bg-white rounded-card border border-dashed border-surface-border" data-sem-equipamentos>
              <HardDrive className="w-6 h-6 text-ink-subtle" />
              Nenhum equipamento nesta atividade.
              {!somenteLeitura && (exec.conclusao.dispensa
                ? <span className="text-xs text-ink-muted px-6">{exec.conclusao.dispensa.texto}</span>
                : <span className="text-xs text-ink-muted px-6">Leia o QR Code do equipamento ou escolha na lista da unidade. Para concluir, é preciso pelo menos 1 equipamento atendido.</span>)}
            </p>
          ) : (
            <div className="space-y-3">
              {exec.equipamentos.map((e) => (
                <EquipamentoExecucaoCard key={e.equipamento.id} e={e} somenteLeitura={somenteLeitura}
                  aberto={abertos.has(e.equipamento.id)}
                  onAlternar={() => setAbertos((a) => { const n = new Set(a); if (n.has(e.equipamento.id)) n.delete(e.equipamento.id); else n.add(e.equipamento.id); return n; })}
                  acoes={acoesDe(e)} />
              ))}
            </div>
          )}

          {pendencias && (pendencias.servidor || !exec.conclusao.ok) && (
            <div role="alert" className="mt-4 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto rounded-card px-4 py-3 text-sm space-y-2" data-pendencias>
              <p className="font-semibold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Ainda não dá para concluir</p>
              {exec.conclusao.semEquipamento ? (
                <>
                  <p>{exec.conclusao.mensagem}</p>
                  <ConcluirSemEquipamento osId={osId} atividadeId={atividadeId}
                    onConcluido={async () => { setPendencias(null); setMensagem({ tipo: "ok", texto: "Atividade concluída sem equipamento." }); await carregar(); }} />
                </>
              ) : (
                <ul className="space-y-1.5 list-disc pl-5">
                  {exec.conclusao.pendencias.map((p) => <li key={p.equipamentoId}><strong>{p.titulo}</strong>: {textoFaltas(p)}.</li>)}
                </ul>
              )}
              {exec.conclusao.ok && <p>{pendencias.erro}</p>}
            </div>
          )}

          {!somenteLeitura && (
            <div className="fixed inset-x-0 z-30 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] bg-white/95 backdrop-blur border-t border-surface-border px-4 py-3 md:static md:bg-transparent md:border-0 md:px-0 md:mt-5" data-barra-concluir>
              <div className="max-w-2xl mx-auto">
                <Button type="button" variant={exec.conclusao.ok ? "success" : "secondary"} onClick={concluir} loading={concluindo} className="w-full justify-center" data-concluir>
                  <CircleCheck className="w-4 h-4" /> Concluir atividade
                </Button>
              </div>
            </div>
          )}

          {listaAberta && <ListaEquipamentos clienteId={exec.os.clienteId} unidadeId={exec.os.unidadeId} jaVinculados={exec.equipamentos.map((e) => e.equipamento.id)}
            onFechar={() => setListaAberta(false)} onVincular={async (ids) => { if (await vincular(ids)) setListaAberta(false); }} />}
        </>
      )}

      {scanAberto && <ScannerQR onFechar={() => setScanAberto(false)} onLer={(valor) => { setScanAberto(false); processarScan(valor); }} />}
    </div>
  );
}

// ─────────────────────────────────────────────
// Lista da unidade (vincular equipamento escolhendo)
// ─────────────────────────────────────────────
function ListaEquipamentos({ clienteId, unidadeId, jaVinculados, onFechar, onVincular }: {
  clienteId: string; unidadeId: string | null; jaVinculados: string[]; onFechar: () => void; onVincular: (ids: string[]) => Promise<void>;
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" data-lista-equipamentos>
      <div className="bg-white w-full sm:max-w-md sm:rounded-card rounded-t-card overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-linha">
          <span className="text-sm font-semibold text-ink">Equipamentos {unidadeId ? "da unidade" : "do cliente"}</span>
          <button onClick={onFechar} className="text-ink-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SeletorEquipamentos clienteId={clienteId} unidadeId={unidadeId} excluir={jaVinculados} marcados={marcados} onChange={setMarcados} />
        </div>
        <div className="p-3 border-t border-surface-linha">
          <Button type="button" className="w-full justify-center" disabled={!marcados.size} loading={salvando} data-vincular
            onClick={async () => { setSalvando(true); try { await onVincular([...marcados]); } finally { setSalvando(false); } }}>
            Vincular {marcados.size ? `(${marcados.size})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}
