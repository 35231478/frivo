"use client";

import { useEffect } from "react";
import { CalendarDays, Loader2, Sun, UserRound } from "lucide-react";
import { Avisos, toast } from "@/components/ui/avisos";
import { cn } from "@/lib/utils";
import { toqueLeve } from "@/lib/haptico";
import { FrivoMark } from "@/components/layout/frivo-logo";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { IndicadorSync } from "@/components/tecnico/indicador-sync";
import { IndicadorLocalizacao } from "@/components/tecnico/indicador-localizacao";
import { ProvedorTecnico, irPara, useTecnico, useVista, type UsuarioApp, type Vista } from "@/components/tecnico/contexto";
import type { ConfigApp } from "@/lib/tecnico/config-app";
import { Agenda, MeuDia } from "@/components/tecnico/meu-dia";
import { VistaOs } from "@/components/tecnico/execucao";
import { PerfilTecnico } from "@/components/tecnico/perfil";
import { BloqueioLocalizacao, useLocalizacaoObrigatoria } from "@/components/tecnico/localizacao-gate";
import type { PerfilClient } from "@/components/perfil/perfil-client";

type PerfilInicial = React.ComponentProps<typeof PerfilClient>["initial"];

const NAV = [
  { ver: "dia" as const, rotulo: "Meu dia", Icone: Sun },
  { ver: "agenda" as const, rotulo: "Agenda", Icone: CalendarDays },
  { ver: "perfil" as const, rotulo: "Perfil", Icone: UserRound },
];

/**
 * App do TÉCNICO (PWA, offline-first): uma página só, com as vistas Meu dia · Agenda · Perfil e a
 * execução da OS. Navegação mínima — sem o menu do sistema. Tudo o que ele grava fica no aparelho e
 * sobe sozinho; o indicador no topo diz se está offline, sincronizando ou sincronizado.
 */
export function AppTecnico({ usuario, config, perfilInicial }: { usuario: UsuarioApp; config: ConfigApp; perfilInicial: PerfilInicial }) {
  return (
    <ProvedorTecnico usuario={usuario} config={config}>
      <Casca perfilInicial={perfilInicial} />
    </ProvedorTecnico>
  );
}

function Casca({ perfilInicial }: { perfilInicial: PerfilInicial }) {
  const { estado, semBanco, motor, config, usuario, avatar } = useTecnico();
  const vista = useVista();
  const ativa = vista?.ver === "os" ? "dia" : vista?.ver;
  // "Exigir localização ativa": sem GPS, o app fica travado (libera sozinho quando a posição volta)
  const loc = useLocalizacaoObrigatoria(config.exigirLocalizacao);
  const travadoLoc = config.exigirLocalizacao && loc.estado !== "ok";

  // G12/UX-3: quem clicou num link do escritório foi trazido para cá — avisa em vez de só "piscar"
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("aviso") !== "restrito") return;
    toast("Área do escritório. Este é o app do técnico.", "info");
    url.searchParams.delete("aviso");
    window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  }, []);

  return (
    <div className="min-h-screen bg-surface-page">
      <Avisos />
      <header className="sticky top-0 z-30 bg-white border-b border-surface-border safe-top">
        <div className="flex items-center justify-between gap-2 px-4 h-14 max-w-2xl mx-auto">
          <button type="button" onClick={() => irPara({ ver: "dia" })} className="inline-flex items-center gap-2 rounded-lg font-display font-bold text-ink min-w-0">
            <FrivoMark size={28} /> <span className="truncate">Frivo <span className="font-sans font-medium text-ink-muted">· Técnico</span></span>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <IndicadorSync estado={estado} onClick={() => irPara({ ver: "perfil" })} />
            {/* Quem está logado: a foto de perfil (ou as iniciais); toca e abre o Perfil */}
            <button type="button" onClick={() => irPara({ ver: "perfil" })} aria-label={`Perfil de ${usuario.nome || "técnico"}`} data-avatar-topo data-com-foto={avatar ? "" : undefined}
              className="inline-flex items-center justify-center rounded-full touch-target">
              <AvatarTecnico nome={usuario.nome} fotoUrl={avatar} size={36} title="Perfil" />
            </button>
          </div>
        </div>
        {/* Transparência: com o rastreamento ligado, o técnico vê sempre que a localização é compartilhada */}
        <IndicadorLocalizacao />
      </header>
      {semBanco &&<p className="bg-atrasado text-white text-sm px-4 py-2">Este navegador não guarda dados no aparelho (modo anônimo?). Sem sinal, nada pode ser gravado.</p>}
      <main className="max-w-2xl mx-auto px-4 pt-4 pb-28">
        {travadoLoc
          ? <BloqueioLocalizacao estado={loc.estado} onTentar={loc.tentar} />
          : !vista || !motor ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div> : <Conteudo vista={vista} perfilInicial={perfilInicial} />}
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-surface-border safe-bottom" aria-label="Navegação do técnico">
        <div className="grid grid-cols-3 max-w-2xl mx-auto">
          {NAV.map(({ ver, rotulo, Icone }) => (
            // Pulso tátil curtinho no toque (Android; onde não há suporte, nada acontece)
            <button key={ver} type="button" onClick={() => { toqueLeve(); irPara({ ver } as Vista); }} aria-current={ativa === ver ? "page" : undefined} data-nav={ver}
              className={cn("flex flex-col items-center justify-center gap-0.5 py-2.5 touch-target", ativa === ver ? "text-acento" : "text-ink-muted")}>
              <Icone className="w-6 h-6" />
              <span className="text-xs font-semibold">{rotulo}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Conteudo({ vista, perfilInicial }: { vista: Vista; perfilInicial: PerfilInicial }) {
  switch (vista.ver) {
    case "agenda": return <Agenda />;
    case "perfil": return <PerfilTecnico perfilInicial={perfilInicial} />;
    case "os": return <VistaOs key={vista.a} atividadeId={vista.a} equipamentoId={vista.e} camera={vista.cam} />;
    default: return <MeuDia />;
  }
}
