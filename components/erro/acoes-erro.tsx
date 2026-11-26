"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RotateCw } from "lucide-react";
import { BotaoErro } from "@/components/erro/tela-erro";
import { Dica } from "@/components/ui/dica";

/** "Voltar": só aparece quando há para onde voltar (aba aberta direto no link não tem). */
export function BotaoVoltar() {
  const router = useRouter();
  const [temHistorico, setTemHistorico] = useState(false);
  useEffect(() => setTemHistorico(window.history.length > 1), []);
  if (!temHistorico) return null;
  return (
    <BotaoErro secundario onClick={() => router.back()} data-acao-erro="voltar">
      <ArrowLeft className="w-4 h-4" aria-hidden /> Voltar
    </BotaoErro>
  );
}

/**
 * "Tentar de novo" de um error boundary: busca os dados de novo no servidor (router.refresh) e
 * remonta o trecho que falhou (reset) — só o reset não basta quando o erro veio do servidor.
 */
export function BotaoTentarDeNovo({ reset }: { reset: () => void }) {
  const router = useRouter();
  return (
    <BotaoErro onClick={() => startTransition(() => { router.refresh(); reset(); })} data-acao-erro="tentar">
      <RotateCw className="w-4 h-4" aria-hidden /> Tentar de novo
    </BotaoErro>
  );
}

/** O ⓘ com o código do erro (o `digest` do Next), para a pessoa informar ao suporte. */
export function DicaCodigoErro({ digest }: { digest?: string }) {
  if (!digest) return null;
  return <Dica rotulo="Código do erro" texto={`Se o problema continuar, informe ao suporte o código ${digest}.`} />;
}

/** O erro vai para o console do navegador (para quem investiga), nunca para a tela. */
export function useRegistrarErro(error: Error) {
  useEffect(() => { console.error(error); }, [error]);
}
