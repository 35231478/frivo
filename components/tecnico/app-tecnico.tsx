"use client";

import { useEffect, useRef } from "react";
import { SincronizarPush } from "@/components/push/sincronizar-push";
import { CalendarDays, Loader2, MessageCircle, Sun, Trophy, UserRound } from "lucide-react";
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
import { VistaFichaEquipamento } from "@/components/tecnico/qr-equipamento";
import { VistaDespesas } from "@/components/tecnico/despesas";
import { PerfilTecnico } from "@/components/tecnico/perfil";
import { DesempenhoTecnico } from "@/components/tecnico/desempenho";
import { SeloNaoLidas, useNaoLidasChat, VistaChat } from "@/components/tecnico/chat";
import { useAreaVisivel } from "@/components/tecnico/use-area-visivel";
import { BloqueioLocalizacao, useLocalizacaoObrigatoria } from "@/components/tecnico/localizacao-gate";
import type { PerfilClient } from "@/components/perfil/perfil-client";
import { AtalhoChecklist, PorteiroChecklist, usePorteiro } from "@/components/tecnico/porteiro";
import type { ResumoPorteiro } from "@/lib/checklist-diario/regras";

type PerfilInicial = React.ComponentProps<typeof PerfilClient>["initial"];

const NAV = [
  { ver: "dia" as const, rotulo: "Meu dia", Icone: Sun },
  { ver: "agenda" as const, rotulo: "Agenda", Icone: CalendarDays },
  /** CHAT-1: a conversa com o Escritório, com o contador de não lidas */
  { ver: "chat" as const, rotulo: "Chat", Icone: MessageCircle },
  { ver: "perfil" as const, rotulo: "Perfil", Icone: UserRound },
];
/** Só para quem participa do Desempenho (entra antes do Perfil) */
const NAV_DESEMPENHO = { ver: "desempenho" as const, rotulo: "Desempenho", Icone: Trophy };

/**
 * App do TÉCNICO (PWA, offline-first): uma página só, com as vistas Meu dia · Agenda · Chat · Perfil e a
 * execução da OS. Navegação mínima — sem o menu do sistema. Tudo o que ele grava fica no aparelho e
 * sobe sozinho; o indicador no topo diz se está offline, sincronizando ou sincronizado.
 */
export function AppTecnico({ usuario, config, perfilInicial, porteiro = null }: {
  usuario: UsuarioApp; config: ConfigApp; perfilInicial: PerfilInicial;
  /** Checklist de veículo obrigatório (o "porteiro"): null = este colaborador não tem */
  porteiro?: ResumoPorteiro | null;
}) {
  return (
    <ProvedorTecnico usuario={usuario} config={config}>
      {/* Hotfix push: refaz a inscrição feita com outra chave e devolve ao servidor a que ele apagou (sem pedir nada) */}
      <SincronizarPush />
      <Casca perfilInicial={perfilInicial} resumoPorteiro={porteiro} />
    </ProvedorTecnico>
  );
}

