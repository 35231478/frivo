"use client";

import { useEffect, useState } from "react";
import { Bell, Download, Smartphone, X } from "lucide-react";
import { toast } from "@/components/ui/avisos";
import { useTecnico } from "@/components/tecnico/contexto";
import { appInstalado, ativarNesteAparelho, estadoDoAparelho, type EstadoPush } from "@/lib/push";
import { CHAVE_PRIMEIROS_DIAS, passoPrimeirosDias, TEXTO_PASSO, type GuardadoPrimeirosDias, type PassoPrimeirosDias } from "@/lib/tecnico/primeiros-dias";

interface EventoInstalar extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

/**
 * D8 — o cartão "Instale o app e ative as notificações" no Meu dia, nos primeiros dias neste aparelho (regra em
 * lib/tecnico/primeiros-dias). Um cartão só, com o passo que falta; some quando feito ou dispensado ("Agora não").
 */
export function CartaoPrimeirosDias() {
  const { motor } = useTecnico();
  const [guardado, setGuardado] = useState<GuardadoPrimeirosDias | null>(null);
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [instalado, setInstalado] = useState(false);
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void (async () => {
      // O 1º Meu dia aberto neste aparelho marca o começo dos "primeiros dias"
      let g = await motor.banco.ler<GuardadoPrimeirosDias>(CHAVE_PRIMEIROS_DIAS).catch(() => null);
      if (!g) { g = { desde: Date.now() }; await motor.banco.gravar(CHAVE_PRIMEIROS_DIAS, g).catch(() => {}); }
      const e = await estadoDoAparelho().catch(() => ({ situacao: "desligado" } as EstadoPush));
      if (!vivo) return;
      setGuardado(g); setPush(e); setInstalado(appInstalado());
    })();
    const aoPrompt = (e: Event) => { e.preventDefault(); setEvento(e as EventoInstalar); };
    const aoInstalar = () => setInstalado(true);
    window.addEventListener("beforeinstallprompt", aoPrompt);
    window.addEventListener("appinstalled", aoInstalar);
    return () => { vivo = false; window.removeEventListener("beforeinstallprompt", aoPrompt); window.removeEventListener("appinstalled", aoInstalar); };
  }, [motor]);

  const iphone = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const passo: PassoPrimeirosDias | null = push ? passoPrimeirosDias({ guardado, agora: Date.now(), instalado, iphone, push: push.situacao }) : null;
  if (!passo) return null;

  async function dispensar() {
    const g = { ...(guardado ?? { desde: Date.now() }), dispensado: true };
    setGuardado(g);
    await motor?.banco.gravar(CHAVE_PRIMEIROS_DIAS, g).catch(() => {});
  }
  async function instalar() {
    if (!evento) return;
    await evento.prompt();
    const r = await evento.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    setEvento(null);
    if (r.outcome === "accepted") setInstalado(true);
  }
  async function ativar() {
    if (push?.situacao !== "inativo") return;
    setOcupado(true);
    const erro = await ativarNesteAparelho(push.chave).catch(() => "Não foi possível ativar. Tente de novo.");
    setOcupado(false);
    if (erro) { toast(erro, "erro"); setPush(await estadoDoAparelho().catch(() => push)); return; }
    toast("Notificações ativadas neste aparelho.");
    setPush(await estadoDoAparelho().catch(() => ({ situacao: "ativo", chave: push.chave, endpoint: "" } as EstadoPush)));
  }

  return (
    <section className="rounded-card bg-acento-claro border border-acento/20 p-4 space-y-3" aria-label="Primeiros passos no app" data-primeiros-dias={passo}>
      <div className="flex items-start gap-3">
        <Smartphone className="w-6 h-6 text-acento shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-bold text-ink">Instale o app e ative as notificações</h2>
          <p className="text-sm text-ink" data-passo-primeiros-dias>{TEXTO_PASSO[passo]}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {passo === "instalar" && evento && (
          <button type="button" onClick={instalar} data-instalar-app
            className="min-h-[44px] rounded-card bg-acento text-white px-4 text-sm font-bold inline-flex items-center gap-2"><Download className="w-4 h-4" aria-hidden /> Instalar</button>
        )}
        {passo === "ativar" && (
          <button type="button" onClick={ativar} disabled={ocupado} data-ativar-notificacoes
            className="min-h-[44px] rounded-card bg-acento text-white px-4 text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60"><Bell className="w-4 h-4" aria-hidden /> Ativar notificações</button>
        )}
        <button type="button" onClick={() => void dispensar()} data-dispensar-primeiros-dias
          className="min-h-[44px] rounded-card border border-surface-border bg-white px-4 text-sm font-semibold text-ink-muted inline-flex items-center gap-1.5"><X className="w-4 h-4" aria-hidden /> Agora não</button>
      </div>
    </section>
  );
}
