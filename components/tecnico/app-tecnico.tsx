"use client";

import { CalendarDays, Loader2, Sun, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { FrivoMark } from "@/components/layout/frivo-logo";
import { IndicadorSync } from "@/components/tecnico/indicador-sync";
import { ProvedorTecnico, irPara, useTecnico, useVista, type UsuarioApp, type Vista } from "@/components/tecnico/contexto";
import { Agenda, MeuDia } from "@/components/tecnico/meu-dia";
import { VistaOs } from "@/components/tecnico/execucao";
import { PerfilTecnico } from "@/components/tecnico/perfil";
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
export function AppTecnico({ usuario, perfilInicial }: { usuario: UsuarioApp; perfilInicial: PerfilInicial }) {
  return (
    <ProvedorTecnico usuario={usuario}>
      <Casca perfilInicial={perfilInicial} />
    </ProvedorTecnico>
  );
}

function Casca({ perfilInicial }: { perfilInicial: PerfilInicial }) {
  const { estado, semBanco, motor } = useTecnico();
  const vista = useVista();
  const ativa = vista?.ver === "os" ? "dia" : vista?.ver;
  return (
    <div className="min-h-screen bg-surface-page">
      <header className="sticky top-0 z-30 bg-sidebar text-white safe-top">
        <div className="flex items-center justify-between gap-2 px-4 h-14 max-w-2xl mx-auto">
          <button type="button" onClick={() => irPara({ ver: "dia" })} className="inline-flex items-center gap-2 font-bold">
            <FrivoMark size={28} /> <span>Frivo <span className="font-medium text-slate-300">· Técnico</span></span>
          </button>
          <IndicadorSync estado={estado} onClick={() => irPara({ ver: "perfil" })} />
        </div>
      </header>
      {semBanco && <p className="bg-red-600 text-white text-sm px-4 py-2">Este navegador não guarda dados no aparelho (modo anônimo?). Sem sinal, nada pode ser gravado.</p>}
      <main className="max-w-2xl mx-auto px-4 pt-4 pb-28">
        {!vista || !motor ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div> : <Conteudo vista={vista} perfilInicial={perfilInicial} />}
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-surface-border safe-bottom" aria-label="Navegação do técnico">
        <div className="grid grid-cols-3 max-w-2xl mx-auto">
          {NAV.map(({ ver, rotulo, Icone }) => (
            <button key={ver} type="button" onClick={() => irPara({ ver } as Vista)} aria-current={ativa === ver ? "page" : undefined} data-nav={ver}
              className={cn("flex flex-col items-center justify-center gap-0.5 py-2.5 touch-target", ativa === ver ? "text-primary-600" : "text-ink-muted")}>
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
    case "os": return <VistaOs key={vista.a} atividadeId={vista.a} equipamentoId={vista.e} />;
    default: return <MeuDia />;
  }
}
