"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Loader2, QrCode, SkipForward, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toqueLeve } from "@/lib/haptico";
import { toast } from "@/components/ui/avisos";
import { useTecnico } from "@/components/tecnico/contexto";
import { BotaoFoto, processarFoto, type MarcaFoto } from "@/components/tecnico/captura";
import { MSG_SEM_API_CAMERA, abrirCamera, lerQrDaFoto, lerQrDoCanvas, motivoSemCamera, pararCamera } from "@/lib/qr/leitor";
import { dataUrlParaArquivo } from "@/lib/imagem-cliente";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { EVENTO_RAPIDA, guardaDo } from "@/lib/tecnico/offline/rapida";
import { SESSAO_VAZIA, agrupar, identificar, type Momento, type SessaoRapida } from "@/lib/tecnico/camera-rapida";

/** A guarda da câmera rápida desta atividade (fotos ainda sem equipamento), relida a cada mudança. */
export function useRapida(atividadeId: string) {
  const { motor } = useTecnico();
  const guarda = useMemo(() => (motor ? guardaDo(motor.banco) : null), [motor]);
  const [sessao, setSessao] = useState<SessaoRapida>(SESSAO_VAZIA);
  const [carregada, setCarregada] = useState(false);
  useEffect(() => {
    if (!guarda) return;
    let vivo = true;
    const ler = () => { void guarda.sessao(atividadeId).then((s) => { if (vivo) { setSessao(s); setCarregada(true); } }); };
    ler();
    window.addEventListener(EVENTO_RAPIDA, ler);
    return () => { vivo = false; window.removeEventListener(EVENTO_RAPIDA, ler); };
  }, [guarda, atividadeId]);
  return { guarda, sessao, carregada };
}

interface Miniatura { id: string; src: string; estado: "processando" | "pronta" | "falhou"; qr: boolean }

const MOMENTOS: { id: Momento; rotulo: string }[] = [{ id: "ANTES", rotulo: "Antes" }, { id: "DEPOIS", rotulo: "Depois" }];
const paraBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error("sem imagem"))), "image/jpeg", 0.92));

/**
 * CÂMERA RÁPIDA: câmera ao vivo em RAJADA. Tocou, fotografou — sem diálogo, legenda ou escolha no meio;
 * as miniaturas empilham. Cada foto:
 *  - passa pelo MESMO caminho de toda foto do app (`processarFoto`: redução + marca d'água conforme as
 *    permissões) — e, por ser câmera ao vivo, é sempre foto tirada na hora ("foto somente pela câmera");
 *  - tem o QR lido da própria imagem parada, no aparelho (jsQR): é ele que diz de qual equipamento é;
 *  - é guardada no aparelho no disparo (fechar o app ou ficar sem sinal não perde nada).
 * "Antes/Depois" é um toque (padrão: antes). "Próximo equipamento" corta o grupo na hora, para
 * máquinas lado a lado. Se a câmera ao vivo não abrir, a câmera do sistema (o botão de foto de sempre)
 * alimenta a mesma sessão — o técnico nunca fica sem saída.
 */
