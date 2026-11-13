"use client";

import { useCallback, useEffect, useState } from "react";
import { Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { appsDeRota, ehAparelhoApple, ehAppRota, linkDoApp, type AppRota } from "@/lib/tecnico/cartao";

const CHAVE = "frivo:app-rota";
const EVENTO = "frivo:app-rota";

/** App de rota preferido neste aparelho (null = pergunta ao tocar). Conveniência local: sem ela, tudo segue funcionando. */
function lerPreferencia(): AppRota | null {
  try {
    const v = window.localStorage.getItem(CHAVE);
    return ehAppRota(v) ? v : null;
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

/** Os apps de rota deste aparelho (o Mapas da Apple só existe no iPhone, iPad e Mac). */
function useAppsDeRota() {
  const [apple, setApple] = useState(false);
  useEffect(() => { setApple(ehAparelhoApple(window.navigator.userAgent)); }, []);
  return appsDeRota(apple);
}

/**
 * Botão "COMO CHEGAR": abre o mapa do celular traçando do ponto atual até o cliente (coordenadas da
 * unidade, quando há; senão o endereço). Na primeira vez pergunta o app (Google Maps, Waze ou, no
 * iPhone, Mapas da Apple) e lembra a escolha neste aparelho; depois abre direto.
 * É sempre um link de verdade (Google Maps por padrão): sem JavaScript ou sem armazenamento, funciona.
 * Sem chave de API e sem custo: é a URL universal de mapas, e quem abre é o app do aparelho.
 */
export function BotaoRota({ rota, className }: { rota: string; className?: string }) {
  const [lembrado, gravar] = usePreferenciaRota();
  const apps = useAppsDeRota();
  const [escolhendo, setEscolhendo] = useState(false);
  // App lembrado que não existe neste aparelho (ex.: Mapas da Apple fora do iPhone): volta a perguntar
  const preferido = lembrado && apps.some((a) => a.id === lembrado) ? lembrado : null;
  return (
    <>
      <a
        href={preferido ? linkDoApp(rota, preferido) : rota} target="_blank" rel="noopener noreferrer" data-rota data-app-rota={preferido ?? undefined}
        onClick={(e) => { if (!preferido) { e.preventDefault(); setEscolhendo(true); } }}
        className={cn("flex-1 inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold text-primary-700 active:bg-primary-50 touch-target", className)}
      >
        <Navigation className="w-4 h-4" /> Como chegar
      </a>
      {escolhendo && (
        <Modal aberto titulo="Abrir a rota com" onFechar={() => setEscolhendo(false)}>
          <div className="space-y-2" data-escolher-rota>
            {apps.map((a) => (
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
 * "Como chegar" quando a OS não tem para onde ir: a unidade e o cliente estão sem endereço (e sem
 * coordenadas) no cadastro. O botão fica no lugar, apagado, e diz o porquê — em vez de sumir.
 */
export function RotaSemEndereco({ className }: { className?: string }) {
  return (
    <button type="button" disabled data-rota-sem-endereco
      className={cn("flex-1 inline-flex flex-col items-center justify-center gap-0.5 py-2 text-sm font-semibold text-ink-subtle touch-target", className)}>
      <span className="inline-flex items-center gap-2"><Navigation className="w-4 h-4" /> Como chegar</span>
      <span className="text-[11px] font-normal text-ink-muted" data-aviso-sem-endereco>Sem endereço no cadastro</span>
    </button>
  );
}

/**
 * Preferência do aparelho: o app de rota lembrado (ou voltar a perguntar). Não é ação do dia a dia —
 * fica dentro de "Meus dados" do Perfil, discreta, sem card próprio.
 */
export function PreferenciaRota() {
  const [preferido, gravar] = usePreferenciaRota();
  const apps = useAppsDeRota();
  const opcoes: { id: AppRota | null; nome: string }[] = [{ id: null, nome: "Perguntar" }, ...apps];
  const escolhido = preferido && apps.some((a) => a.id === preferido) ? preferido : null;
  return (
    <div className="mt-2 border-t border-surface-border px-2 pt-4 pb-2 space-y-2" data-preferencia-rota>
      <h3 className="text-sm font-semibold text-ink">Preferências</h3>
      <p className="text-sm text-ink-muted" id="rotulo-app-rota">App que abre em “Como chegar”, neste aparelho.</p>
      <div className={cn("grid gap-2", opcoes.length > 3 ? "grid-cols-2" : "grid-cols-3")} role="group" aria-labelledby="rotulo-app-rota">
        {opcoes.map((o) => (
          <button key={o.id ?? "perguntar"} type="button" aria-pressed={escolhido === o.id} onClick={() => gravar(o.id)} data-opcao-rota={o.id ?? "perguntar"}
            className={cn("rounded-card border py-3 text-sm font-semibold touch-target",
              escolhido === o.id ? "border-primary-300 bg-primary-50 text-primary-700" : "border-surface-border bg-white text-ink")}>
            {o.nome}
          </button>
        ))}
      </div>
    </div>
  );
}
