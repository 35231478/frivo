"use client";

import { useCallback, useEffect, useState } from "react";
import { Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { APPS_ROTA, linkDoApp, linkWaze, type AppRota } from "@/lib/tecnico/cartao";

const CHAVE = "frivo:app-rota";
const EVENTO = "frivo:app-rota";

/** App de rota preferido neste aparelho (null = pergunta ao tocar). Conveniência local: sem ela, tudo segue funcionando. */
function lerPreferencia(): AppRota | null {
  try {
    const v = window.localStorage.getItem(CHAVE);
    return v === "google" || v === "waze" ? v : null;
  } catch { return null; }
}

export function gravarPreferenciaRota(app: AppRota | null) {
  try {
    if (app) window.localStorage.setItem(CHAVE, app); else window.localStorage.removeItem(CHAVE);
  } catch { /* aparelho sem armazenamento: só não lembra */ }
  window.dispatchEvent(new Event(EVENTO));
}

/** A preferência, viva: todos os cartões acompanham quando ela muda (aqui ou no Perfil). */
export function usePreferenciaRota(): [AppRota | null, (app: AppRota | null) => void] {
  const [app, setApp] = useState<AppRota | null>(null);
  useEffect(() => {
    const ler = () => setApp(lerPreferencia());
    ler();
    window.addEventListener(EVENTO, ler);
    return () => window.removeEventListener(EVENTO, ler);
  }, []);
  const gravar = useCallback((a: AppRota | null) => gravarPreferenciaRota(a), []);
  return [app, gravar];
}

/**
 * Botão de ROTA do cartão: abre o mapa do celular traçando do ponto atual até o cliente. Na primeira
 * vez pergunta o app (Google Maps ou Waze) e lembra a escolha neste aparelho; depois abre direto.
 * É sempre um link de verdade (Google Maps por padrão): sem JavaScript ou sem armazenamento, funciona.
 */
export function BotaoRota({ rota, className }: { rota: string; className?: string }) {
  const [preferido, gravar] = usePreferenciaRota();
  const [escolhendo, setEscolhendo] = useState(false);
  const temWaze = !!linkWaze(rota);
  return (
    <>
      <a
        href={preferido ? linkDoApp(rota, preferido) : rota} target="_blank" rel="noopener noreferrer" data-rota data-app-rota={preferido ?? undefined}
        onClick={(e) => { if (!preferido && temWaze) { e.preventDefault(); setEscolhendo(true); } }}
        className={cn("flex-1 inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold text-primary-700 active:bg-primary-50 touch-target", className)}
      >
        <Navigation className="w-4 h-4" /> Rota no mapa
      </a>
      {escolhendo && (
        <Modal aberto titulo="Abrir a rota com" onFechar={() => setEscolhendo(false)}>
          <div className="space-y-2" data-escolher-rota>
            {APPS_ROTA.map((a) => (
              <a key={a.id} href={linkDoApp(rota, a.id)} target="_blank" rel="noopener noreferrer" data-abrir-rota={a.id}
                onClick={() => { gravar(a.id); setEscolhendo(false); }}
                className="flex items-center justify-center gap-2 w-full rounded-card border border-surface-border bg-white py-4 text-base font-semibold text-ink active:bg-surface-alt touch-target">
                <Navigation className="w-5 h-5 text-primary-700" /> {a.nome}
              </a>
            ))}
            <p className="text-xs text-ink-muted text-center pt-1">O app escolhido fica lembrado neste aparelho. Troque em Perfil › Meus dados.</p>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Preferência do aparelho: o app de rota lembrado (ou voltar a perguntar). Não é ação do dia a dia —
 * fica dentro de "Meus dados" do Perfil, discreta, sem card próprio.
 */
export function PreferenciaRota() {
  const [preferido, gravar] = usePreferenciaRota();
  const opcoes: { id: AppRota | null; nome: string }[] = [{ id: null, nome: "Perguntar" }, ...APPS_ROTA];
  return (
    <div className="mt-2 border-t border-surface-border px-2 pt-4 pb-2 space-y-2" data-preferencia-rota>
      <h3 className="text-sm font-semibold text-ink">Preferências</h3>
      <p className="text-sm text-ink-muted" id="rotulo-app-rota">App que abre em “Rota no mapa”, neste aparelho.</p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="rotulo-app-rota">
        {opcoes.map((o) => (
          <button key={o.id ?? "perguntar"} type="button" aria-pressed={preferido === o.id} onClick={() => gravar(o.id)} data-opcao-rota={o.id ?? "perguntar"}
            className={cn("rounded-card border py-3 text-sm font-semibold touch-target",
              preferido === o.id ? "border-primary-300 bg-primary-50 text-primary-700" : "border-surface-border bg-white text-ink")}>
            {o.nome}
          </button>
        ))}
      </div>
    </div>
  );
}
