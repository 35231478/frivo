"use client";

/**
 * CHAT-1.2 — a situação e a presença do técnico (só o escritório vê): UMA linha embaixo do nome, na lista Pessoas e no
 * cabeçalho da conversa, e o ponto verde no avatar. Sem texto demais: cor só no ponto e na pausa por impedimento; o
 * que cada coisa quer dizer fica no ⓘ (LEGENDA_SITUACAO).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { osDaSituacao, presencaDoTecnico, textoDaSituacao, type EstadoTecnico } from "@/lib/chat/presenca";

/** O relógio da tela: a presença ("visto por último", o ponto) muda com o tempo, sem nova consulta */
export function useAgora(passoMs = 30_000): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), passoMs);
    return () => clearInterval(t);
  }, [passoMs]);
  return agora;
}

/** O ponto verde no canto do avatar: o app esteve ativo nos últimos 2 minutos */
export function PontoPresenca({ estado, agora }: { estado: EstadoTecnico | null | undefined; agora: Date }) {
  if (presencaDoTecnico(estado?.contatoEm, agora, false)?.tipo !== "ONLINE") return null;
  return (
    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-ok ring-2 ring-white" data-ponto-presenca role="img" aria-label="No app agora" title="No app agora" />
  );
}

/**
 * A linha: a situação (com a OS; clicável onde não está dentro de outro botão) e a presença quando ele não está no
 * app agora ("visto por último…" ou "Sem sinal há N min", quando há mensagem do escritório esperando por ele).
 */
export function LinhaSituacao({ estado, agora, aguardando, linkOs = false, className }: {
  estado: EstadoTecnico | null | undefined;
  agora: Date;
  /** Há mensagem do escritório que ele ainda não leu */
  aguardando: boolean;
  /** O nº da OS vira link (no cabeçalho; na lista a linha inteira já é o botão da conversa) */
  linkOs?: boolean;
  className?: string;
}) {
  if (!estado) return null;
  const s = estado.situacao;
  const os = osDaSituacao(s);
  const presenca = presencaDoTecnico(estado.contatoEm, agora, aguardando);
  const pausaImpedimento = s.tipo === "PAUSADA" && s.impedimento;
  return (
    <span className={cn("flex items-center min-w-0 text-xs text-ink-muted", className)} data-situacao={s.tipo}>
      <span className={cn("truncate", pausaImpedimento && "text-atencao-texto font-medium")} data-situacao-texto>{textoDaSituacao(s)}</span>
      {os && (
        <>
          <span aria-hidden className="whitespace-pre"> · </span>
          {linkOs
            ? <Link href={`/ordens/${os.id}`} className="shrink-0 font-semibold text-primary-700 hover:underline" data-situacao-os={os.id}>{os.numero}</Link>
            : <span className="shrink-0 font-semibold" data-situacao-os={os.id}>{os.numero}</span>}
        </>
      )}
      {presenca && presenca.tipo !== "ONLINE" && (
        <>
          <span aria-hidden className="whitespace-pre"> · </span>
          <span className="shrink-0" data-presenca={presenca.tipo} title={presenca.tipo === "SEM_SINAL" ? "A mensagem fica esperando e chega quando o sinal voltar." : undefined}>{presenca.texto}</span>
        </>
      )}
    </span>
  );
}
