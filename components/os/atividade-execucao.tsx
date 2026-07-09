"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, QrCode, Camera, Check, X, CircleCheck, CircleDashed, ClipboardList,
  HardDrive, AlertCircle, Loader2,
} from "lucide-react";

interface Props {
  osId: string;
  atividadeId: string;
  titulo: string;
  osNumero: string;
  tipoOs: { id: string; nome: string; cor: string } | null;
}

interface Vinculo {
  id: string;
  feito: boolean;
  equipamento: { id: string; nome?: string | null; marca: string; modelo: string; localizacao?: string | null; tipoEquipamento?: { id: string; nome: string } | null };
}

type Campo = { id: string; label: string; tipo: string; obrigatorio: boolean; ordem: number; opcoes?: any };
type Grupo = { tipoEquipamentoId: string; tipoEquipamentoNome: string; formulario: { id: string; nome: string; campos: Campo[] }; obrigatorioConcluir?: boolean; obrigatorioImpedimento?: boolean; equipamentos: any[]; resumo: { total: number; feitos: number; respondidos: number } };
type FormsData = { grupos: Grupo[]; tiposSemFormulario: { id: string; nome: string; qtd: number }[] };

function rotulo(e: Vinculo["equipamento"]) {
  const base = `${e.marca} ${e.modelo}`.trim();
  return e.nome ? `${e.nome} — ${base}` : base;
}
function normalizarOpcoes(opcoes: any): string[] {
  if (Array.isArray(opcoes)) return opcoes.map(String);
  if (opcoes && Array.isArray(opcoes.opcoes)) return opcoes.opcoes.map(String);
  return [];
}

