"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useNovidades } from "@/components/chat/use-novidades";
import { URL_NOVIDADES_ESCRITORIO } from "@/lib/chat/novidades-cliente";

/**
 * CHAT-1 — o ícone de Conversas no topo, com quantas conversas têm mensagem por ler (de quem está vendo). Vem do mesmo
 * laço de tempo real da tela Conversas (uma conexão por aba); tocar abre a tela.
 */
export function IconeConversas() {
  const [naoLidas, setNaoLidas] = useState(0);
  useNovidades(URL_NOVIDADES_ESCRITORIO, (r) => setNaoLidas(r.naoLidas ?? 0));
  const rotulo = naoLidas === 0 ? "Conversas" : naoLidas === 1 ? "Conversas: 1 conversa por ler" : `Conversas: ${naoLidas} conversas por ler`;
  return (
    <Link href="/conversas" title={rotulo} aria-label={rotulo} data-icone-conversas={naoLidas}
      className="relative p-2 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt transition-colors">
      <MessageCircle className="w-5 h-5" />
      {naoLidas > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-primary-600 text-white text-[10px] font-semibold tabular-nums rounded-full ring-2 ring-white flex items-center justify-center">
          {naoLidas > 99 ? "99+" : naoLidas}
        </span>
      )}
    </Link>
  );
}
