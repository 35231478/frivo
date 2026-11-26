"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { archivo, inter } from "./fonts";
import "./fonts/subconjuntos.css";
import "./globals.css";
import { TelaErro, LinkErro, BotaoErro } from "@/components/erro/tela-erro";
import { DicaCodigoErro, useRegistrarErro } from "@/components/erro/acoes-erro";

/**
 * Último recurso: o erro aconteceu no layout raiz, então esta página substitui o documento inteiro
 * (traz o próprio <html>). "Tentar de novo" recarrega a página — não há layout de pé para remontar.
 */
export default function ErroGeral({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useRegistrarErro(error);
  return (
    <html lang="pt-BR" className={`${inter.variable} ${archivo.variable}`}>
      <head><title>Algo deu errado | Frivo</title></head>
      <body className="font-sans antialiased bg-surface-page text-ink">
        <TelaErro
          cheia icone={TriangleAlert} titulo="Algo deu errado" texto="Não foi possível abrir o Frivo agora."
          dica={<DicaCodigoErro digest={error.digest} />} data-pagina-erro="erro-geral"
        >
          <LinkErro href="/" simples secundario data-acao-erro="inicio">Ir para o início</LinkErro>
          <BotaoErro onClick={() => window.location.reload()} data-acao-erro="tentar">
            <RotateCw className="w-4 h-4" aria-hidden /> Tentar de novo
          </BotaoErro>
        </TelaErro>
      </body>
    </html>
  );
}
