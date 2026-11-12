"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Maximize2, MapPinOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LinhaOs } from "@/components/mapa/cartao-posicao";
import type { TecnicoComPosicao } from "@/components/mapa/mapa-leaflet";
import { horaBR } from "@/lib/fuso";
import { frescor, iniciais, ordenarParaLista, textoBateria, textoVisto, type Frescor, type RespostaMapa } from "@/lib/tecnico/posicao";

/**
 * De quanto em quanto tempo a tela busca as posições de novo. Hoje as posições chegam em momentos-chave
 * (app web), então 1 minuto sobra. Com o app nativo enviando em segundo plano, o "ao vivo" é só
 * baixar este número (ou trocar por um canal de eventos) — o resto da tela não muda.
 */
export const INTERVALO_ATUALIZACAO_MS = 60_000;

const MapaLeaflet = dynamic(() => import("@/components/mapa/mapa-leaflet").then((m) => m.MapaLeaflet), {
  ssr: false,
  loading: () => <div className="h-full w-full flex items-center justify-center text-sm text-ink-muted" data-mapa-carregando>Carregando o mapa…</div>,
});

const PONTO: Record<Frescor, string> = {
  atual: "bg-acento text-white border-acento",
  recente: "bg-white text-acento-hover border-acento",
  antiga: "bg-surface-linha text-ink-muted border-ink-subtle",
};
const LEGENDA: { idade: Frescor; texto: string }[] = [
  { idade: "atual", texto: "Até 15 min" },
  { idade: "recente", texto: "Até 3 h" },
  { idade: "antiga", texto: "Mais antiga" },
];

/**
 * Operações › Mapa: a ÚLTIMA POSIÇÃO CONHECIDA de cada técnico de campo — não é tempo real. Um
 * marcador por técnico; quem ainda não enviou posição fica na lista "Sem localização", fora do mapa.
 * Posição com mais de 3 h aparece cinza, com o horário. Rastreamento desligado: mapa vazio.
 */
