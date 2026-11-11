"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MSG_FOTO_INVALIDA, MSG_FOTO_SEM_QR, MSG_SEM_API_CAMERA, abrirCamera, detectorNativo, lerQrDaFoto, lerQrDoVideo, motivoSemCamera, pararCamera,
  type DetectorNativo, type MotorQr,
} from "@/lib/qr/leitor";

/** De quanto em quanto tempo (ms) um quadro da câmera é lido */
const INTERVALO_LEITURA_MS = 140;
/** Depois de quantas falhas seguidas do detector nativo a leitura passa para o jsQR */
const FALHAS_DO_NATIVO = 3;

/**
 * Leitor de QR Code. Funciona em qualquer navegador — inclusive iPhone (Safari e Chrome do iOS):
 * lê pela câmera com o detector nativo quando existe e, onde não existe (WebKit) ou falha, com o jsQR
 * (pixels do canvas). A leitura é toda no aparelho: funciona sem sinal.
 * O técnico nunca fica sem saída: câmera ao vivo, FOTO do QR (quando a câmera não abre ou o
 * navegador bloqueia) e o código digitado — as três sempre à mão.
 */
export function ScannerQR({ onFechar, onLer }: { onFechar: () => void; onLer: (valor: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  // O pai costuma passar uma função nova a cada render: guardada aqui, a câmera não reinicia por isso
  const aoLer = useRef(onLer);
  useEffect(() => { aoLer.current = onLer; }, [onLer]);
  const lido = useRef(false);
  const nativo = useRef<DetectorNativo | null>(null);

  const [fase, setFase] = useState<"abrindo" | "lendo" | "sem-camera">("abrindo");
  const [motor, setMotor] = useState<MotorQr | null>(null);
  const [aviso, setAviso] = useState("");
  const [lendoFoto, setLendoFoto] = useState(false);
  const [manual, setManual] = useState("");
  const [tentativa, setTentativa] = useState(0);

  /** Entrega o que foi lido — uma vez só (dois quadros seguidos com o mesmo QR não viram dois vínculos) */
  const entregar = useCallback((valor: string) => {
    const v = valor.trim();
    if (!v || lido.current) return;
    lido.current = true;
    aoLer.current(v);
  }, []);

  useEffect(() => {
    let cancelado = false;
    let stream: MediaStream | null = null;
    let relogio: ReturnType<typeof setTimeout> | null = null;
    const canvas = document.createElement("canvas");
    setFase("abrindo"); setAviso("");

    (async () => {
      const detector = await detectorNativo();
      if (cancelado) return;
      nativo.current = detector;
      try {
        stream = await abrirCamera();
      } catch (e) {
        if (cancelado) return;
        setAviso((e as { name?: string })?.name === "SemApiCamera" ? MSG_SEM_API_CAMERA : motivoSemCamera(e));
        setFase("sem-camera");
        return;
      }
      if (cancelado) { pararCamera(stream); return; }
      const video = videoRef.current;
      if (!video) { pararCamera(stream); return; }
      video.srcObject = stream;
      // iOS: sem `playsinline` o vídeo abre em tela cheia e a leitura para; sem `muted` não toca sozinho
      video.setAttribute("playsinline", ""); video.muted = true;
      try { await video.play(); } catch { /* o navegador segura o play até o vídeo carregar: o laço confere */ }
      if (cancelado) return;
      setFase("lendo");

      let usarNativo = !!detector;
      let falhas = 0;
      setMotor(usarNativo ? "nativo" : "jsqr");
      const ler = async () => {
        if (cancelado || lido.current) return;
        let valor: string | null = null;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          if (usarNativo) {
            try { valor = await detector!(video); falhas = 0; } catch {
              // O detector do navegador falhou de novo: passa para o jsQR e não volta
              if (++falhas >= FALHAS_DO_NATIVO) { usarNativo = false; setMotor("jsqr"); }
            }
          } else {
            valor = lerQrDoVideo(video, canvas);
          }
        }
        if (cancelado) return;
        if (valor) { entregar(valor); return; }
        relogio = setTimeout(ler, INTERVALO_LEITURA_MS);
      };
      void ler();
    })();

    return () => { cancelado = true; if (relogio) clearTimeout(relogio); pararCamera(stream); };
  }, [entregar, tentativa]);

  /** A saída quando a câmera ao vivo não abre: uma foto do QR, lida aqui mesmo */
  async function aoEscolherFoto(ev: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = ev.target.files?.[0];
    ev.target.value = ""; // escolher a mesma foto de novo dispara de novo
    if (!arquivo) return;
    setLendoFoto(true); setAviso("");
    try {
      const valor = await lerQrDaFoto(arquivo, nativo.current);
      if (valor) entregar(valor); else setAviso(MSG_FOTO_SEM_QR);
    } catch {
      setAviso(MSG_FOTO_INVALIDA);
    } finally {
      setLendoFoto(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Ler QR Code do equipamento" data-scanner-qr data-fase={fase} data-motor={motor ?? undefined}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-card rounded-t-card overflow-hidden max-h-[100dvh] overflow-y-auto">
        <div className="flex items-center justify-between pl-4 pr-1 border-b border-surface-linha">
          <span className="text-sm font-semibold text-ink">Escanear QR Code do equipamento</span>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="inline-flex items-center justify-center text-ink-muted hover:text-ink touch-target"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          {fase !== "sem-camera" && (
            <div className="relative rounded-card overflow-hidden bg-black aspect-square">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline autoPlay />
              <div className="absolute inset-8 border-2 border-white/70 rounded-lg pointer-events-none" />
              {fase === "abrindo" && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-white/80" /></div>}
            </div>
          )}
          {fase === "lendo" && !aviso && <p className="text-xs text-ink-muted" data-scanner-dica>Aponte para o QR Code. A leitura é feita no aparelho, mesmo sem sinal.</p>}
          {aviso && <p role="alert" className="text-sm text-atencao-texto bg-atencao-claro rounded-card px-3 py-2 flex items-start gap-2" data-scanner-aviso><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {aviso}</p>}

          <div className="grid gap-2" data-scanner-saidas>
            {/* Foto do QR: abre a câmera do sistema (não depende da permissão de câmera do navegador) */}
            <input ref={fotoRef} type="file" accept="image/*" capture="environment" onChange={aoEscolherFoto} className="hidden" aria-label="Foto do QR Code" data-scanner-foto />
            <button type="button" onClick={() => fotoRef.current?.click()} disabled={lendoFoto} data-scanner-tirar-foto
              className="w-full rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target disabled:opacity-60">
              {lendoFoto ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />} {lendoFoto ? "Lendo a foto…" : "Tirar foto do QR"}
            </button>
            {fase === "sem-camera" && (
              <button type="button" onClick={() => setTentativa((n) => n + 1)} data-scanner-tentar
                className="w-full rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
                <RefreshCw className="w-5 h-5" /> Tentar a câmera de novo
              </button>
            )}
          </div>

          <form className="space-y-2 pt-1" onSubmit={(e) => { e.preventDefault(); entregar(manual); }}>
            <label htmlFor="scanner-qr-manual" className="text-xs font-medium text-ink-muted">Ou digite o código (ou cole o link do QR)</label>
            <div className="flex gap-2">
              <Input id="scanner-qr-manual" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Ex: QR-104" className="flex-1 min-h-[44px]" autoCapitalize="characters" autoCorrect="off" data-scanner-manual />
              <Button type="submit" disabled={!manual.trim()} className="min-h-[44px]">Confirmar</Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
