"use client";

import dynamic from "next/dynamic";

/**
 * A CASCA da ferramenta de anotações — o arquivo que garante custo ZERO para o cliente do Frivo.
 *
 * São três camadas de trava, e esta é a do BUNDLE (a do meio):
 *   1. montagem — o layout do painel só renderiza este componente para o dono (`ehDonoDoFrivo`),
 *      então quem é cliente não recebe nem a tag no HTML;
 *   2. bundle — aqui: o peso de verdade (overlay, balão, pin, captura de print) está atrás de um
 *      `import()` com `ssr: false`. O chunk só é baixado por quem passou pela camada 1. Mesmo
 *      padrão que o sistema já usa para o Leaflet em components/mapa/mapa-client.tsx;
 *   3. servidor — as rotas /api/anotacoes* e a página /anotacoes recusam com 403 quem não é o dono.
 *
 * O chunk da captura de imagem é mais fundo ainda: ele só baixa quando o dono salva a primeira
 * anotação (um `import()` dentro do handler de salvar).
 */
const Ferramenta = dynamic(() => import("@/components/anotacoes/ferramenta").then((m) => m.AnotacoesFerramenta), {
  ssr: false,
  loading: () => null,
});

/** `usuarioId`: a posição do botão arrastável fica guardada neste navegador por usuário */
export function AnotacoesCarregador({ usuarioId }: { usuarioId: string }) {
  return <Ferramenta usuarioId={usuarioId} />;
}
