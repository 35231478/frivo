"use client";

import { useEffect, useRef } from "react";
import {
  CHAVE_ULTIMO_VISTO, INTERVALO_VIGIA_MS, MARCO_ZERO, deveAbrirSozinha, maisRecente,
  type Contador, type EstadoDaTela,
} from "@/lib/solicitacoes-vigia";

/**
 * O VIGIA das solicitações: a parte que toca o navegador (relógio, DOM, fetch, localStorage).
 * A decisão de abrir é pura e mora em lib/solicitacoes-vigia.ts.
 *
 * Custo: um GET minúsculo (/api/solicitacoes/contador) a cada INTERVALO_VIGIA_MS, SÓ enquanto a
 * aba do Calendário está visível. Aba em segundo plano não consulta nada; ao voltar, confere na hora.
 * Nenhuma outra tela paga por isso (o hook só monta na gaveta do Calendário).
 */

export const lerUltimoVisto = (): string | null => {
  try { return window.localStorage.getItem(CHAVE_ULTIMO_VISTO); } catch { return null; }
};
export const gravarUltimoVisto = (iso: string | null | undefined) => {
  if (!iso) return;
  try { window.localStorage.setItem(CHAVE_ULTIMO_VISTO, maisRecente(lerUltimoVisto(), iso) ?? iso); } catch { /* modo privado */ }
};

/**
 * Lê o estado da tela no DOM: o que está aberto e o que está acontecendo. As marcas vêm dos
 * componentes do próprio calendário (`[data-gaveta]`, `[data-arrastando]`, `[data-filtros-ativos]`)
 * e dos diálogos da casa (`[role="dialog"]`: gavetas, modais, a lista do dia, a OS aberta).
 */
export function lerEstadoDaTela(doc: Document, ultimaAcaoHa: number): EstadoDaTela {
  const filtros = doc.querySelector("[data-filtros-ativos]")?.getAttribute("data-filtros-ativos");
  return {
    visivel: doc.visibilityState === "visible",
    gavetaAberta: !!doc.querySelector("[data-gaveta]"),
    dialogoAberto: !!doc.querySelector('[role="dialog"]'),
    arrastando: !!doc.querySelector("[data-arrastando]"),
    filtroAtivo: Number(filtros ?? 0) > 0,
    ultimaAcaoHa,
  };
}

/** Os eventos que contam como "a pessoa está mexendo" */
const EVENTOS_DE_ACAO = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export function useVigiaDeSolicitacoes({ ativo, aoContar, aoNovo }: {
  /** Só vigia quem pode ver a gaveta (a permissão) */
  ativo: boolean;
  /** O total que o contador trouxe (a bolha da aba acompanha) */
  aoContar: (total: number) => void;
  /** Chegou chamado novo e a pessoa está ociosa: abrir o painel */
  aoNovo: () => void;
}) {
  const ultimaAcao = useRef(Date.now());
  const chamadas = useRef({ aoContar, aoNovo });
  chamadas.current = { aoContar, aoNovo };

  // Qualquer toque no teclado ou no ponteiro zera a ociosidade
  useEffect(() => {
    if (!ativo) return;
    const marcar = () => { ultimaAcao.current = Date.now(); };
    for (const e of EVENTOS_DE_ACAO) window.addEventListener(e, marcar, { passive: true });
    return () => { for (const e of EVENTOS_DE_ACAO) window.removeEventListener(e, marcar); };
  }, [ativo]);

  useEffect(() => {
    if (!ativo) return;
    let parado = false;
    const conferir = async () => {
      if (parado || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/solicitacoes/contador", { cache: "no-store" });
        if (!r.ok || parado) return;
        const c = (await r.json()) as Contador;
        chamadas.current.aoContar(c.total);
        const visto = lerUltimoVisto();
        // Primeira conferência sem nada visto: o que JÁ estava pendente vira a linha de base — "novo"
        // é o que chegar depois que a pessoa começou a olhar o calendário. Caixa vazia: o marco zero
        // (senão o primeiro chamado a cair viraria a própria linha de base e nunca abriria nada)
        if (visto === null) { gravarUltimoVisto(c.maisRecenteEm ?? MARCO_ZERO); return; }
        const estado = lerEstadoDaTela(document, Date.now() - ultimaAcao.current);
        // "Visto" é a lista mostrada: quem marca é a gaveta ao carregar (se a lista falhar, o chamado
        // continua por ver e o painel pode abrir de novo no próximo ciclo ocioso)
        if (deveAbrirSozinha(c, visto, estado)) {
          chamadas.current.aoNovo();
        }
      } catch { /* sem rede: tenta na próxima */ }
    };
    const id = setInterval(conferir, INTERVALO_VIGIA_MS);
    const aoVoltar = () => { if (document.visibilityState === "visible") conferir(); };
    document.addEventListener("visibilitychange", aoVoltar);
    conferir();
    return () => { parado = true; clearInterval(id); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [ativo]);
}
