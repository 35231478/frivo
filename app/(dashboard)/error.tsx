"use client";

import { TriangleAlert } from "lucide-react";
import { TelaErro, LinkErro } from "@/components/erro/tela-erro";
import { BotaoTentarDeNovo, DicaCodigoErro, useRegistrarErro } from "@/components/erro/acoes-erro";

/**
 * Erro inesperado DENTRO do painel: só o conteúdo da página dá lugar à mensagem — o menu continua,
 * e a pessoa segue trabalhando nas outras telas. Sem detalhe técnico; o código fica no ⓘ.
 */
export default function ErroNoPainel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useRegistrarErro(error);
  return (
    <TelaErro
      icone={TriangleAlert} titulo="Algo deu errado" texto="Não foi possível carregar esta página."
      dica={<DicaCodigoErro digest={error.digest} />} data-pagina-erro="erro-painel"
    >
      <LinkErro href="/" simples secundario data-acao-erro="painel">Ir para o painel</LinkErro>
      <BotaoTentarDeNovo reset={reset} />
    </TelaErro>
  );
}
