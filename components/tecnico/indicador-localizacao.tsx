"use client";

import { useState } from "react";
import { ChevronRight, MapPin, MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { useTecnico } from "@/components/tecnico/contexto";
import { horaBR } from "@/lib/fuso";

/**
 * TRANSPARÊNCIA: com "Rastrear localização dos técnicos" ligado na empresa, o técnico vê o tempo todo,
 * no topo do app, que a localização dele está sendo compartilhada — e, ao tocar, o que é lido, quando,
 * e a hora da última leitura. Com o rastreamento desligado, a faixa não existe (nada é lido).
 */
export function IndicadorLocalizacao() {
  const { rastreio } = useTecnico();
  const [aberto, setAberto] = useState(false);
  if (!rastreio || rastreio.desligado) return null;
  const bloqueada = rastreio.leitura === "sem-permissao";
  const semGps = rastreio.leitura === "sem-gps";
  const Icone = bloqueada ? MapPinOff : MapPin;
  const hora = (ms: number | null) => (ms ? horaBR(ms) : null);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} data-indicador-localizacao data-leitura={rastreio.leitura} aria-haspopup="dialog"
        className={cn("w-full border-b text-left touch-target", bloqueada ? "bg-atencao-claro border-atencao/20 text-atencao-texto" : "bg-acento-claro border-acento/15 text-acento-hover")}>
        <span className="flex items-center gap-2 px-4 max-w-2xl mx-auto text-xs font-semibold">
          <Icone className="w-4 h-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{bloqueada ? "Localização bloqueada: nada é enviado" : "Localização compartilhada com a empresa"}</span>
          <ChevronRight className="w-4 h-4 shrink-0" aria-hidden />
        </span>
      </button>
      {aberto && (
        <Modal aberto titulo="Localização compartilhada" onFechar={() => setAberto(false)}>
          <div className="space-y-3 text-sm text-ink" data-detalhes-localizacao>
            <p>A empresa vê no mapa a última posição deste aparelho, com o horário e o nível da bateria.</p>
            <p className="text-ink-muted">A leitura só acontece com o app aberto. Com o app fechado, nada é lido.</p>
            <p className="text-ink-muted" data-quando-le>Quando: ao abrir, no “Cheguei”, ao iniciar e concluir a OS e a cada 5 minutos.</p>
            <dl className="rounded-card border border-surface-border divide-y divide-surface-border">
              <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-ink-muted">Última leitura</dt><dd className="font-semibold" data-ultima-leitura>{hora(rastreio.ultimaLeituraEm) ?? "—"}</dd></div>
              <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-ink-muted">Último envio</dt><dd className="font-semibold" data-ultimo-envio>{hora(rastreio.ultimoEnvioEm) ?? "—"}</dd></div>
              {rastreio.aEnviar > 0 && <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-ink-muted">No aparelho, a enviar</dt><dd className="font-semibold" data-posicoes-a-enviar>{rastreio.aEnviar}</dd></div>}
            </dl>
            {bloqueada && <p className="rounded-card bg-atencao-claro border border-atencao/20 px-3 py-2 text-atencao-texto" data-localizacao-bloqueada>A localização está bloqueada neste navegador. Nada é enviado até a permissão ser liberada.</p>}
            {semGps && <p className="rounded-card bg-surface-alt border border-surface-border px-3 py-2 text-ink-muted" data-localizacao-sem-gps>O aparelho não informou a posição na última tentativa. O app tenta de novo sozinho.</p>}
            <p className="text-xs text-ink-muted">Quem liga e desliga é a empresa, em Equipes › App do colaborador.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
