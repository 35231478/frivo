"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, QrCode, X, CircleCheck, AlertCircle, Loader2, HardDrive, ListPlus, Lock, ClipboardCheck,
} from "lucide-react";
import { EquipamentoExecucaoCard, type AcoesEquipamento, type CampoTela, type EquipamentoTela } from "@/components/os/execucao-equipamento";
import { completo, faltasEquipamento, paraPendencia, textoFaltas, verificarConclusao, type ResultadoConclusao, type StatusItem } from "@/lib/execucao/pendencias";

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
}
type Pendencias = { erro: string; pendencias?: { equipamentoId: string; titulo: string }[] };

/** Recalcula, na tela, o que falta (as MESMAS regras do servidor) depois de cada resposta. */
function recalcular(x: ExecucaoTela): ExecucaoTela {
  const equipamentos = x.equipamentos.map((e) => {
    const faltas = faltasEquipamento(paraPendencia(e));
    return { ...e, faltas, completo: completo(faltas) };
  });
  return { ...x, equipamentos, conclusao: verificarConclusao(equipamentos.map((e) => paraPendencia(e))) };
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
        mudarEquip(eq, (x) => ({ ...x, feito: true, respostas: { ...x.respostas, [itemId]: { status, observacao: antes?.observacao ?? null } } }));
        const d = await enviar(`${urlEq}/itens/${itemId}`, { method: "PUT", body: JSON.stringify({ status }) });
        if (!d) mudarEquip(eq, (x) => ({ ...x, feito: e.feito, respostas: { ...x.respostas, [itemId]: antes ?? { status: null, observacao: null } } }));
      },
      async observarItem(itemId: string, texto: string) {
        const d = await enviar(`${urlEq}/itens/${itemId}`, { method: "PUT", body: JSON.stringify({ observacao: texto }) });
        if (d) mudarEquip(eq, (x) => ({ ...x, feito: d.feito ?? x.feito, respostas: { ...x.respostas, [itemId]: { status: d.status, observacao: d.observacao } } }));
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
        if (!window.confirm("Remover esta foto?")) return;
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
    if (!exec.conclusao.ok) { setPendencias({ erro: exec.conclusao.mensagem ?? "Faltam respostas.", pendencias: exec.conclusao.pendencias }); return; }
    const nao = exec.conclusao.naoAtendidos;
    if (nao && !window.confirm(`${nao === 1 ? "1 equipamento vinculado não foi atendido e vai" : `${nao} equipamentos vinculados não foram atendidos e vão`} como “não atendido” no relatório. Concluir mesmo assim?`)) return;
    setConcluindo(true);
    try {
      const r = await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CONCLUIDA" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setPendencias({ erro: d.erro ?? "Não foi possível concluir.", pendencias: d.pendencias }); return; }
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
        <Link href={`/ordens/${osId}`} className="p-2 -ml-2 text-gray-500 hover:text-gray-800" aria-label="Voltar para a OS"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="min-w-0">
          <p className="text-xs text-gray-400 font-mono">OS {osNumero}</p>
          <h1 className="text-lg font-bold text-gray-900 truncate">{titulo}</h1>
        </div>
        {tipoOs && <span className="ml-auto text-[11px] font-medium text-white px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: tipoOs.cor }}>{tipoOs.nome}</span>}
      </div>

      {mensagem && (
        <div role={mensagem.tipo === "erro" ? "alert" : "status"} className={cn("flex items-center gap-2 text-sm rounded-lg px-3 py-2 mb-3 border",
          mensagem.tipo === "ok" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700")} data-mensagem>
          {mensagem.tipo === "ok" ? <CircleCheck className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />} <span className="flex-1">{mensagem.texto}</span>
          {mensagem.tipo === "erro" && <button type="button" onClick={() => setMensagem(null)} aria-label="Fechar"><X className="w-4 h-4" /></button>}
        </div>
      )}

      {!exec ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
      ) : (
        <>
          {somenteLeitura && (
            <p className="text-sm bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-3 py-2 mb-3 flex items-center gap-2" data-somente-leitura>
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

          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 mb-3 flex items-center justify-between gap-3" data-resumo-execucao>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">{resumo!.atendidos} de {resumo!.total} equipamento{resumo!.total === 1 ? "" : "s"} atendido{resumo!.atendidos === 1 ? "" : "s"}</p>
              <p className="text-xs text-gray-500">
                {exec.conclusao.ok ? "Tudo respondido: pronto para concluir." : exec.conclusao.semEquipamento ? "Nenhum equipamento atendido ainda." : `${exec.conclusao.pendencias.length} equipamento${exec.conclusao.pendencias.length === 1 ? "" : "s"} com pendência.`}
              </p>
            </div>
            {exec.conclusao.ok ? <CircleCheck className="w-6 h-6 text-success-600 shrink-0" /> : <ClipboardCheck className="w-6 h-6 text-gray-300 shrink-0" />}
          </div>

          {exec.equipamentos.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8 flex flex-col items-center gap-2 bg-white rounded-xl border border-dashed border-gray-200" data-sem-equipamentos>
              <HardDrive className="w-6 h-6 text-gray-300" />
              Nenhum equipamento nesta atividade.
              {!somenteLeitura && <span className="text-xs text-gray-400 px-6">Leia o QR Code do equipamento ou escolha na lista da unidade. Para concluir, é preciso pelo menos 1 equipamento atendido.</span>}
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

          {pendencias && (
            <div role="alert" className="mt-4 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm space-y-2" data-pendencias>
              <p className="font-semibold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Ainda não dá para concluir</p>
              {exec.conclusao.semEquipamento ? <p>{exec.conclusao.mensagem}</p> : (
                <ul className="space-y-1.5 list-disc pl-5">
                  {exec.conclusao.pendencias.map((p) => <li key={p.equipamentoId}><strong>{p.titulo}</strong>: {textoFaltas(p)}.</li>)}
                </ul>
              )}
              {exec.conclusao.ok && <p>{pendencias.erro}</p>}
            </div>
          )}

          {!somenteLeitura && (
            <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-gray-200 px-4 py-3 md:static md:bg-transparent md:border-0 md:px-0 md:mt-5">
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
interface EquipLista { id: string; nome?: string | null; marca: string; modelo: string; localizacao?: string | null; patrimonio?: string | null; ativo?: boolean; tipoEquipamento?: { nome: string } | null }
function ListaEquipamentos({ clienteId, unidadeId, jaVinculados, onFechar, onVincular }: {
  clienteId: string; unidadeId: string | null; jaVinculados: string[]; onFechar: () => void; onVincular: (ids: string[]) => Promise<void>;
}) {
  const [lista, setLista] = useState<EquipLista[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    const qs = unidadeId ? `unidadeId=${unidadeId}` : `clienteId=${clienteId}`;
    fetch(`/api/equipamentos?${qs}`).then((r) => r.json()).then((d) => setLista(Array.isArray(d) ? d : [])).catch(() => setLista([]));
  }, [clienteId, unidadeId]);
  const ja = new Set(jaVinculados);
  const termo = busca.trim().toLowerCase();
  const candidatos = (lista ?? []).filter((e) => e.ativo !== false && !ja.has(e.id))
    .filter((e) => !termo || [e.nome, e.marca, e.modelo, e.localizacao, e.patrimonio, e.tipoEquipamento?.nome].some((v) => (v ?? "").toLowerCase().includes(termo)));
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" data-lista-equipamentos>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-800">Equipamentos {unidadeId ? "da unidade" : "do cliente"}</span>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3 border-b border-gray-100"><Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, TAG, local…" aria-label="Buscar equipamento" /></div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {lista === null && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>}
          {lista !== null && candidatos.length === 0 && <p className="text-sm text-gray-400 text-center py-6">{(lista ?? []).length ? "Nenhum outro equipamento para vincular." : "Nenhum equipamento cadastrado neste local."}</p>}
          {candidatos.map((e) => (
            <label key={e.id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2.5 cursor-pointer hover:border-primary-200" data-opcao-equipamento={e.id}>
              <input type="checkbox" className="accent-primary-600 w-4 h-4" checked={marcados.has(e.id)}
                onChange={() => setMarcados((m) => { const n = new Set(m); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />
              <span className="min-w-0">
                <span className="block text-sm text-gray-800 truncate">{e.nome ? `${e.nome} — ` : ""}{e.marca} {e.modelo}</span>
                <span className="block text-[11px] text-gray-400">{[e.tipoEquipamento?.nome, e.localizacao, e.patrimonio && `TAG ${e.patrimonio}`].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="p-3 border-t border-gray-100">
          <Button type="button" className="w-full justify-center" disabled={!marcados.size} loading={salvando} data-vincular
            onClick={async () => { setSalvando(true); try { await onVincular([...marcados]); } finally { setSalvando(false); } }}>
            Vincular {marcados.size ? `(${marcados.size})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Scanner de QR (BarcodeDetector + fallback manual)
// ─────────────────────────────────────────────
function ScannerQR({ onFechar, onLer }: { onFechar: () => void; onLer: (valor: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [suportado, setSuportado] = useState<boolean | null>(null);
  const [manual, setManual] = useState("");
  const [erroCam, setErroCam] = useState("");

  useEffect(() => {
    const hasDetector = typeof window !== "undefined" && "BarcodeDetector" in window;
    setSuportado(hasDetector);
    if (!hasDetector) return;

    let stream: MediaStream | null = null;
    let cancelado = false;
    // @ts-expect-error BarcodeDetector ainda não está no lib DOM padrão
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelado) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const loop = async () => {
          if (cancelado || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0].rawValue) { onLer(codes[0].rawValue); return; }
          } catch { /* ignora frames inválidos */ }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      } catch {
        setErroCam("Não foi possível acessar a câmera. Use a entrada manual.");
      }
    })();

    return () => { cancelado = true; if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [onLer]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-800">Escanear QR Code do equipamento</span>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          {suportado === null && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>}

          {suportado && (
            <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <div className="absolute inset-8 border-2 border-white/70 rounded-lg pointer-events-none" />
            </div>
          )}
          {erroCam && <p className="text-xs text-amber-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {erroCam}</p>}
          {suportado === false && (
            <p className="text-xs text-gray-500">Seu navegador não suporta leitura de QR pela câmera. Digite o código do equipamento abaixo.</p>
          )}

          <div className="space-y-2 pt-1">
            <label className="text-xs font-medium text-gray-500">Entrada manual (código ou link do QR)</label>
            <div className="flex gap-2">
              <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Ex: QR-2026-0001" className="flex-1" />
              <Button type="button" onClick={() => manual.trim() && onLer(manual.trim())} disabled={!manual.trim()}>Confirmar</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