export function CameraRapida({ atividadeId, marca, resolverQr, nomeDoEquipamento, onPronto }: {
  atividadeId: string;
  /** Dados da OS para a marca d'água (o que entra é decidido pelas permissões da empresa) */
  marca?: MarcaFoto;
  /** QR lido → id do equipamento da unidade (null = não é de um equipamento daqui) */
  resolverQr: (qr: string) => string | null;
  nomeDoEquipamento: (id: string) => string;
  /** O técnico terminou de fotografar (vai para a conferência) */
  onPronto: () => void;
}) {
  const { config } = useTecnico();
  const { guarda, sessao } = useRapida(atividadeId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fase, setFase] = useState<"abrindo" | "pronta" | "sem-camera">("abrindo");
  const [motivo, setMotivo] = useState("");
  const [momento, setMomento] = useState<Momento>("ANTES");
  const [miniaturas, setMiniaturas] = useState<Miniatura[]>([]);
  const [cortar, setCortar] = useState(false);
  const cortarRef = useRef(false);
  const momentoRef = useRef<Momento>("ANTES");
  // As fotos são tratadas uma por vez, na ordem do disparo (a rajada não espera: a fila corre atrás)
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const emFila = useRef(0);
  const [processando, setProcessando] = useState(0);
  const [saindo, setSaindo] = useState(false);

  /** Sair só depois que a última foto estiver guardada (nenhuma fica para trás, fora do grupo dela) */
  async function pronto() {
    if (saindo) return;
    setSaindo(true);
    await fila.current.catch(() => undefined);
    onPronto();
  }

  useEffect(() => { momentoRef.current = momento; }, [momento]);

  useEffect(() => {
    let cancelado = false;
    let stream: MediaStream | null = null;
    (async () => {
      try { stream = await abrirCamera({ alta: true }); } catch (e) {
        if (cancelado) return;
        setMotivo((e as { name?: string })?.name === "SemApiCamera" ? MSG_SEM_API_CAMERA : motivoSemCamera(e));
        setFase("sem-camera");
        return;
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

  const marcar = (id: string, m: Partial<Miniatura>) => setMiniaturas((l) => l.map((x) => (x.id === id ? { ...x, ...m } : x)));

  /** Põe uma foto na fila de tratamento: lê o QR, reduz, carimba e guarda no aparelho. */
  const tratar = useCallback((id: string, em: number, momentoDaFoto: Momento, corte: boolean, obter: () => Promise<{ dataUrl: string; qr: string | null }>) => {
    emFila.current += 1; setProcessando(emFila.current);
    fila.current = fila.current.then(async () => {
      try {
        const { dataUrl, qr } = await obter();
        await guarda!.adicionar(atividadeId, { id, em, momento: momentoDaFoto, qr, ...(corte && { corte: true }) }, dataUrl);
        marcar(id, { estado: "pronta", qr: !!qr, src: dataUrl });
      } catch {
        marcar(id, { estado: "falhou" });
        toast("Uma foto não pôde ser guardada. Tire de novo.", "erro");
      } finally {
        emFila.current -= 1; setProcessando(emFila.current);
      }
    });
  }, [guarda, atividadeId]);

  const proximoCorte = () => { const c = cortarRef.current; cortarRef.current = false; setCortar(false); return c; };

  /** O disparo: congela o quadro, mostra a miniatura na hora e deixa o resto para a fila. */
  function disparar() {
    const video = videoRef.current;
    if (!guarda || !video || !video.videoWidth) return;
    toqueLeve();
    const quadro = document.createElement("canvas");
    quadro.width = video.videoWidth; quadro.height = video.videoHeight;
    quadro.getContext("2d")?.drawImage(video, 0, 0, quadro.width, quadro.height);
    const id = novoClientId();
    const mini = document.createElement("canvas");
    const escala = 160 / Math.max(quadro.width, quadro.height);
    mini.width = Math.max(1, Math.round(quadro.width * escala)); mini.height = Math.max(1, Math.round(quadro.height * escala));
    mini.getContext("2d")?.drawImage(quadro, 0, 0, mini.width, mini.height);
    setMiniaturas((l) => [...l, { id, src: mini.toDataURL("image/jpeg", 0.6), estado: "processando", qr: false }]);
    tratar(id, Date.now(), momentoRef.current, proximoCorte(), async () => {
      const qr = lerQrDoCanvas(quadro); // a identidade vem da FOTO parada, lida aqui no aparelho
      return { dataUrl: await processarFoto(await paraBlob(quadro), config, marca), qr };
    });
  }

  /** Câmera ao vivo indisponível: a foto vem da câmera do sistema, já tratada pelo botão de sempre. */
  async function aoFotoDoSistema(dataUrl: string) {
    if (!guarda) return;
    const id = novoClientId();
    setMiniaturas((l) => [...l, { id, src: dataUrl, estado: "processando", qr: false }]);
    tratar(id, Date.now(), momentoRef.current, proximoCorte(), async () => ({ dataUrl, qr: await lerQrDaFoto(dataUrlParaArquivo(dataUrl, "foto.jpg")).catch(() => null) }));
  }

  // O que a etiqueta fotografada já disse do grupo em andamento (retorno para o técnico: "leu")
  const grupos = useMemo(() => agrupar(sessao.fotos), [sessao.fotos]);
  const atual = grupos[grupos.length - 1];
  const identidade = atual && !cortar ? identificar(atual, resolverQr) : null;
  const guardadas = sessao.fotos.length;

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col" role="dialog" aria-modal="true" aria-label="Câmera rápida" data-camera-rapida data-fase={fase}>
      <div className="flex items-center justify-between gap-2 pl-1 pr-3 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={pronto} aria-label="Fechar a câmera" className="inline-flex items-center justify-center touch-target"><X className="w-6 h-6" /></button>
        {identidade?.estado === "identificado" ? (
          <span className="min-w-0 inline-flex items-center gap-1.5 rounded-full bg-success-600 px-3 py-1 text-sm font-semibold" data-rapida-identificado>
            <CheckCircle2 className="w-4 h-4 shrink-0" /> <span className="truncate">{nomeDoEquipamento(identidade.equipamentoId)}</span>
          </span>
        ) : <span className="text-sm text-white/70 truncate" data-rapida-dica>{cortar ? "Próxima foto começa outro equipamento" : "Fotografe a etiqueta QR junto: o app identifica"}</span>}
        <span className="text-sm font-semibold tabular-nums shrink-0" data-rapida-total>{guardadas + processando}</span>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {fase !== "sem-camera" && <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline autoPlay />}
        {fase === "abrindo" && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-white/80" /></div>}
        {fase === "sem-camera" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center" data-rapida-sem-camera>
            <p role="alert" className="text-sm text-white/90 inline-flex items-start gap-2 text-left"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {motivo}</p>
            <p className="text-sm text-white/70">A câmera do aparelho resolve: cada foto entra aqui do mesmo jeito.</p>
            <div className="w-full max-w-xs text-ink"><BotaoFoto grande rotulo="Tirar foto" marca={marca} onFoto={aoFotoDoSistema} className="bg-white" /></div>
          </div>
        )}
      </div>

      <div className="space-y-3 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-black">
        {miniaturas.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto" data-rapida-miniaturas aria-label="Fotos desta sessão">
            {miniaturas.slice(-12).map((m) => (
              <li key={m.id} className="relative w-14 h-14 shrink-0" data-rapida-miniatura={m.estado}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.src} alt="" className={cn("w-14 h-14 rounded-lg object-cover border", m.estado === "falhou" ? "border-atrasado opacity-40" : "border-white/30")} />
                {m.estado === "processando" && <span className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg"><Loader2 className="w-4 h-4 animate-spin" /></span>}
                {m.qr && <span className="absolute -top-1 -right-1 rounded-full bg-success-600 p-0.5" title="Etiqueta lida" data-rapida-qr><QrCode className="w-3 h-3" /></span>}
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="inline-flex rounded-full bg-white/15 p-1 justify-self-start" role="group" aria-label="Antes ou depois do serviço" data-rapida-momento={momento}>
            {MOMENTOS.map((m) => (
              <button key={m.id} type="button" onClick={() => setMomento(m.id)} aria-pressed={momento === m.id}
                className={cn("rounded-full px-3 text-sm font-semibold touch-target", momento === m.id ? "bg-white text-ink" : "text-white")}>{m.rotulo}</button>
            ))}
          </div>
          <button type="button" onClick={disparar} disabled={fase !== "pronta"} aria-label={`Fotografar (${momento === "ANTES" ? "antes" : "depois"})`} data-rapida-disparo
            className="w-[76px] h-[76px] rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform">
            <span className="w-[60px] h-[60px] rounded-full bg-white" />
          </button>
          <button type="button" onClick={pronto} disabled={saindo} data-rapida-pronto
            className="justify-self-end rounded-full bg-white text-ink px-4 text-sm font-bold inline-flex items-center gap-1.5 touch-target disabled:opacity-70">
            {saindo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Pronto
          </button>
        </div>
        <button type="button" onClick={() => { cortarRef.current = true; setCortar(true); }} disabled={cortar || guardadas + processando === 0} aria-pressed={cortar} data-rapida-proximo
          className="w-full rounded-card border border-white/30 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target disabled:opacity-40">
          <SkipForward className="w-4 h-4" /> Próximo equipamento
        </button>
      </div>
    </div>
  );
}
