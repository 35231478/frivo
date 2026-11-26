"use client";

import { TriangleAlert } from "lucide-react";
import { TelaErro, LinkErro } from "@/components/erro/tela-erro";
import { BotaoTentarDeNovo, DicaCodigoErro, useRegistrarErro } from "@/components/erro/acoes-erro";

/**
 * Erro inesperado FORA do painel (áreas públicas, portal, app do técnico) ou no próprio layout do
 * painel. Mensagem em português, sem detalhe técnico; o código fica no ⓘ.
 * "/" leva quem está logado ao painel e quem não está ao início.
 */
export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useRegistrarErro(error);
  return (
    <TelaErro
      cheia icone={TriangleAlert} titulo="Algo deu errado" texto="Não foi possível abrir esta página."
      dica={<DicaCodigoErro digest={error.digest} />} data-pagina-erro="erro"
    >
      <LinkErro href="/" simples secundario data-acao-erro="inicio">Ir para o início</LinkErro>
      <BotaoTentarDeNovo reset={reset} />
    </TelaErro>
  );
}
