"use client";

import { FileText, Loader2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { aceiteNoApp } from "@/lib/os/aceite";
import { linkPdfRelatorio, linkWhatsappRelatorio, mensagemRelatorio, situacaoEnvio } from "@/lib/tecnico/relatorio-cliente";
import type { ExecucaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

/**
 * Atividade concluída: o relatório da visita vai ao cliente pelo WhatsApp em 1 toque. Enquanto a conclusão (ou
 * qualquer gravação desta OS) ainda está no aparelho, o botão espera: o cliente nunca abre um relatório incompleto.
 */
export function EnviarRelatorio({ r, x, aEnviar }: { r: RetratoAtividade; x: ExecucaoTela; aEnviar: number }) {
  const rel = r.relatorio;
  const concluida = x.atividade.status === "CONCLUIDA";
  const s = situacaoEnvio({ concluida, noAparelho: aEnviar, temRelatorio: !!rel });
  // Um botão principal por vez: com a confirmação do cliente pendente, ela vem antes (o relatório leva a assinatura)
  const aceitePendente = aceiteNoApp({ atividadeConcluida: concluida, retrato: r.aceite, aceiteLocal: x.aceiteLocal }) === "OFERECE";
  if (!rel || !s || s === "nao-concluida") return null;
  const origem = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${origem}${rel.link}`;
  const whatsapp = linkWhatsappRelatorio(r.whatsapp, mensagemRelatorio(rel, url));
  return (
    <section className="rounded-card bg-white border border-surface-border p-3 space-y-2" data-enviar-relatorio={s}>
      {s === "aguardando" ? (
        <button type="button" disabled className="w-full rounded-card bg-surface-alt text-ink-muted py-4 text-base font-bold inline-flex items-center justify-center gap-2 touch-target" data-relatorio-aguardando>
          <Loader2 className="w-5 h-5 animate-spin" /> Relatório sai quando sincronizar
        </button>
      ) : (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" data-whatsapp-relatorio data-principal={!aceitePendente || undefined}
          className={cn("w-full rounded-card py-4 text-base font-bold inline-flex items-center justify-center gap-2 touch-target",
            aceitePendente ? "border-2 border-success-600 bg-white text-success-700" : "bg-success-600 text-white")}>
          <MessageCircle className="w-5 h-5" /> Enviar relatório pelo WhatsApp
        </a>
      )}
      {s === "pronto" && <a href={linkPdfRelatorio(rel.link)} target="_blank" rel="noopener noreferrer" data-pdf-relatorio
        className="w-full rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
        <FileText className="w-5 h-5" /> Ver relatório (PDF)
      </a>}
    </section>
  );
}
