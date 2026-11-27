"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, ChevronDown, Loader2, Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/avisos";
import { Dica } from "@/components/ui/dica";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ativarNesteAparelho, desativarNesteAparelho, estadoDoAparelho, type EstadoPush } from "@/lib/push";
import { formatarData } from "@/lib/utils";

/** A orientação do iPhone aparece UMA vez neste aparelho (depois, fica na ⓘ) */
const CHAVE_ORIENTACAO_IPHONE = "frivo:push:orientacao-iphone";
const ORIENTACAO_IPHONE = "No iPhone, as notificações só chegam com o Frivo na tela de início: no Safari, toque em Compartilhar › Adicionar à Tela de Início e abra o Frivo por lá.";

interface TipoPreferencia { id: string; rotulo: string; dica: string; ligado: boolean; previsto: boolean }
interface Aparelho { id: string; aparelho: string; desde: string; ultimoEnvioEm: string | null; final: string }

const lerLocal = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravarLocal = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: só não lembra */ } };

/**
 * Notificações com o app fechado, NESTE aparelho. Um componente só para os dois lugares:
 *  - "app" (Perfil do app do técnico): ativar, enviar teste e escolher os avisos;
 *  - "escritorio" (Meu perfil): o mesmo e a lista de aparelhos, com Revogar.
 * Sem as chaves no servidor, não aparece (o push está desligado).
 */
