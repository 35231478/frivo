"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { ConversaEscritorio } from "@/components/chat/conversa-escritorio";
import { urlConversaEscritorio } from "@/lib/chat/regras";

/**
 * OS › Resumo: a CONVERSA da OS com o campo (CHAT-1) — a mesma da tela Conversas, aqui dentro da OS: todas as
 * mensagens, de todas as atividades (a do app com a marca da atividade), em tempo real; abrir marca como lida; escrever é
 * de quem edita a OS; foto da câmera ou da galeria. O cliente nunca vê.
 */
export function ComentariosOs({ osId, podeResponder }: { osId: string; podeResponder: boolean }) {
  return (
    <section className="space-y-3" data-comentarios-os id="comentarios">
      <div className="flex items-center justify-between gap-2">
        <h3 className="section-title inline-flex items-center gap-1.5"><MessageCircle className="w-4 h-4 text-ink-subtle" /> Conversa
          <Dica rotulo="Conversa" texto="Chat interno com o técnico pelo app, de todas as atividades da OS. Atualiza sozinha. O cliente não vê. A mesma conversa aparece em Conversas, no menu." lado="direita" />
        </h3>
        <Link href={urlConversaEscritorio(osId)} className="text-sm font-semibold text-primary-700 hover:underline" data-abrir-em-conversas>Abrir em Conversas</Link>
      </div>
      <ConversaEscritorio osId={osId} podeEscrever={podeResponder} className="h-[28rem] rounded-card border border-surface-border overflow-hidden" />
    </section>
  );
}
