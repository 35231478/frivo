"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─────────────────────────────────────────────
// Scanner de QR (BarcodeDetector + fallback manual)
// ─────────────────────────────────────────────
export function ScannerQR({ onFechar, onLer }: { onFechar: () => void; onLer: (valor: string) => void }) {
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
