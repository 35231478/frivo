"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { EditarOs, type VisitaDaGaveta } from "@/components/os/central/editar-os";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import type { CardOs } from "@/components/calendario/calendario-grid";

/**
 * CLIQUE NO CARTÃO → A GAVETA "EDITAR OS", sem sair do calendário.
 *
 * Até esta leva clicar num cartão navegava para a página da OS. Agora abre a MESMA gaveta que o
 * botão Editar da central abre (components/os/central/editar-os.tsx) — nada de gaveta nova — com o
 * que o calendário tem a mais: a VISITA daquele cartão (dia e hora da atividade), salva pelo mesmo
 * PATCH do arrastar. A página inteira da OS continua a um clique ("Abrir a OS", no rodapé).
 *
 * LEITURA, não porta fechada: quem não tem "ordens › editar" abre a gaveta e vê tudo, só não muda
 * nada (o servidor recusaria de qualquer jeito). O mesmo para OS inativada e para registro fechado
 * (assinado, faturado, com nota) — o motivo vem do servidor, no GET da OS (`trava`).
 *
 * Esta casca só busca a OS e decide o modo; o formulário é o da central.
 */

export const MSG_SEM_PERMISSAO_EDITAR = "Só leitura: sem a permissão de editar ordens de serviço. O que precisar mudar, peça a quem tem.";
export const MSG_OS_INATIVADA = "OS inativada: nada se edita aqui. Para voltar a trabalhar nela, use “Reabrir” na página da OS.";

/** O dia do cartão ("AAAA-MM-DD"): a chave é `${os.id}:${dia}` */
export const diaDoCartao = (card: Pick<CardOs, "chave" | "id">) => card.chave.slice(card.id.length + 1);

export function GavetaOsCalendario({ card, onFechar, onReagendado }: {
  card: CardOs;
  onFechar: () => void;
  /** A visita mudou de dia/hora: o calendário move o cartão na hora, sem esperar o servidor */
  onReagendado?: (v: { atividadeId: string; data: string; hora: string }) => void;
}) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const podeEditar = pode("ordens", "editar");
  const [os, setOs] = useState<any>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    setOs(null); setErro("");
    fetch(`/api/ordens/${card.id}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error((d && typeof d.erro === "string" && d.erro) || "Não foi possível abrir a OS.");
        return d;
      })
      .then((d) => { if (ativo) setOs(d); })
      .catch((e: Error) => { if (ativo) setErro(e.message || "Não foi possível abrir a OS."); });
    return () => { ativo = false; };
  }, [card.id]);

  // A visita só existe quando o cartão vem de uma atividade agendada (OS pela data prevista não tem)
  const visita: VisitaDaGaveta | undefined = card.atividadeId
    ? { atividadeId: card.atividadeId, data: diaDoCartao(card), hora: card.hora ?? "" }
    : undefined;

  const motivo = !podeEditar ? MSG_SEM_PERMISSAO_EDITAR
    : card.status === "CANCELADA" ? MSG_OS_INATIVADA
    : (os?.trava as string | null | undefined) ?? null;

  const abrirCompleta = (
    <Link href={`/ordens/${card.id}`} data-abrir-os-completa
      className="inline-flex items-center gap-1.5 text-sm font-medium text-acento hover:text-acento-hover">
      <ExternalLink className="w-4 h-4" aria-hidden /> Abrir a OS
    </Link>
  );

  return (
    <>
      {/* Enquanto a OS não chegou (ou se não veio): a gaveta já abre, com o aviso dentro */}
      <Drawer
        aberto={!os} onFechar={onFechar} titulo={`OS ${card.numero}`}
        rodape={<div className="flex items-center justify-between gap-2 w-full">{abrirCompleta}<Button variant="secondary" onClick={onFechar}>Fechar</Button></div>}
      >
        {erro
          ? <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-gaveta-os>{erro}</p>
          : <p className="text-sm text-ink-muted" data-carregando-os>Carregando a OS…</p>}
      </Drawer>

      {os && (
        <EditarOs
          os={os} aberto onFechar={onFechar}
          visita={visita}
          somenteLeitura={!!motivo} motivoLeitura={motivo}
          rodapeExtra={abrirCompleta}
          onReagendado={onReagendado}
          onAtualizado={() => router.refresh()}
        />
      )}
    </>
  );
}
