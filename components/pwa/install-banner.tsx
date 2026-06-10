"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { solicitarPermissaoEPush } from "@/lib/push";

const CHAVE_DISMISS = "frivo-install-dismiss";
const DIAS_7 = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Banner discreto no topo (mobile, app ainda não instalado) que aciona o prompt
 * nativo de instalação do PWA. Dispensa fica oculta por 7 dias.
 */
export function InstallBanner() {
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    // Já instalado (standalone) → nunca mostra
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;

    // Dispensado há menos de 7 dias → não mostra
    const dismiss = Number(localStorage.getItem(CHAVE_DISMISS) || 0);
    if (dismiss && Date.now() - dismiss < DIAS_7) return;

    function onPrompt(e: Event) {
      e.preventDefault();
      setEvento(e as BeforeInstallPromptEvent);
      setVisivel(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setVisivel(false));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function instalar() {
    if (!evento) return;
    await evento.prompt();
    const escolha = await evento.userChoice;
    if (escolha.outcome === "accepted") {
      // Solicita permissão de notificações (no-op enquanto não houver chave VAPID)
      solicitarPermissaoEPush().catch(() => {});
    }
    setVisivel(false);
    setEvento(null);
  }

  function dispensar() {
    localStorage.setItem(CHAVE_DISMISS, String(Date.now()));
    setVisivel(false);
  }

  if (!visivel) return null;

  return (
    <div className="lg:hidden flex items-center gap-3 bg-sidebar text-white px-4 py-2.5">
      <span className="text-sm flex-1">📱 Instale o Frivo no seu celular</span>
      <button
        type="button"
        onClick={instalar}
        className="inline-flex items-center gap-1.5 bg-primary-500 hover:bg-primary-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
      >
        <Download className="w-3.5 h-3.5" /> Instalar
      </button>
      <button
        type="button"
        onClick={dispensar}
        className="text-slate-300 hover:text-white text-xs font-medium px-2 py-1.5"
      >
        Agora não
      </button>
      <button type="button" onClick={dispensar} aria-label="Fechar" className="text-slate-400 hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