export function NotificacoesAparelho({ modo }: { modo: "app" | "escritorio" }) {
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [tipos, setTipos] = useState<TipoPreferencia[] | null>(null);
  const [aparelhos, setAparelhos] = useState<Aparelho[] | null>(null);
  const [verTipos, setVerTipos] = useState(modo === "escritorio");
  const [orientacaoVista, setOrientacaoVista] = useState(true);

  const carregar = useCallback(async () => {
    const e = await estadoDoAparelho().catch(() => ({ situacao: "desligado" } as EstadoPush));
    setEstado(e);
    if (e.situacao === "desligado") return;
    const [t, a] = await Promise.all([
      fetch("/api/push/preferencias", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      modo === "escritorio" ? fetch("/api/push/aparelhos", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).catch(() => []) : Promise.resolve(null),
    ]);
    setTipos(Array.isArray(t) ? t : []);
    setAparelhos(Array.isArray(a) ? a : null);
  }, [modo]);

  useEffect(() => { setOrientacaoVista(lerLocal(CHAVE_ORIENTACAO_IPHONE) === "1"); void carregar(); }, [carregar]);

  if (!estado || estado.situacao === "desligado") return null;

  async function ativar() {
    if (estado?.situacao !== "inativo") return;
    setOcupado(true); setErro("");
    const e = await ativarNesteAparelho(estado.chave).catch(() => "Não foi possível ativar. Tente de novo.");
    setOcupado(false);
    if (e) { setErro(e); return; }
    toast("Notificações ativadas neste aparelho.");
    await carregar();
  }
  async function desativar() {
    setOcupado(true); setErro("");
    await desativarNesteAparelho();
    setOcupado(false);
    toast("Notificações desativadas neste aparelho.");
    await carregar();
  }
  async function testar() {
    setOcupado(true); setErro("");
    const r = await fetch("/api/push/teste", { method: "POST" }).catch(() => null);
    setOcupado(false);
    if (!r?.ok) { setErro((await r?.json().catch(() => null))?.erro ?? "Não foi possível enviar o teste."); return; }
    toast("Teste enviado. Deve chegar em alguns segundos.");
  }
  async function trocarTipo(id: string, ligado: boolean) {
    setTipos((ts) => ts?.map((t) => (t.id === id ? { ...t, ligado } : t)) ?? ts);
    const r = await fetch("/api/push/preferencias", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [id]: ligado }) }).catch(() => null);
    if (!r?.ok) { setTipos((ts) => ts?.map((t) => (t.id === id ? { ...t, ligado: !ligado } : t)) ?? ts); toast("Não foi possível salvar a preferência.", "erro"); }
  }
  async function revogar(a: Aparelho) {
    const r = await fetch(`/api/push/aparelhos/${encodeURIComponent(a.id)}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) { toast("Não foi possível revogar o aparelho.", "erro"); return; }
    toast(`${a.aparelho}: não recebe mais notificações.`);
    if (estado?.situacao === "ativo" && estado.endpoint.endsWith(a.final)) await desativarNesteAparelho();
    await carregar();
  }

  const ativo = estado.situacao === "ativo";
  const app = modo === "app";
  return (
    <section data-notificacoes-aparelho={estado.situacao}
      className={cn("space-y-3", app && "bg-white border border-surface-border rounded-card p-4")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={cn("font-bold text-ink inline-flex items-center gap-1.5", app ? "text-base" : "text-sm")}>
          {ativo ? <Bell className="w-4 h-4 text-ok-texto" aria-hidden /> : <BellOff className="w-4 h-4 text-ink-muted" aria-hidden />}
          Notificações
          <Dica rotulo="Notificações" texto="Avisos no celular ou no computador mesmo com o Frivo fechado: nova OS, OS reagendada ou cancelada, atividade esquecida e o que o escritório acompanha. Cada aparelho é ativado nele mesmo." />
        </h2>
        {ativo && <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-ok-claro text-ok-texto" data-push-ativo>Ativas neste aparelho</span>}
      </div>

      {estado.situacao === "instalar-iphone" && (
        orientacaoVista
          ? <p className="text-sm text-ink-muted inline-flex items-center gap-1.5" data-push-iphone>
              <Smartphone className="w-4 h-4 shrink-0" aria-hidden /> Instale o Frivo na tela de início para receber.
              <Dica rotulo="iPhone" texto={ORIENTACAO_IPHONE} />
            </p>
          : <div className="flex items-start gap-2 rounded-lg bg-acento-claro border border-acento/20 p-3 text-sm text-ink" data-push-iphone data-orientacao-iphone>
              <Smartphone className="w-4 h-4 shrink-0 mt-0.5 text-acento" aria-hidden />
              <p className="flex-1">{ORIENTACAO_IPHONE}</p>
              <button type="button" aria-label="Entendi" title="Entendi" onClick={() => { gravarLocal(CHAVE_ORIENTACAO_IPHONE, "1"); setOrientacaoVista(true); }}
                className="text-ink-muted hover:text-ink p-0.5"><X className="w-4 h-4" /></button>
            </div>
      )}
      {estado.situacao === "sem-suporte" && <p className="text-sm text-ink-muted" data-push-sem-suporte>Este navegador não recebe notificações.</p>}
      {estado.situacao === "bloqueado" && (
        <p className="text-sm text-atencao-texto" data-push-bloqueado>
          Bloqueadas neste aparelho. <Dica rotulo="Bloqueadas" texto="A permissão foi negada. Para receber, libere as notificações do Frivo nas configurações do navegador ou do celular e volte aqui." />
        </p>
      )}

      {estado.situacao === "inativo" && (
        <button type="button" onClick={ativar} disabled={ocupado} data-ativar-push
          className={cn("w-full rounded-card bg-primary-600 hover:bg-primary-700 text-white font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50", app ? "py-3 touch-target" : "py-2.5 text-sm")}>
          {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />} Ativar notificações neste aparelho
        </button>
      )}
      {ativo && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={testar} disabled={ocupado} data-testar-push
            className="inline-flex items-center gap-1.5 text-sm font-medium border border-surface-border rounded-lg px-3 py-2 hover:bg-surface-alt disabled:opacity-50">Enviar teste</button>
          <button type="button" onClick={desativar} disabled={ocupado} data-desativar-push
            className="inline-flex items-center gap-1.5 text-sm font-medium text-atrasado border border-atrasado/20 rounded-lg px-3 py-2 hover:bg-atrasado-claro disabled:opacity-50">Desativar neste aparelho</button>
        </div>
      )}
      {erro && <p className="text-sm text-atrasado-texto" data-push-erro>{erro}</p>}

      {!!tipos?.length && (
        <div className="border-t border-surface-border pt-2">
          {app && (
            <button type="button" onClick={() => setVerTipos((v) => !v)} aria-expanded={verTipos} data-ver-tipos
              className="w-full flex items-center justify-between text-sm font-semibold text-ink py-2 touch-target">
              Escolher os avisos <ChevronDown className={cn("w-4 h-4 transition-transform", verTipos && "rotate-180")} aria-hidden />
            </button>
          )}
          {verTipos && (
            <div className="divide-y divide-surface-border" data-tipos-push>
              {tipos.map((t) => (
                <div key={t.id} data-tipo-push={t.id}>
                  <ToggleSwitch checked={t.ligado} onChange={(v) => void trocarTipo(t.id, v)} label={t.rotulo} dica={t.previsto ? `${t.dica} Ainda chega pela próxima versão do app.` : t.dica} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {aparelhos && aparelhos.length > 0 && (
        <div className="border-t border-surface-border pt-3 space-y-2" data-aparelhos-push>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Aparelhos que recebem</p>
          <ul className="divide-y divide-surface-border">
            {aparelhos.map((a) => {
              const este = ativo && estado.endpoint.endsWith(a.final);
              return (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2" data-aparelho={a.id}>
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">{a.aparelho}{este && <span className="ml-1.5 text-xs text-ok-texto">(este aparelho)</span>}</p>
                    <p className="text-xs text-ink-subtle">Desde {formatarData(a.desde)}{a.ultimoEnvioEm ? ` · último aviso ${formatarData(a.ultimoEnvioEm)}` : ""}</p>
                  </div>
                  <button type="button" onClick={() => void revogar(a)} data-revogar-aparelho={a.id}
                    className="text-xs font-semibold text-atrasado hover:text-atrasado-texto px-2 py-1">Revogar</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
