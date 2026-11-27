"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Images, Loader2, SkipForward, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toqueLeve } from "@/lib/haptico";
import { toast } from "@/components/ui/avisos";
import { useTecnico } from "@/components/tecnico/contexto";
import { BotaoFoto, processarFoto, type MarcaFoto } from "@/components/tecnico/captura";
import { abrirCamera, causaSemCamera, pararCamera } from "@/lib/qr/leitor";

/** Uma foto da sequência: o que fotografar e para onde ela vai */
export interface PassoFoto { chave: string; rotulo: string; onFoto: (dataUrl: string) => void | Promise<void> }

/** A câmera ao vivo foi recusada neste aparelho (nesta sessão): as próximas fotos vão direto à câmera do sistema */
const CHAVE_RECUSADA = "frivo:camera-ao-vivo-recusada";
export function cameraAoVivoDisponivel(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  try { return sessionStorage.getItem(CHAVE_RECUSADA) !== "1"; } catch { return true; }
}
function lembrarRecusa(erro: unknown) {
  const nome = (erro as { name?: string } | null)?.name;
  if (nome !== "NotAllowedError" && nome !== "SecurityError" && nome !== "NotFoundError") return;
  try { sessionStorage.setItem(CHAVE_RECUSADA, "1"); } catch { /* sem armazenamento: pergunta de novo */ }
}

const paraBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error("sem imagem"))), "image/jpeg", 0.92));

/**
 * CÂMERA DO EQUIPAMENTO: a câmera ao vivo dentro do app. 1 toque abre, 1 toque fotografa — sem a tela
 * "Usar foto" da câmera do sistema. Com várias fotos pedidas, ela segue para a próxima sozinha ("2 de 3")
 * e fecha na última. Cada foto passa pelo MESMO caminho de toda foto do app (`processarFoto`). Se a câmera
 * ao vivo não abrir (bloqueada, sem câmera, navegador antigo), a câmera do sistema assume, sem perder a foto.
 */
