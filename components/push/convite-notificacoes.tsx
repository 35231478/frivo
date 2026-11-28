"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ativarNesteAparelho, estadoDoAparelho } from "@/lib/push";

const CHAVE_ADIADO = "frivo:push-convite-adiado";
const ADIAR_DIAS = 14;

/**
 * HOTFIX push: o escritório não tinha NENHUM aparelho inscrito, então comentário do técnico e chamado do portal não
 * chegavam a ninguém. No painel, quem ainda não ativou neste computador vê o convite (uma linha; "Agora não" esconde
 * por 14 dias). Ativado, bloqueado, sem suporte ou push desligado no servidor: não aparece.
 */
export function ConviteNotificacoes() {
  const [chave, setChave] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ativando, setAtivando] = useState(false);
  const [feito, setFeito] = useState(false);

  useEffect(() => {
    let adiado = 0;
    try { adiado = Number(localStorage.getItem(CHAVE_ADIADO) ?? 0); } catch { /* sem armazenamento: mostra */ }
    if (adiado && Date.now() - adiado < ADIAR_DIAS * 86_400_000) return;
    void estadoDoAparelho().then((e) => { if (e.situacao === "inativo") setChave(e.chave); }).catch(() => null);
  }, []);

  if (feito) return <p className="text-sm text-ok-texto bg-ok-claro rounded-card px-4 py-3" role="status" data-convite-push-ok>Notificações ativadas neste computador.</p>;
  if (!chave) return null;

  async function ativar() {
    setAtivando(true); setErro(null);
    const e = await ativarNesteAparelho(chave!);
    setAtivando(false);
    if (e) setErro(e); else setFeito(true);
  }
  function adiar() {
    try { localStorage.setItem(CHAVE_ADIADO, String(Date.now())); } catch { /* ok */ }
    setChave(null);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-acento-claro border border-acento/20 rounded-card px-4 py-3" data-convite-push>
      <BellRing className="w-5 h-5 text-acento shrink-0" aria-hidden />
      <div className="flex-1 min-w-0 text-sm">
        <p className="font-semibold text-ink">Receba os avisos neste computador</p>
        <p className="text-ink-muted">Comentário do técnico, chamado do portal, pedido do cliente — mesmo com o Frivo fechado. Escolha os tipos em <Link href="/perfil?aba=notificacoes" className="underline">Meu perfil › Notificações</Link>.</p>
        {erro && <p role="alert" className="text-atrasado-texto mt-1" data-convite-push-erro>{erro}</p>}
      </div>
      <div className="flex gap-2 shrink-0">
        <Button variant="secondary" onClick={adiar} data-convite-push-adiar><X className="w-4 h-4" aria-hidden /> Agora não</Button>
        <Button onClick={ativar} loading={ativando} data-convite-push-ativar>Ativar</Button>
      </div>
    </div>
  );
}
