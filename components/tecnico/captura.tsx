"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Mic, Square, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────── Foto: câmera do celular, comprimida no aparelho (~200–400 KB) ───────── */

export function BotaoFoto({ onFoto, rotulo = "Tirar foto", grande, desabilitado, className }: {
  onFoto: (dataUrl: string) => void | Promise<void>; rotulo?: string; grande?: boolean; desabilitado?: boolean; className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <>
      <button type="button" disabled={desabilitado || lendo} onClick={() => ref.current?.click()}
        className={cn("inline-flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary-300 bg-primary-50 text-primary-700 font-semibold touch-target disabled:opacity-50",
          grande ? "px-4 py-4 text-base w-full" : "px-3 py-2 text-sm", className)}>
        {lendo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />} {rotulo}
      </button>
      {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" data-foto-input onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setLendo(true); setErro(null);
        try {
          const { reduzirImagem, FOTO_GALERIA } = await import("@/lib/imagem-cliente");
          const { imagem } = await reduzirImagem(f, FOTO_GALERIA.ladoMax, FOTO_GALERIA.qualidade);
          await onFoto(imagem.dataUrl);
        } catch {
          setErro("Não foi possível ler a foto. Tente de novo.");
        } finally { setLendo(false); }
      }} />
    </>
  );
}

export function Miniatura({ src, alt, pendente, onRemover }: { src: string; alt: string; pendente?: boolean; onRemover?: () => void }) {
  return (
    <div className="relative w-20 h-20 shrink-0" data-miniatura>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="w-20 h-20 rounded-lg object-cover border border-surface-border bg-surface-alt" />
      {pendente && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">no aparelho</span>}
      {onRemover && (
        <button type="button" aria-label={`Tirar ${alt}`} onClick={onRemover} className="absolute -top-2 -right-2 rounded-full bg-white border border-surface-border p-1 shadow">
          <X className="w-3.5 h-3.5 text-ink-muted" />
        </button>
      )}
    </div>
  );
}

/* ───────── Observação por VOZ ─────────
 * Com sinal: dita (reconhecimento de voz do celular, pt-BR) e o texto entra no campo na hora.
 * Sem sinal: grava o áudio (fica no aparelho e sobe na sincronização; vale como observação) — ou digita.
 */

type Reconhecedor = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };
const ctorReconhecedor = (): (new () => Reconhecedor) | null =>
  typeof window === "undefined" ? null : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);
const podeGravar = () => typeof window !== "undefined" && typeof (window as any).MediaRecorder === "function" && !!navigator.mediaDevices?.getUserMedia;

const MAX_AUDIO_S = 120;

function blobParaDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => falha(r.error); r.readAsDataURL(b); });
}

