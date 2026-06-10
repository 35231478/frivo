"use client";

import { FrivoMark } from "@/components/layout/frivo-logo";
import { WifiOff, RotateCw } from "lucide-react";

export default function OfflinePage() {
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
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-5 py-3 rounded-lg text-sm font-semibold transition-colors touch-target"
      >
        <RotateCw className="w-4 h-4" /> Tentar novamente
      </button>
    </div>
  );
}
