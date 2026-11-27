"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Ban, Loader2, RotateCcw, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/avisos";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import type { Acao } from "@/lib/permissoes";
import { textoInativar as textoPadraoInativar, textoReativar as textoPadraoReativar } from "@/lib/cadastros/regras-arquivar";

/**
 * Botão "Inativar / Reativar" com confirmação, para cadastros com soft-delete
 * (Orçamentos, Colaboradores, Equipes, Veículos).
 * - Ao abrir, consulta `${url}/impacto`: mostra o que bloqueia (e trava o botão)
 *   e o que será impactado, para a pessoa decidir com informação.
 * - Inativar = DELETE `${url}` com { motivo } (exige `modulo.excluir`).
 * - Reativar = PATCH `${url}` com { ativo: true } (exige `modulo.<acaoReativar>`; `reativarCom` muda o pedido).
 * Sem a permissão correspondente, não renderiza nada (o servidor também valida).
 *
 * É o ÚNICO modal de inativar/reativar da casa: os cadastros, a OS (inativar/reabrir/recusar) e os
 * modelos de checklist e de formulário passam por aqui. `variante="oculto"` + `abrirAoMontar` abre só
 * o modal (quando a ação nasce de um seletor de status, como na OS).
 */
export function InativarRegistro({
  url, modulo, acaoInativar = "excluir", acaoReativar, ativo, nome, entidade, variante = "icone",
  rotuloInativar = "Inativar", rotuloReativar = "Reativar", comMotivo = true,
  textoInativar, textoReativar, aoConcluir, feminino = false,
  abrirAoMontar = false, onFechar, corpoInativar, titulo, avisoConcluido, placeholderMotivo, className,
  reativarCom = { metodo: "PATCH", corpo: { ativo: true } }, permitido: permitidoExterno, atributos,
}: {
  url: string;
  modulo: string;
  /** Permissão de inativar (padrão "excluir"; cadastros de Configurações usam "gerenciar"). */
  acaoInativar?: Acao;
  acaoReativar: Acao;
  ativo: boolean;
  nome: string;
  /** "orçamento", "colaborador", "equipe", "veículo" */
  entidade: string;
  variante?: "icone" | "botao" | "oculto";
  rotuloInativar?: string;
  rotuloReativar?: string;
  comMotivo?: boolean;
  textoInativar?: string;
  textoReativar?: string;
  /** Depois de concluir (padrão: router.refresh()). `dados` = a resposta da rota (o registro reativado). */
  aoConcluir?: (ativo: boolean, dados?: any) => void;
  /** Concordância do texto padrão ("a equipe… ela pode ser reativada"). */
  feminino?: boolean;
  /** Abre o modal ao montar (com `variante="oculto"`: a ação nasceu de um seletor de status). */
  abrirAoMontar?: boolean;
  /** Ao fechar o modal, confirmado ou não. */
  onFechar?: () => void;
  /** Campos a mais no corpo do DELETE (ex.: `{ recusa: true }` da OS). */
  corpoInativar?: Record<string, unknown>;
  /** Título próprio do modal (padrão: "Inativar {entidade} {nome}?"). */
  titulo?: string;
  /** Aviso ao concluir (padrão: "{Entidade} inativado." / "reativado."). */
  avisoConcluido?: string;
  placeholderMotivo?: string;
  className?: string;
  /** Como a rota reativa (padrão: PATCH { ativo: true }). A OS reabre com PUT { status: "ABERTA" }. */
  reativarCom?: { metodo: "PATCH" | "PUT"; corpo: Record<string, unknown> };
  /** Permissão já decidida por quem chama (cadastro que aceita mais de um módulo, como os modelos de checklist). */
  permitido?: boolean;
  /** Atributos `data-*` do botão (a tela que já se apoiava neles continua achando o botão). */
  atributos?: Record<`data-${string}`, string>;
}) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [impacto, setImpacto] = useState<{ bloqueio: string | null; avisos: string[]; usuarioVinculado?: { id: string; nome: string; email: string } | null } | null>(null);
  // Colaborador que também é usuário: inativar o login junto (mesma regra de Configurações › Usuários)
  const [inativarUsuario, setInativarUsuario] = useState(false);
  const [checando, setChecando] = useState(false);

  const permitido = permitidoExterno ?? (ativo ? pode(modulo, acaoInativar) : pode(modulo, acaoReativar));
  // Aberto pelo seletor de status: abre uma vez, ao montar (o `abrir` consulta o impacto)
  useEffect(() => {
    if (abrirAoMontar && permitido) void abrir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!permitido) return null;

  const rotulo = ativo ? rotuloInativar : rotuloReativar;
  const Icone = ativo ? Ban : RotateCcw;

  async function abrir(e?: React.MouseEvent) {
    e?.preventDefault(); e?.stopPropagation();
    setAberto(true); setErro(""); setMotivo(""); setImpacto(null); setInativarUsuario(false);
    if (!ativo) return;
    setChecando(true);
    try {
      const res = await fetch(`${url}/impacto`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (res.ok && d) setImpacto(d);
      else setErro(d?.erro ?? "Não foi possível verificar os vínculos.");
    } catch { setErro("Erro de conexão."); } finally { setChecando(false); }
  }

  async function confirmar() {
    setCarregando(true); setErro("");
    try {
      const res = ativo
        ? await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...corpoInativar, motivo, ...(inativarUsuario && { inativarUsuario: true }) }) })
        : await fetch(url, { method: reativarCom.metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(reativarCom.corpo) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível concluir a ação."); return; }
      if (d.aviso) { setErro(d.aviso); return; } // concluiu em parte: mostra o que faltou
      fechar();
      // "Veículo inativado." / "Equipe reativada." — toda gravação avisa
      toast(avisoConcluido ?? `${entidade.charAt(0).toUpperCase()}${entidade.slice(1)} ${ativo ? "inativad" : "reativad"}${feminino ? "a" : "o"}.`);
      if (aoConcluir) aoConcluir(!ativo, d); else router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setCarregando(false); }
  }

  function fechar() { setAberto(false); onFechar?.(); }

  const bloqueado = !!impacto?.bloqueio;

  // O texto padrão é o mesmo de todo lugar que inativa (lib/cadastros/regras-arquivar)
  const padrao = (ativo ? textoPadraoInativar : textoPadraoReativar)(entidade, nome, feminino ? "f" : "m");
  return (
    <>
      {variante === "oculto" ? null : variante === "icone" ? (
        <button
          type="button" title={`${rotulo} ${entidade}`} aria-label={`${rotulo} ${entidade}`} onClick={abrir}
          className={cn("p-1.5 rounded-md text-ink-muted hover:bg-surface-alt", ativo ? "hover:text-atrasado" : "hover:text-ok")}
          data-inativar-registro={ativo ? "inativar" : "reativar"} {...atributos}
        >
          <Icone className="w-4 h-4" aria-hidden />
        </button>
      ) : (
        <button
          type="button" onClick={abrir} data-inativar-registro={ativo ? "inativar" : "reativar"} {...atributos}
          className={cn(
            "inline-flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 transition-colors bg-white",
            ativo ? "text-atrasado border-atrasado/20 hover:bg-atrasado-claro" : "text-ok-texto border-ok/20 hover:bg-ok-claro",
            className,
          )}
        >
          <Icone className="w-4 h-4" /> {rotulo}
        </button>
      )}

      {/* Pelo portal, no <body>: dentro de um cabeçalho com desfoque (backdrop-blur, como o da ficha do
          cliente) o "fixed" do modal ficaria preso ao cabeçalho e cortado pela barra do topo */}
      {aberto && typeof document !== "undefined" && createPortal(
      <Modal aberto={aberto} onFechar={fechar} titulo={titulo ?? (rotulo === (ativo ? "Inativar" : "Reativar") ? padrao.titulo : `${rotulo} ${entidade} ${nome}?`)} tamanho="sm">
        <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-ink">
            {ativo
              ? (textoInativar ?? padrao.mensagem)
              : (textoReativar ?? padrao.mensagem)}
          </p>

          {checando && <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Verificando vínculos…</p>}

          {impacto?.bloqueio && (
            <div data-bloqueio className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{impacto.bloqueio}</span>
            </div>
          )}
          {!bloqueado && <AvisosImpacto avisos={impacto?.avisos} />}

          {ativo && !bloqueado && impacto?.usuarioVinculado && pode("configuracoes", "gerenciar") && (
            <label className="flex items-start gap-2 text-sm text-ink bg-surface-alt rounded-lg px-3 py-2" data-inativar-usuario>
              <input type="checkbox" checked={inativarUsuario} onChange={(e) => setInativarUsuario(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-surface-border text-primary-600" />
              <span>Também inativar o usuário de login <strong>{impacto.usuarioVinculado.email}</strong> (ele perde o acesso ao sistema na hora).</span>
            </label>
          )}

          {ativo && comMotivo && !bloqueado && (
            <label className="block">
              <span className="block text-xs font-medium text-ink mb-1">Motivo (opcional; fica registrado)</span>
              <textarea
                value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500}
                placeholder={placeholderMotivo ?? "Ex: desligado da empresa, vendido, duplicado…"}
                className="w-full bg-white border border-surface-campo rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 resize-none"
              />
            </label>
          )}

          {erro && (
            <div className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{erro}</span>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={fechar} className="px-4 py-2.5 text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt">
              Voltar
            </button>
            <button
              type="button" onClick={confirmar} disabled={carregando || checando || bloqueado}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg text-white disabled:opacity-50",
                ativo ? "bg-atrasado hover:brightness-95" : "bg-ok hover:bg-success-600",
              )}
            >
              {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icone className="w-4 h-4" />}
              {ativo ? `Sim, ${rotuloInativar.toLowerCase()}` : rotuloReativar}
            </button>
          </div>
        </div>
      </Modal>,
      document.body)}
    </>
  );
}

/**
 * "Antes de confirmar, saiba que…": o que continua andando (não bloqueia). O mesmo bloco no modal
 * de inativar e na troca de status do contrato.
 */
export function AvisosImpacto({ avisos, titulo = "Antes de confirmar, saiba que:" }: { avisos?: string[] | null; titulo?: string }) {
  if (!avisos?.length) return null;
  return (
    <div data-avisos className="text-sm text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2">
      <p className="flex items-center gap-1.5 font-semibold"><Info className="w-4 h-4" /> {titulo}</p>
      <ul className="mt-1 ml-5 list-disc space-y-0.5">
        {avisos.map((a) => <li key={a}>{a}</li>)}
      </ul>
    </div>
  );
}
