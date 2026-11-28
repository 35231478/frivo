"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { confirmar } from "@/components/ui/avisos";
import { devePerguntar, EVENTO_FORMULARIO_SALVO, linkSaiDaTela, TEXTO_SAIR_SEM_SALVAR } from "@/lib/ui/sair-sem-salvar";

/**
 * O aviso de SAIR SEM SALVAR de um formulário — um jeito só para todas as telas de edição (lib/ui/sair-sem-salvar).
 * Liga sozinho: conta como alteração o que a pessoa digita ou muda dentro do `container`. Pergunta no link interno,
 * no voltar do navegador e ao fechar a aba; não pergunta depois de salvar.
 */
export function useAvisoSairSemSalvar(container: RefObject<HTMLElement | null>) {
  const router = useRouter();
  const estado = useRef({ sujo: false, enviadoEm: null as number | null, guarda: false, saindo: false });

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const e = estado.current;
    const perguntar = () => devePerguntar({ sujo: e.sujo, enviadoEm: e.enviadoEm, agora: Date.now() });

    // Voltar do navegador: com alterações, uma entrada-guarda no histórico (com o estado do Next, mesma URL)
    const armarGuarda = () => {
      if (e.guarda) return;
      e.guarda = true;
      try { window.history.pushState({ ...(window.history.state ?? {}), avisoSairSemSalvar: true }, "", window.location.href); } catch { /* sem histórico */ }
    };
    const mudou = (ev: Event) => {
      const alvo = ev.target as HTMLElement | null;
      if (!alvo || alvo.closest("[data-sem-aviso]")) return;
      e.sujo = true;
      // Mexeu depois de enviar: o salvar não saiu da tela (a validação recusou) — volta a perguntar
      e.enviadoEm = null;
      armarGuarda();
    };
    const enviou = () => { e.enviadoEm = Date.now(); };
    // O envio que a validação recusou não segura o aviso: o campo inválido (do navegador) ou o foco que o
    // formulário leva ao 1º campo com erro, logo depois do envio
    const recusou = () => { e.enviadoEm = null; };
    const focou = (ev: FocusEvent) => {
      if (e.enviadoEm == null || !(ev.target as HTMLElement | null)?.matches?.("input, select, textarea")) return;
      e.enviadoEm = null;
    };
    const salvo = () => { e.sujo = false; e.enviadoEm = null; };

    const clique = (ev: MouseEvent) => {
      if (e.saindo || !perguntar()) return;
      const a = (ev.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const sai = linkSaiDaTela({
        href: a.getAttribute("href"), alvo: a.getAttribute("target"), download: a.hasAttribute("download"),
        modificador: ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey, botao: ev.button, origem: window.location.origin, atual: window.location.href,
      });
      if (!sai) return;
      ev.preventDefault();
      ev.stopPropagation();
      const destino = a.href;
      void confirmar({ ...TEXTO_SAIR_SEM_SALVAR, perigo: true }).then((ok) => {
        if (!ok) return;
        e.saindo = true; e.sujo = false;
        const url = new URL(destino);
        router.push(url.pathname + url.search + url.hash);
      });
    };
    const voltou = () => {
      if (e.saindo || !e.guarda) return;
      e.guarda = false;
      if (!perguntar()) { e.saindo = true; window.history.back(); return; }
      void confirmar({ ...TEXTO_SAIR_SEM_SALVAR, perigo: true }).then((ok) => {
        if (ok) { e.saindo = true; e.sujo = false; window.history.back(); }
        else armarGuarda();
      });
    };
    const fechando = (ev: BeforeUnloadEvent) => {
      if (e.saindo || !perguntar()) return;
      ev.preventDefault();
      ev.returnValue = ""; // o navegador mostra o aviso dele
    };

    el.addEventListener("input", mudou, true);
    el.addEventListener("change", mudou, true);
    el.addEventListener("submit", enviou, true);
    el.addEventListener("invalid", recusou, true);
    el.addEventListener("focusin", focou, true);
    window.addEventListener(EVENTO_FORMULARIO_SALVO, salvo);
    document.addEventListener("click", clique, true);
    window.addEventListener("popstate", voltou);
    window.addEventListener("beforeunload", fechando);
    return () => {
      el.removeEventListener("input", mudou, true);
      el.removeEventListener("change", mudou, true);
      el.removeEventListener("submit", enviou, true);
      el.removeEventListener("invalid", recusou, true);
      el.removeEventListener("focusin", focou, true);
      window.removeEventListener(EVENTO_FORMULARIO_SALVO, salvo);
      document.removeEventListener("click", clique, true);
      window.removeEventListener("popstate", voltou);
      window.removeEventListener("beforeunload", fechando);
    };
  }, [container, router]);
}

/** Envolve um formulário de página (novo/editar): o aviso de sair sem salvar, sem mudar o layout */
export function ProtegerSaida({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useAvisoSairSemSalvar(ref);
  return <div ref={ref} className="contents" data-proteger-saida>{children}</div>;
}
