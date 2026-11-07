"use client";

import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { Dica } from "@/components/ui/dica";
import { formatarDataHora } from "@/lib/utils";
import { formatarQtd } from "@/lib/estoque/regras";
import {
  LABEL_SITUACAO_MATERIAL, LABEL_SITUACAO_SEPARACAO, situacaoDoMaterial,
  type EstadoSeparacao, type MaterialSeparavel, type ResumoSeparacao, type SituacaoMaterial, type SituacaoSeparacao,
} from "@/lib/estoque/separacao";

/**
 * Estoque E4.1 — o estado da separação dentro da OS (aba Materiais & Compras): o que já foi separado (parcial/total),
 * por quem e quando, e a marca "prestação de contas pendente" (material separado sem consumo e devolução lançados),
 * que é o gancho onde as amarras da E4.2/E4.3 vão travar a conclusão. Aqui só se mostra; quem separa vai pela tela
 * Estoque › A separar (link para quem tem a permissão).
 */

export interface MaterialDaOs extends MaterialSeparavel {
  item: string;
  kitNome: string | null;
  separadoEm: string | null;
  separadoPor: string | null;
}

const num = (v: unknown) => Number(v ?? 0);

/** Achata os materiais dos itens da OS (como vêm da página) no formato da regra pura. */
export function materiaisDaOs(itens: any[]): MaterialDaOs[] {
  return itens.flatMap((i) => (i.materiais ?? []).map((m: any): MaterialDaOs => ({
    id: m.id, produtoId: m.produtoId ?? null, descricao: m.descricao, unidade: m.unidade || "un",
    quantidade: num(m.quantidade), quantidadeSeparada: num(m.quantidadeSeparada), estadoSeparacao: (m.estadoSeparacao ?? null) as EstadoSeparacao | null,
    item: i.descricao, kitNome: m.kitNome ?? null,
    separadoEm: m.separadoEm ? new Date(m.separadoEm).toISOString() : null, separadoPor: m.separadoPor?.nome ?? null,
  }))).filter((m) => m.quantidade > 0);
}

export const TOM_SITUACAO_MATERIAL: Record<SituacaoMaterial, TomStatus> = {
  "sem-produto": "previsto", pendente: "atencao", parcial: "atencao", separado: "ok", consumido: "ok-solido", devolvido: "acento",
};
export const TOM_SITUACAO_SEPARACAO: Record<SituacaoSeparacao, TomStatus> = { "sem-material": "previsto", pendente: "atencao", parcial: "atencao", completa: "ok" };

export function OsSeparacao({ osId, materiais, resumo, podeSeparar }: { osId: string; materiais: MaterialDaOs[]; resumo: ResumoSeparacao; podeSeparar: boolean }) {
  return (
    <section data-os-separacao data-situacao-separacao={resumo.situacao} data-prestacao-pendente={resumo.prestacaoPendente ? "true" : undefined} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="section-title flex items-center gap-2">
          <PackageOpen className="w-4 h-4 text-primary-600" /> Separação de material
          <Dica rotulo="Separação de material" texto="Antes de o técnico sair, o almoxarifado separa o material da OS: cada item separado fica reservado no estoque para esta OS. Depois, na execução, vem o consumo e a devolução do que sobrou (próximas levas)." />
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tom={TOM_SITUACAO_SEPARACAO[resumo.situacao]} data-resumo-separacao={resumo.situacao}>
            {LABEL_SITUACAO_SEPARACAO[resumo.situacao]}{resumo.total > 0 && resumo.situacao !== "completa" ? ` · ${resumo.aSeparar} de ${resumo.total} a separar` : ""}
          </StatusPill>
          {resumo.prestacaoPendente && (
            <span className="inline-flex items-center gap-1">
              <StatusPill tom="acento" data-flag-prestacao>Prestação de contas pendente</StatusPill>
              <Dica rotulo="Prestação de contas pendente" texto="Há material separado para esta OS sem consumo nem devolução lançados. É esta marca que as próximas levas (consumo e devolução) vão usar para travar a conclusão da OS; nesta versão ela só avisa." />
            </span>
          )}
          {podeSeparar && resumo.total > 0 && (
            <Link href={`/estoque/separacao/${osId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:underline" data-acao="ir-separar">
              <PackageOpen className="w-3.5 h-3.5" /> {resumo.aSeparar > 0 ? "Separar material" : "Ver separação"}
            </Link>
          )}
        </div>
      </div>

      {materiais.length === 0 ? (
        <p className="text-sm text-ink-muted" data-sem-materiais>Esta OS não tem material nos itens: nada a separar.</p>
      ) : (
        <ul className="divide-y divide-surface-linha border border-surface-border rounded-lg overflow-hidden" data-lista-separacao>
          {materiais.map((m) => {
            const sit = situacaoDoMaterial(m);
            return (
              <li key={m.id} data-material-estado={m.id} data-situacao-material={sit} className="px-3 py-2 text-sm sm:flex sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink truncate">{m.descricao}</p>
                  <p className="text-xs text-ink-subtle truncate">{m.item}{m.kitNome ? ` · Kit ${m.kitNome}` : ""}</p>
                </div>
                <div className="mt-1 sm:mt-0 flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0">
                  <span className="tabular-nums text-ink-muted" data-separado-de>
                    <span className="text-[10px] uppercase text-ink-subtle mr-1">Separado</span>{" "}
                    {formatarQtd(m.quantidadeSeparada)} de {formatarQtd(m.quantidade)} {m.unidade}
                  </span>
                  <StatusPill tom={TOM_SITUACAO_MATERIAL[sit]} tamanho="sm">{LABEL_SITUACAO_MATERIAL[sit]}</StatusPill>
                  {m.separadoPor && m.separadoEm && (
                    <span className="text-xs text-ink-subtle" data-separado-por>por {m.separadoPor} · {formatarDataHora(m.separadoEm)}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