export function CameraSequencia({ passos, titulo, marca, onFechar }: {
  passos: PassoFoto[]; titulo: string; marca?: MarcaFoto;
  /** `completou`: a última foto da sequência foi tirada (não fechou no X) */
  onFechar: (completou: boolean) => void;
}) {
  const { config } = useTecnico();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fase, setFase] = useState<"abrindo" | "pronta" | "sem-camera">("abrindo");
  const [motivo, setMotivo] = useState("");
  const [i, setI] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const passo = passos[Math.min(i, passos.length - 1)];

  useEffect(() => {
    let cancelado = false;
    let stream: MediaStream | null = null;
    (async () => {
      try { stream = await abrirCamera({ alta: true }); } catch (e) {
        if (cancelado) return;
        lembrarRecusa(e); setMotivo(causaSemCamera(e)); setFase("sem-camera"); return;
      }
      if (cancelado) { pararCamera(stream); return; }
      const video = videoRef.current;
      if (!video) { pararCamera(stream); return; }
      video.srcObject = stream;
      video.setAttribute("playsinline", ""); video.muted = true;
      try { await video.play(); } catch { /* o navegador segura o play até carregar */ }
      if (!cancelado) setFase("pronta");
    })();
    return () => { cancelado = true; pararCamera(stream); };
  }, []);

  async function guardar(dataUrl: string) {
    await passo.onFoto(dataUrl);
    if (i + 1 >= passos.length) onFechar(true); else setI(i + 1);
  }

  async function disparar() {
    const video = videoRef.current;
    if (salvando || !video || !video.videoWidth) return;
    toqueLeve();
    const quadro = document.createElement("canvas");
    quadro.width = video.videoWidth; quadro.height = video.videoHeight;
    quadro.getContext("2d")?.drawImage(video, 0, 0, quadro.width, quadro.height);
    setSalvando(true);
    try { await guardar(await processarFoto(await paraBlob(quadro), config, marca)); } catch {
      toast("A foto não pôde ser guardada. Tire de novo.", "erro");
    } finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col" role="dialog" aria-modal="true" aria-label={`Câmera: ${passo.rotulo}`} data-camera-sequencia data-fase={fase} data-passo={passo.chave}>
      <div className="flex items-center gap-2 pl-1 pr-3 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={() => onFechar(false)} aria-label="Fechar a câmera" data-fechar-camera className="inline-flex items-center justify-center touch-target"><X className="w-6 h-6" /></button>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold truncate" data-rotulo-passo>{passo.rotulo}</p>
          <p className="text-xs text-white/80 truncate">{titulo}</p>
        </div>
        {passos.length > 1 && <span className="text-sm font-semibold tabular-nums shrink-0" data-contagem-passo>{i + 1} de {passos.length}</span>}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {fase !== "sem-camera" && <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline autoPlay />}
        {fase === "abrindo" && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-white/80" /></div>}
        {fase === "sem-camera" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center" data-sequencia-sem-camera>
            <p role="alert" className="text-sm text-white/90 inline-flex items-start gap-2 text-left"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {motivo}</p>
            <div className="w-full max-w-xs text-ink"><BotaoFoto grande rotulo="Usar a câmera do celular" marca={marca} onFoto={guardar} className="bg-white" /></div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-black">
        {/* Galeria só quando a empresa deixa ("Foto somente pela câmera" desligado) */}
        {!config.fotoSomenteCamera && fase === "pronta" ? (
          <BotaoFoto rotulo="Galeria" marca={marca} onFoto={guardar} icone={Images}
            className="justify-self-start border-0 bg-transparent text-white px-2" />
        ) : <span />}
        <button type="button" onClick={disparar} disabled={fase !== "pronta" || salvando} aria-label={`Fotografar: ${passo.rotulo}`} data-disparar
          className="w-20 h-20 rounded-full border-4 border-white bg-white/20 active:bg-white/40 disabled:opacity-40 inline-flex items-center justify-center">
          {salvando ? <Loader2 className="w-7 h-7 animate-spin" /> : <Camera className="w-7 h-7" />}
        </button>
        {passos.length > 1 && i + 1 < passos.length ? (
          <button type="button" onClick={() => setI(i + 1)} data-pular-passo className={cn("justify-self-end inline-flex items-center gap-1 text-sm font-semibold touch-target px-2")}>
            Pular <SkipForward className="w-4 h-4" />
          </button>
        ) : <span />}
      </div>
    </div>
  );
}

/**
 * O botão de foto do equipamento: abre a câmera ao vivo (sem a tela "Usar foto"); `passos` diz o que
 * fotografar em sequência a partir deste toque. Sem câmera ao vivo no aparelho, é o botão de sempre
 * (câmera do sistema), só para o primeiro passo.
 */
export function BotaoCamera({ rotulo, titulo, passos, marca, className, aoCompletar }: {
  rotulo: string; titulo: string; passos: () => PassoFoto[]; marca?: MarcaFoto; className?: string;
  /** Depois da última foto da sequência (o guia segue para o próximo passo) */
  aoCompletar?: () => void;
}) {
  const [aberta, setAberta] = useState<PassoFoto[] | null>(null);
  const [aoVivo, setAoVivo] = useState(false);
  useEffect(() => { setAoVivo(cameraAoVivoDisponivel()); }, []);
  if (!aoVivo) return <BotaoFoto rotulo={rotulo} marca={marca} onFoto={async (d) => { await passos()[0]?.onFoto(d); aoCompletar?.(); }} className={className} />;
  return (
    <>
      <button type="button" onClick={() => setAberta(passos())} data-botao-camera
        className={cn("inline-flex items-center justify-center gap-2 rounded-card border-2 border-dashed border-primary-300 bg-primary-50 text-primary-700 font-semibold touch-target px-3 py-2 text-sm", className)}>
        <Camera className="w-5 h-5" /> {rotulo}
      </button>
      {aberta && aberta.length > 0 && <CameraSequencia passos={aberta} titulo={titulo} marca={marca} onFechar={(completou) => { setAberta(null); if (completou) aoCompletar?.(); }} />}
    </>
  );
}