export function AtividadeExecucao({ osId, atividadeId, titulo, osNumero, tipoOs }: Props) {
  const base = `/api/ordens/${osId}/atividades/${atividadeId}`;
  const [vinculos, setVinculos] = useState<Vinculo[]>([]);
  const [forms, setForms] = useState<FormsData | null>(null);
  const [respondendo, setRespondendo] = useState(false);
  const [scanAberto, setScanAberto] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregarVinculos = useCallback(() => {
    fetch(`${base}/equipamentos`).then((r) => r.json()).then((d) => setVinculos(Array.isArray(d) ? d : [])).catch(() => {});
  }, [base]);
  const carregarForms = useCallback(() => {
    fetch(`${base}/formularios`).then((r) => r.json()).then(setForms).catch(() => {});
  }, [base]);

  useEffect(() => { carregarVinculos(); carregarForms(); }, [carregarVinculos, carregarForms]);

  useEffect(() => {
    if (!mensagem) return;
    const t = setTimeout(() => setMensagem(null), 3500);
    return () => clearTimeout(t);
  }, [mensagem]);

  async function alternarFeito(v: Vinculo, feito: boolean) {
    const res = await fetch(`${base}/equipamentos/${v.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feito }),
    });
    if (res.ok) { carregarVinculos(); carregarForms(); }
  }

  async function processarScan(valor: string) {
    const res = await fetch(`${base}/scan`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valor }),
    });
    const data = await res.json();
    if (res.ok) {
      setMensagem({ tipo: "ok", texto: `${data.nome} marcado como feito.` });
      carregarVinculos(); carregarForms();
    } else {
      setMensagem({ tipo: "erro", texto: data?.erro ?? "QR Code não reconhecido." });
    }
  }

  // Agrupa equipamentos por tipo p/ a lista
  const grupos = new Map<string, { nome: string; itens: Vinculo[] }>();
  for (const v of vinculos) {
    const tid = v.equipamento.tipoEquipamento?.id ?? "sem-tipo";
    const nome = v.equipamento.tipoEquipamento?.nome ?? "Sem tipo";
    if (!grupos.has(tid)) grupos.set(tid, { nome, itens: [] });
    grupos.get(tid)!.itens.push(v);
  }
  const algumFeito = vinculos.some((v) => v.feito);
  const gruposParaResponder = (forms?.grupos ?? []).filter((g) => g.resumo.feitos > 0);

  return (
    <div className="max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/ordens/${osId}`} className="p-2 -ml-2 text-gray-500 hover:text-gray-800"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="min-w-0">
          <p className="text-xs text-gray-400 font-mono">OS {osNumero}</p>
          <h1 className="text-lg font-bold text-gray-900 truncate">{titulo}</h1>
        </div>
        {tipoOs && <span className="ml-auto text-[11px] font-medium text-white px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: tipoOs.cor }}>{tipoOs.nome}</span>}
      </div>

      {mensagem && (
        <div className={cn("flex items-center gap-2 text-sm rounded-lg px-3 py-2 mb-3 border",
          mensagem.tipo === "ok" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700")}>
          {mensagem.tipo === "ok" ? <CircleCheck className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />} {mensagem.texto}
        </div>
      )}

      {/* Botão escanear */}
      <Button type="button" onClick={() => setScanAberto(true)} className="w-full justify-center mb-4">
        <QrCode className="w-4 h-4" /> Escanear QR Code
      </Button>

      {/* Lista de equipamentos por tipo */}
      {vinculos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8 flex flex-col items-center gap-2">
          <HardDrive className="w-6 h-6 text-gray-300" /> Nenhum equipamento nesta atividade.
        </p>
      ) : (
        <div className="space-y-3">
          {[...grupos.entries()].map(([tid, g]) => (
            <div key={tid} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-600 uppercase">{g.nome}</span>
                <span className="text-[10px] text-gray-400">{g.itens.filter((i) => i.feito).length}/{g.itens.length} feitos</span>
              </div>
              <div className="divide-y divide-gray-50">
                {g.itens.map((v) => (
                  <button key={v.id} type="button" onClick={() => alternarFeito(v, !v.feito)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                    <span className={cn("w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2",
                      v.feito ? "bg-green-500 border-green-500 text-white" : "border-gray-300 text-transparent")}>
                      <Check className="w-3.5 h-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-800 truncate">{rotulo(v.equipamento)}</span>
                      {v.equipamento.localizacao && <span className="block text-[11px] text-gray-400">{v.equipamento.localizacao}</span>}
                    </span>
                    <span className={cn("ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap",
                      v.feito ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-400")}>
                      {v.feito ? "Feito" : "Não feito"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Responder formulários */}
      <div className="mt-5">
        <Button type="button" variant={algumFeito ? "primary" : "secondary"} disabled={!algumFeito}
          onClick={() => setRespondendo((r) => !r)} className="w-full justify-center">
          <ClipboardList className="w-4 h-4" /> {respondendo ? "Ocultar formulários" : "Responder formulários"}
        </Button>
        {!algumFeito && <p className="text-[11px] text-gray-400 text-center mt-1.5">Marque ao menos um equipamento como feito para liberar.</p>}
      </div>

      {respondendo && (
        <div className="mt-4 space-y-4">
          {gruposParaResponder.length === 0 && (
            <p className="text-xs text-gray-400 text-center">Nenhum grupo com formulário e equipamentos feitos.</p>
          )}
          {gruposParaResponder.map((g) => (
            <FormularioGrupo
              key={g.tipoEquipamentoId}
              base={base}
              grupo={g}
              onSalvo={(qtd) => { setMensagem({ tipo: "ok", texto: `Respostas replicadas para ${qtd} equipamento(s).` }); carregarForms(); }}
              onErro={(txt) => setMensagem({ tipo: "erro", texto: txt })}
            />
          ))}
        </div>
      )}

      {scanAberto && <ScannerQR onFechar={() => setScanAberto(false)} onLer={(valor) => { setScanAberto(false); processarScan(valor); }} />}
    </div>
  );
}

// ─────────────────────────────────────────────
// Formulário de um grupo (preenchido uma vez)
// ─────────────────────────────────────────────
function FormularioGrupo({ base, grupo, onSalvo, onErro }: {
  base: string; grupo: Grupo; onSalvo: (qtd: number) => void; onErro: (t: string) => void;
}) {
  const [valores, setValores] = useState<Record<string, { resposta?: string | null; arquivoUrl?: string | null }>>({});
  const [salvando, setSalvando] = useState(false);
  const fotoRef = useRef<HTMLInputElement>(null);
  const campoFoto = useRef<string | null>(null);
  const feitos = grupo.resumo.feitos;

  function set(campoId: string, patch: { resposta?: string | null; arquivoUrl?: string | null }) {
    setValores((p) => ({ ...p, [campoId]: { ...p[campoId], ...patch } }));
  }
  function escolherFoto(campoId: string) { campoFoto.current = campoId; fotoRef.current?.click(); }
  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; const campoId = campoFoto.current;
    if (fotoRef.current) fotoRef.current.value = "";
    if (!file || !campoId) return;
    if (file.size > 3 * 1024 * 1024) { onErro("Foto muito grande. Máximo 3 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => set(campoId, { arquivoUrl: typeof reader.result === "string" ? reader.result : null });
    reader.readAsDataURL(file);
  }

  async function salvar() {
    for (const c of grupo.formulario.campos) {
      if (!c.obrigatorio) continue;
      const v = valores[c.id];
      if (c.tipo === "FOTO" || c.tipo === "ASSINATURA") { if (!v?.arquivoUrl) { onErro(`Preencha: ${c.label}`); return; } }
      else if (!v?.resposta) { onErro(`Preencha: ${c.label}`); return; }
    }
    setSalvando(true);
    try {
      const respostas = grupo.formulario.campos.map((c) => ({
        campoId: c.id,
        resposta: valores[c.id]?.resposta ?? null,
        arquivoUrl: valores[c.id]?.arquivoUrl ?? null,
      }));
      const res = await fetch(`${base}/grupos/respostas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipoEquipamentoId: grupo.tipoEquipamentoId, formularioId: grupo.formulario.id, respostas }),
      });
      const data = await res.json();
      if (res.ok) onSalvo(data.equipamentosAtualizados ?? feitos);
      else onErro(data?.erro ?? "Erro ao salvar.");
    } catch { onErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-frivo-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-frivo-50/40 border-b border-frivo-100">
        <p className="text-sm font-semibold text-frivo-800 flex items-center gap-2 flex-wrap">
          {grupo.tipoEquipamentoNome}
          {grupo.obrigatorioConcluir && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" /> Obrigatório para concluir
            </span>
          )}
        </p>
        <p className="text-[11px] text-gray-500">{grupo.formulario.nome} · será aplicado a {feitos} equipamento(s) feito(s)</p>
      </div>
      <input ref={fotoRef} type="file" accept="image/*" capture="environment" onChange={handleFoto} className="hidden" />
      <div className="p-4 space-y-4">
        {grupo.formulario.campos.map((c) => {
          const v = valores[c.id];
          return (
            <div key={c.id} className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">{c.label}{c.obrigatorio && <span className="text-red-500 ml-0.5">*</span>}</label>

              {c.tipo === "TEXTO_CURTO" && <Input value={v?.resposta ?? ""} onChange={(e) => set(c.id, { resposta: e.target.value })} />}
              {c.tipo === "TEXTO_LONGO" && <Textarea rows={2} value={v?.resposta ?? ""} onChange={(e) => set(c.id, { resposta: e.target.value })} />}
              {c.tipo === "NUMERO" && <Input type="number" value={v?.resposta ?? ""} onChange={(e) => set(c.id, { resposta: e.target.value })} />}
              {c.tipo === "DATA" && <Input type="date" value={v?.resposta ?? ""} onChange={(e) => set(c.id, { resposta: e.target.value })} />}
              {c.tipo === "ASSINATURA" && <Input value={v?.resposta ?? ""} placeholder="Nome de quem assina" onChange={(e) => set(c.id, { resposta: e.target.value, arquivoUrl: e.target.value })} />}

              {c.tipo === "SIM_NAO" && (
                <div className="flex gap-2">
                  {["Sim", "Não"].map((op) => (
                    <button key={op} type="button" onClick={() => set(c.id, { resposta: op })}
                      className={cn("px-4 py-2 rounded-lg text-sm font-medium border",
                        v?.resposta === op ? "bg-frivo-600 border-frivo-600 text-white" : "bg-white border-gray-200 text-gray-600")}>
                      {op}
                    </button>
                  ))}
                </div>
              )}

              {c.tipo === "MULTIPLA_ESCOLHA" && (
                <Select value={v?.resposta ?? ""} onChange={(e) => set(c.id, { resposta: e.target.value })} placeholder="Selecione">
                  {normalizarOpcoes(c.opcoes).map((op) => (<option key={op} value={op}>{op}</option>))}
                </Select>
              )}

              {c.tipo === "FOTO" && (
                <div className="flex items-center gap-3">
                  {v?.arquivoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.arquivoUrl} alt={c.label} className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                  )}
                  <Button type="button" variant="secondary" onClick={() => escolherFoto(c.id)} className="text-xs h-auto py-1.5 px-3">
                    <Camera className="w-4 h-4" /> {v?.arquivoUrl ? "Trocar" : "Tirar foto"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        <Button type="button" loading={salvando} onClick={salvar} className="w-full justify-center">
          <Check className="w-4 h-4" /> Salvar e replicar
        </Button>
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
