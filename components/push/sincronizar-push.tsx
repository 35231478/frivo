"use client";

import { useEffect } from "react";
import { sincronizarAparelho } from "@/lib/push";

const CHAVE_SESSAO = "frivo:push-sincronizado";

/**
 * HOTFIX push: uma vez por aba, com a permissão JÁ dada, confere a inscrição deste aparelho e grava no servidor —
 * refaz a que estava com outra chave VAPID e devolve a que o servidor apagou. Não mostra nada e nunca pede permissão.
 */
export function SincronizarPush() {
  useEffect(() => {
    try { if (sessionStorage.getItem(CHAVE_SESSAO)) return; } catch { /* sem sessionStorage: tenta assim mesmo */ }
    void sincronizarAparelho().then((r) => {
      if (r === "sincronizado") { try { sessionStorage.setItem(CHAVE_SESSAO, String(Date.now())); } catch { /* ok */ } }
    });
  }, []);
  return null;
}