export function ObservacaoVoz({ valor, onSalvar, aoDigitar, audio, onAudio, rotulo = "Observação", obrigatoria, desabilitado, placeholder, autoFocus }: {
  valor: string; onSalvar: (texto: string) => void;
  /** A cada letra (para habilitar um botão sem esperar sair do campo) */
  aoDigitar?: (texto: string) => void;
  /** Áudio atual (src para ouvir) — null = sem áudio */
  audio?: string | null; onAudio?: (dataUrl: string | null) => void;
  rotulo?: string; obrigatoria?: boolean; desabilitado?: boolean; placeholder?: string; autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState(valor);
  const [ouvindo, setOuvindo] = useState(false);
  const [gravando, setGravando] = useState(0); // segundos (0 = parado)
  const [aviso, setAviso] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const rec = useRef<Reconhecedor | null>(null);
  const gravador = useRef<{ parar: () => void } | null>(null);
  const base = useRef(valor);

  useEffect(() => { setTexto(valor); base.current = valor; }, [valor]);
  useEffect(() => {
    const atualizar = () => setOnline(navigator.onLine !== false);
    atualizar();
    window.addEventListener("online", atualizar); window.addEventListener("offline", atualizar);
    return () => { window.removeEventListener("online", atualizar); window.removeEventListener("offline", atualizar); rec.current?.stop(); gravador.current?.parar(); };
  }, []);

  const salvar = (t: string) => { if (t.trim() !== (valor ?? "").trim()) onSalvar(t.trim()); };
  const Reconhecedor = ctorReconhecedor();
  const ditar = Reconhecedor && online && !desabilitado;
  const gravar = onAudio && podeGravar() && !desabilitado;

  function iniciarDitado() {
    if (!Reconhecedor) return;
    setAviso(null);
    const r = new Reconhecedor();
    r.lang = "pt-BR"; r.interimResults = true; r.continuous = false;
    const antes = texto.trim();
    let ultimo = texto;
    r.onresult = (e: any) => {
      let falado = "";
      for (let i = 0; i < e.results.length; i++) falado += e.results[i][0].transcript;
      ultimo = [antes, falado.trim()].filter(Boolean).join(" ");
      setTexto(ultimo);
      aoDigitar?.(ultimo);
    };
    r.onerror = (e: any) => {
      setAviso(e?.error === "network" ? "Sem sinal para ditar: grave um áudio ou digite." : e?.error === "not-allowed" ? "Libere o microfone para ditar." : "Não entendi. Tente de novo ou digite.");
    };
    r.onend = () => { setOuvindo(false); rec.current = null; salvar(ultimo); };
    rec.current = r;
    setOuvindo(true);
    r.start();
  }

  async function iniciarGravacao() {
    setAviso(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const MR = (window as any).MediaRecorder;
      const tipo = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((t) => MR.isTypeSupported?.(t));
      const mr = new MR(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : undefined);
      const pedacos: Blob[] = [];
      mr.ondataavailable = (ev: BlobEvent) => { if (ev.data.size) pedacos.push(ev.data); };
      let s = 0;
      const relogio = setInterval(() => { s += 1; setGravando(s); if (s >= MAX_AUDIO_S) parar(); }, 1000);
      const parar = () => { clearInterval(relogio); if (mr.state !== "inactive") mr.stop(); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(0); gravador.current = null;
        if (!pedacos.length) return;
        onAudio?.(await blobParaDataUrl(new Blob(pedacos, { type: mr.mimeType || tipo || "audio/webm" })));
      };
      gravador.current = { parar };
      setGravando(1);
      mr.start();
    } catch {
      setAviso("Não foi possível usar o microfone. Libere o acesso ou digite.");
    }
  }

  return (
    <div className="space-y-2" data-observacao-voz>
      <label className="block text-sm font-semibold text-ink">
        {rotulo}{obrigatoria && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      <textarea value={texto} rows={2} disabled={desabilitado} autoFocus={autoFocus} placeholder={placeholder ?? "Escreva, dite ou grave um áudio"}
        onChange={(e) => { setTexto(e.target.value); aoDigitar?.(e.target.value); }} onBlur={(e) => salvar(e.target.value)} aria-label={rotulo}
        className="w-full rounded-xl border border-surface-border px-3 py-2.5 text-base focus:outline-none focus:ring-4 focus:ring-primary-500/20 disabled:bg-surface-alt" />
      <div className="flex flex-wrap items-center gap-2">
        {ditar && (
          <button type="button" onClick={() => (ouvindo ? rec.current?.stop() : iniciarDitado())} data-ditar
            className={cn("inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold touch-target", ouvindo ? "bg-red-600 text-white animate-pulse" : "bg-primary-50 text-primary-700 border border-primary-200")}>
            <Mic className="w-4 h-4" /> {ouvindo ? "Ouvindo… toque para parar" : "Ditar"}
          </button>
        )}
        {gravar && !audio && (
          <button type="button" onClick={() => (gravando ? gravador.current?.parar() : iniciarGravacao())} data-gravar
            className={cn("inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold touch-target", gravando ? "bg-red-600 text-white" : "bg-white text-ink border border-surface-border")}>
            {gravando ? <><Square className="w-4 h-4" /> Parar ({gravando}s)</> : <><span className="w-2.5 h-2.5 rounded-full bg-red-600" /> Gravar áudio</>}
          </button>
        )}
        {!online && !ditar && (
          <span className="text-xs text-ink-muted">
            {gravar ? "Sem sinal: grave um áudio ou digite (o áudio sobe quando o sinal voltar)." : "Sem sinal: digite (o ditado volta quando houver sinal)."}
          </span>
        )}
      </div>
      {audio && (
        <div className="flex items-center gap-2 rounded-xl bg-surface-alt border border-surface-border p-2" data-audio>
          <audio controls src={audio} className="h-9 flex-1 min-w-0" preload="none" />
          {onAudio && !desabilitado && (
            <button type="button" onClick={() => onAudio(null)} aria-label="Apagar áudio" className="p-2 text-ink-muted hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
          )}
        </div>
      )}
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
    </div>
  );
}
