"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/** Uma tentativa por endereço a cada 15 s: se algo der errado, a pessoa vê a recusa, não um laço. */
const JANELA_MS = 15_000;

/**
 * /sem-permissao percebeu, no cadastro, que a pessoa JÁ pode abrir o endereço de onde veio — o
 * portão do middleware barrou com o acesso antigo do cookie. Regrava o cookie (/api/auth/session)
 * e volta ao endereço.
 */
export function LiberarAcesso({ destino, children }: { destino: string; children: React.ReactNode }) {
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const chave = `frivo:liberar-acesso:${destino}`;
    let ultima = 0;
    try { ultima = Number(sessionStorage.getItem(chave)) || 0; } catch { /* sem armazenamento */ }
    if (Date.now() - ultima < JANELA_MS) { setFalhou(true); return; }
    try { sessionStorage.setItem(chave, String(Date.now())); } catch { /* sem armazenamento */ }
    fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then(() => window.location.replace(destino))
      .catch(() => setFalhou(true));
  }, [destino]);

  if (falhou) return <>{children}</>;
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-6" data-liberando-acesso>
      <Loader2 className="w-6 h-6 text-ink-subtle animate-spin" aria-hidden />
      <p className="text-sm text-ink-muted mt-3">Atualizando o seu acesso…</p>
    </div>
  );
}