export function MapaClient({ inicial, podeConfigurar }: { inicial: RespostaMapa; /** Pode abrir Equipes › App do colaborador */ podeConfigurar: boolean }) {
  const [dados, setDados] = useState(inicial);
  // O relógio da tela começa no horário do servidor (o mesmo texto no HTML e no navegador) e depois anda
  const [agora, setAgora] = useState(() => Date.parse(inicial.geradoEm));
  const [atualizando, setAtualizando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [enquadrar, setEnquadrar] = useState(0);
  const areaMapa = useRef<HTMLDivElement>(null);
  /** Escolher na lista leva o mapa ao técnico — e, no celular (lista abaixo do mapa), traz o mapa para a tela */
  const escolher = useCallback((id: string) => {
    setSelecionado(id);
    areaMapa.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);

  const atualizar = useCallback(async () => {
    setAtualizando(true);
    try {
      const r = await fetch("/api/mapa/posicoes", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setDados(await r.json());
      setFalhou(false);
    } catch {
      setFalhou(true); // fica o que já estava na tela, com o horário de quando foi buscado
    } finally {
      setAgora(Date.now());
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    const visivel = () => document.visibilityState === "visible";
    const busca = setInterval(() => { if (visivel()) void atualizar(); }, INTERVALO_ATUALIZACAO_MS);
    const relogio = setInterval(() => setAgora(Date.now()), 30_000);
    const aoVoltar = () => { if (visivel()) void atualizar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(busca); clearInterval(relogio); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [atualizar]);

  const lista = useMemo(() => ordenarParaLista(dados.tecnicos), [dados.tecnicos]);
  const noMapa = useMemo(() => lista.filter((t): t is TecnicoComPosicao => !!t.posicao), [lista]);
  const semPosicao = useMemo(() => lista.filter((t) => !t.posicao), [lista]);

  return (
    <div className="space-y-4" data-mapa-tecnicos data-rastreio={dados.rastreio ? "ligado" : "desligado"}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Mapa</h1>
          <p className="text-sm text-ink-muted mt-1">Última posição conhecida de cada técnico. Não é tempo real.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
          <span className="text-xs text-ink-muted w-full sm:w-auto" data-atualizado-as>{falhou ? "Sem conexão · " : ""}Atualizado às {horaBR(dados.geradoEm)}</span>
          {noMapa.length > 0 && <Button variant="outline" size="sm" onClick={() => { setSelecionado(null); setEnquadrar((n) => n + 1); }} data-enquadrar><Maximize2 className="w-4 h-4" /> Enquadrar todos</Button>}
          <Button variant="outline" size="sm" onClick={atualizar} disabled={atualizando} data-atualizar-mapa><RefreshCw className={cn("w-4 h-4", atualizando && "animate-spin")} /> Atualizar</Button>
        </div>
      </header>

      {!dados.rastreio && (
        <div className="rounded-card bg-white border border-surface-border p-4 flex items-start gap-3" data-rastreio-desligado>
          <MapPinOff className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold text-ink">O rastreamento está desligado</p>
            <p className="text-ink-muted mt-0.5">Nenhuma posição é capturada. Localização é dado pessoal: ligue só com o consentimento dos colaboradores.</p>
            {podeConfigurar && <Link href="/equipes/app-colaborador" className="inline-block mt-2 font-semibold text-acento-hover hover:underline" data-ir-app-colaborador>Abrir Equipes › App do colaborador</Link>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* `isolate`: as camadas do Leaflet (z-index alto) não passam por cima do menu e dos avisos do sistema */}
        <div ref={areaMapa} className="isolate min-w-0 h-[55vh] min-h-[20rem] max-h-[34rem] scroll-mt-4 lg:max-h-none lg:h-[calc(100vh-13rem)] rounded-card overflow-hidden border border-surface-border bg-white" data-area-mapa>
          <MapaLeaflet tecnicos={noMapa} agora={agora} selecionado={selecionado} enquadrar={enquadrar} onSelecionar={setSelecionado} />
        </div>

        <aside className="min-w-0 space-y-4 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto" aria-label="Técnicos" data-lista-tecnicos>
          <section className="bg-white rounded-card border border-surface-border">
            <h2 className="px-4 pt-3 pb-2 text-sm font-bold text-ink">No mapa <span className="font-medium text-ink-muted" data-total-no-mapa>· {noMapa.length}</span></h2>
            {dados.rastreio && noMapa.length === 0 && (
              <p className="px-4 pb-4 text-sm text-ink-muted" data-sem-posicoes>Nenhuma posição recebida ainda. Ela chega quando o técnico abre o app.</p>
            )}
            <ul className="divide-y divide-surface-border">
              {noMapa.map((t) => {
                const idade = frescor(t.posicao.registradoEm, agora);
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => escolher(t.id)} aria-pressed={selecionado === t.id} data-tecnico-no-mapa={t.id} data-frescor={idade}
                      className={cn("w-full text-left px-4 py-3 flex gap-3 touch-target hover:bg-surface-alt", selecionado === t.id && "bg-acento-claro", idade === "antiga" && "opacity-70")}>
                      <span className={cn("flex items-center justify-center w-9 h-9 rounded-full border-2 text-xs font-bold shrink-0", PONTO[idade])} aria-hidden>{iniciais(t.nome)}</span>
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block font-semibold text-ink truncate">{t.nome}</span>
                        <span className="block text-xs text-ink-muted" data-visto>{textoVisto(t.posicao.registradoEm, agora)}</span>
                        <span className="block text-xs truncate"><LinhaOs os={t.os} semLink /></span>
                      </span>
                      <span className="text-xs text-ink-muted shrink-0" title="Bateria" data-bateria>{textoBateria(t.posicao.bateria)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {noMapa.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-t border-surface-border text-xs text-ink-muted" data-legenda-frescor>
                {LEGENDA.map(({ idade, texto }) => (
                  <span key={idade} className="inline-flex items-center gap-1.5"><span className={cn("w-3 h-3 rounded-full border-2", PONTO[idade])} aria-hidden /> {texto}</span>
                ))}
              </p>
            )}
          </section>

          {dados.rastreio && semPosicao.length > 0 && (
            <section className="bg-white rounded-card border border-surface-border" data-sem-localizacao>
              <h2 className="px-4 pt-3 pb-2 text-sm font-bold text-ink">Sem localização <span className="font-medium text-ink-muted" data-total-sem-localizacao>· {semPosicao.length}</span></h2>
              <ul className="divide-y divide-surface-border">
                {semPosicao.map((t) => (
                  <li key={t.id} className="px-4 py-2.5 text-sm" data-tecnico-sem-posicao={t.id}>
                    <span className="block font-medium text-ink truncate">{t.nome}</span>
                    {t.os && <span className="block text-xs truncate"><LinhaOs os={t.os} /></span>}
                  </li>
                ))}
              </ul>
              <p className="px-4 py-2.5 border-t border-surface-border text-xs text-ink-muted">Ainda não enviaram posição: app fechado, localização bloqueada ou sem acesso ao app.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
