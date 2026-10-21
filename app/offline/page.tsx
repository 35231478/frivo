"use client";

import { useEffect, useState } from "react";
import { FrivoMark } from "@/components/layout/frivo-logo";
import { WifiOff, RotateCw, Wrench } from "lucide-react";

/** O app do técnico já foi guardado neste aparelho? (cópia da página no cache do service worker) */
async function temAppTecnico(): Promise<boolean> {
  try {
    if (typeof caches === "undefined" || !(await caches.has("frivo-tecnico"))) return false;
    return (await (await caches.open("frivo-tecnico")).keys()).length > 0;
  } catch {
    return false;
  }
}

export default function OfflinePage() {
  const [appTecnico, setAppTecnico] = useState(false);
  // O atalho do app instalado abre o sistema; sem sinal, quem usa o app do técnico vai direto para ele
  // (Meu dia e as OS do dia ficam no aparelho e funcionam sem internet)
  useEffect(() => {
    temAppTecnico().then((tem) => {
      setAppTecnico(tem);
      if (tem && !window.location.pathname.startsWith("/tecnico")) window.location.replace("/tecnico");
    });
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-sidebar text-white px-6 text-center">
      <FrivoMark size={72} />
      <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 text-slate-300">
          <WifiOff className="w-5 h-5" />
          <span className="text-sm font-medium uppercase tracking-wider">Sem conexão</span>
        </div>
        <h1 className="text-2xl font-bold">Você está sem conexão</h1>
        <p className="text-sm text-slate-300 max-w-sm">
          As últimas informações carregadas ainda estão disponíveis. Reconecte-se à internet para
          ver os dados mais recentes.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        {appTecnico && (
          <a href="/tecnico" className="inline-flex items-center justify-center gap-2 bg-success-500 hover:bg-success-600 text-white px-5 py-3 rounded-lg text-sm font-semibold transition-colors touch-target">
            <Wrench className="w-4 h-4" /> Abrir o app do técnico (funciona sem sinal)
          </a>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-5 py-3 rounded-lg text-sm font-semibold transition-colors touch-target"
        >
          <RotateCw className="w-4 h-4" /> Tentar novamente
        </button>
      </div>
    </div>
  );
}
