"use client";

import { useEffect } from "react";

/**
 * Sistema do escritório: quando a conexão volta, recarrega a página para mostrar os dados atuais
 * (antes era o `reloadOnOnline` do PWA, global). O app do técnico NÃO usa: lá a volta do sinal só
 * dispara a sincronização — recarregar no meio de uma foto ou observação atrapalharia.
 */
export function RecarregarAoVoltar() {
  useEffect(() => {
    const recarregar = () => window.location.reload();
    window.addEventListener("online", recarregar);
    return () => window.removeEventListener("online", recarregar);
  }, []);
  return null;
}