function Casca({ perfilInicial, resumoPorteiro }: { perfilInicial: PerfilInicial; resumoPorteiro: ResumoPorteiro | null }) {
  const { estado, semBanco, motor, config, usuario, avatar } = useTecnico();
  const vista = useVista();
  const ativa = vista?.ver === "os" || vista?.ver === "equipamento" ? "dia" : vista?.ver === "despesas" ? "perfil" : vista?.ver;
  // "Exigir localização ativa": sem GPS, o app fica travado (libera sozinho quando a posição volta)
  const loc = useLocalizacaoObrigatoria(config.exigirLocalizacao);
  const travadoLoc = config.exigirLocalizacao && loc.estado !== "ok";
  // Checklist do veículo obrigatório: nos dias de checklist, a única tela até fazer (ou "não vou usar")
  const porteiro = usePorteiro(resumoPorteiro);
  const travadoPorteiro = !travadoLoc && !!resumoPorteiro && (porteiro.aberto || porteiro.carregando);
  const nav = usuario.desempenho ? [NAV[0], NAV[1], NAV[2], NAV_DESEMPENHO, NAV[3]] : NAV;
  // O contador do Chat acompanha em tempo real em qualquer vista (o mesmo laço de novidades que a conversa assina)
  const naoLidas = useNaoLidasChat();
  // O topo e a barra inferior como estão desenhados (no iPhone instalado o topo ganha a área do relógio, e a barra a do
  // gesto de início): a tela Chat se encaixa entre os dois, e nada fica atrás da barra. Com o teclado aberto, a barra
  // some (o campo de escrever encosta no teclado).
  const area = useAreaVisivel();
  const topo = useRef<HTMLElement>(null);
  const barra = useRef<HTMLElement>(null);
  const semBarra = travadoPorteiro || area.teclado;
  useEffect(() => {
    const raiz = document.documentElement;
    const medir = () => {
      raiz.style.setProperty("--tec-topo", `${topo.current?.getBoundingClientRect().height ?? 0}px`);
      raiz.style.setProperty("--tec-barra", `${semBarra ? 0 : barra.current?.getBoundingClientRect().height ?? 0}px`);
    };
    medir();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(medir) : null;
    if (topo.current) ro?.observe(topo.current);
    if (barra.current) ro?.observe(barra.current);
    return () => ro?.disconnect();
  }, [semBarra]);

  // G12/UX-3: quem clicou num link do escritório foi trazido para cá — avisa em vez de só "piscar"
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("aviso") !== "restrito") return;
    toast("Área do escritório. Este é o app do técnico.", "info");
    url.searchParams.delete("aviso");
    window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
  }, []);

  return (
    // campo-sol: contraste de leitura no sol (texto de apoio, alertas e botões principais ≥ 7:1), só no app do técnico
    <div className="min-h-screen bg-surface-page campo-sol">
      <Avisos />
      <header ref={topo} className="sticky top-0 z-30 bg-white border-b border-surface-border safe-top" data-topo-app>
        <div className="flex items-center justify-between gap-2 px-4 h-14 max-w-2xl mx-auto">
          <button type="button" onClick={() => irPara({ ver: "dia" })} className="inline-flex items-center gap-2 rounded-lg font-display font-bold text-ink min-w-0 touch-target">
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
      {/* O fim da página fica acima da barra inferior, qualquer que seja a altura dela (safe area do aparelho) */}
      <main className="max-w-2xl mx-auto px-4 pt-4" style={{ paddingBottom: "calc(var(--tec-barra, 6rem) + 1rem)" }}>
        {travadoLoc
          ? <BloqueioLocalizacao estado={loc.estado} onTentar={loc.tentar} />
          : travadoPorteiro
            ? (porteiro.carregando ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div>
              : <PorteiroChecklist resumo={resumoPorteiro!} porteiro={porteiro} trocando={porteiro.situacaoHoje === "NAO_VAI_USAR"} />)
            : !vista || !motor ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div> : (
              <>
                {resumoPorteiro && ativa === "dia" && <AtalhoChecklist porteiro={porteiro} />}
                {resumoPorteiro && ativa === "perfil" && porteiro.erro && (
                  <p role="alert" className="mb-3 rounded-lg bg-atencao-claro px-3 py-2 text-sm text-atencao-texto" data-erro-envio-checklist>Checklist do veículo: {porteiro.erro}</p>
                )}
                <Conteudo vista={vista} perfilInicial={perfilInicial} />
              </>
            )}
      </main>
      {/* No porteiro, a navegação some: a única tela é o checklist do veículo */}
      {!semBarra && <nav ref={barra} className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-surface-border safe-bottom" aria-label="Navegação do técnico" data-barra-app>
        <div className={cn("grid max-w-2xl mx-auto", nav.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
          {nav.map(({ ver, rotulo, Icone }) => (
            // Pulso tátil curtinho no toque (Android; onde não há suporte, nada acontece)
            <button key={ver} type="button" onClick={() => { toqueLeve(); irPara({ ver } as Vista); }} aria-current={ativa === ver ? "page" : undefined} data-nav={ver}
              className={cn("flex flex-col items-center justify-center gap-0.5 py-2.5 touch-target", ativa === ver ? "text-acento" : "text-ink-muted")}>
              <span className="relative inline-flex">
                <Icone className="w-6 h-6" />
                {ver === "chat" && <SeloNaoLidas n={naoLidas} className="absolute -top-1.5 left-4" />}
              </span>
              <span className="text-xs font-semibold truncate max-w-full">{rotulo}</span>
            </button>
          ))}
        </div>
      </nav>}
    </div>
  );
}

function Conteudo({ vista, perfilInicial }: { vista: Vista; perfilInicial: PerfilInicial }) {
  switch (vista.ver) {
    case "agenda": return <Agenda />;
    case "perfil": return <PerfilTecnico perfilInicial={perfilInicial} />;
    case "desempenho": return <DesempenhoTecnico />;
    case "os": return <VistaOs key={vista.a} atividadeId={vista.a} equipamentoId={vista.e} camera={vista.cam} incluir={vista.inc} fim={vista.fim} primeiro={vista.primeiro} />;
    case "equipamento": return <VistaFichaEquipamento key={vista.q} valor={vista.q} />;
    case "despesas": return <VistaDespesas />;
    case "chat": return <VistaChat />;
    default: return <MeuDia />;
  }
}
