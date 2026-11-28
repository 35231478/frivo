"use client";

import { useEffect, useState } from "react";
import { areaVisivelDe, ehCampoDeTexto, type AreaVisivel } from "@/lib/tecnico/area-visivel";

const ler = (): AreaVisivel => (typeof window === "undefined"
  ? { altura: 0, deslocamento: 0, teclado: false }
  : areaVisivelDe(window, ehCampoDeTexto(document.activeElement)));

/**
 * A área visível de agora (altura, deslocamento e teclado), atualizada quando o teclado abre/fecha, a tela gira ou o
 * foco muda. Ver lib/tecnico/area-visivel.
 */
export function useAreaVisivel(): AreaVisivel {
  const [area, setArea] = useState<AreaVisivel>(ler);
  useEffect(() => {
    const atualizar = () => setArea((a) => {
      const b = ler();
      return a.altura === b.altura && a.deslocamento === b.deslocamento && a.teclado === b.teclado ? a : b;
    });
    // O foco muda antes de o teclado terminar de abrir: confere de novo logo depois
    const comFoco = () => { atualizar(); setTimeout(atualizar, 350); };
    const vv = window.visualViewport;
    vv?.addEventListener("resize", atualizar);
    vv?.addEventListener("scroll", atualizar);
    window.addEventListener("resize", atualizar);
    document.addEventListener("focusin", comFoco);
    document.addEventListener("focusout", comFoco);
    atualizar();
    return () => {
      vv?.removeEventListener("resize", atualizar);
      vv?.removeEventListener("scroll", atualizar);
      window.removeEventListener("resize", atualizar);
      document.removeEventListener("focusin", comFoco);
      document.removeEventListener("focusout", comFoco);
    };
  }, []);
  return area;
}
