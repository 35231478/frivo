"use client";

import Link from "next/link";
import { CalendarClock, Check, FileSignature, Mail, Send, ShieldCheck, UserPlus } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { formatarData } from "@/lib/utils";
import { AJUDA_SITUACAO, type SituacaoAdmissao } from "@/lib/admissao/admissao";
import type { AdmissaoDoRh } from "@/lib/admissao/admissao-server";
import { AcoesAdmissao, SeloSituacao } from "@/components/admissao/acoes-admissao";
import { NovaAdmissao, type OpcaoCargo } from "@/components/admissao/nova-admissao";

/**
 * "Admissão digital" na ficha do colaborador: onde a admissão dele está, a prova da assinatura e as
 * ações do RH. Sem admissão, o botão que gera o convite a partir desta ficha.
 *
 * A seção só aparece para quem tem "Admissão digital › gerenciar" (a página decide) — e as rotas
 * conferem a permissão de novo.
 */
export function PainelAdmissao({ colaborador, admissao, cargos, validadePadrao }: {
  colaborador: { id: string; nome: string; cargoId: string | null };
  /** A admissão viva (ou a última) deste colaborador; null = nunca houve */
  admissao: AdmissaoDoRh | null;
  cargos: OpcaoCargo[];
  validadePadrao: number;
}) {
  if (!admissao) {
    return (
      <div className="space-y-4" data-painel-admissao="sem-admissao">
        <p className="text-sm text-ink-muted flex items-start gap-1.5">
          <span>Um link pessoal: o colaborador preenche a ficha, manda os documentos e assina.</span>
          <Dica
            rotulo="Admissão digital"
            texto="O link vale por um prazo (configurável) e abre no celular. O colaborador aceita o tratamento dos dados, preenche em etapas com o rascunho salvo, envia os documentos que a empresa pede e assina o contrato com nome, IP, navegador, data e foto. A situação do convite aparece neste painel."
          />
        </p>
        <NovaAdmissao
          cargos={cargos} colaborador={colaborador} validadePadrao={validadePadrao}
          rotulo="Gerar convite de admissão"
        />
      </div>
    );
  }

  const s = admissao.situacao as SituacaoAdmissao;
  const linha = (rotulo: string, valor: React.ReactNode) => (
    <div>
      <dt className="text-xs text-ink-muted">{rotulo}</dt>
      <dd className="text-sm font-medium text-ink">{valor}</dd>
    </div>
  );

  return (
    <div className="space-y-5" data-painel-admissao={s}>
      <div className="flex flex-wrap items-center gap-2">
        <SeloSituacao situacao={s} />
        <span className="text-sm text-ink-muted">{AJUDA_SITUACAO[s]}</span>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-lg border border-surface-border bg-surface-alt/40 px-4 py-3">
        {linha("Convite criado em", <>{formatarData(admissao.criadoEm)}{admissao.criadoPor && <span className="text-ink-muted font-normal"> · {admissao.criadoPor}</span>}</>)}
        {linha("Prazo do link", admissao.assinaturaEm ? "—" : (
          <span className={admissao.expirado ? "text-atrasado" : undefined}>
            {formatarData(admissao.expiraEm)}{admissao.expirado && " (vencido)"}
          </span>
        ))}
        {linha("Envios do link", admissao.envios === 0 ? "Ainda não enviado" : `${admissao.envios}× · ${admissao.enviadoPara ?? "—"}`)}
        {linha("Abriu o link", admissao.abertoEm ? formatarData(admissao.abertoEm, "dd/MM/yyyy HH:mm") : "Ainda não")}
        {linha("Documentos obrigatórios", `${admissao.documentosEnviados} de ${admissao.documentosObrigatorios}`)}
        {linha("E-mail verificado", admissao.emailVerificado ?? "Não verificado")}
      </dl>

      {admissao.consentimentoEm && (
        <p className="flex items-start gap-1.5 text-xs text-ink-muted" data-painel-consentimento>
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ok-texto" aria-hidden />
          Tratamento dos dados aceito em {formatarData(admissao.consentimentoEm, "dd/MM/yyyy HH:mm")}.
          <Dica rotulo="Consentimento" texto="O aceite do colaborador fica registrado com data, hora, IP e navegador — é a prova exigida pela LGPD." />
        </p>
      )}

      {admissao.assinaturaEm && (
        <div className="bg-ok-claro border border-ok/20 rounded-lg px-4 py-3" data-painel-assinatura>
          <p className="text-sm font-semibold text-ok-texto flex items-center gap-1.5"><FileSignature className="w-4 h-4" aria-hidden /> Contrato assinado</p>
          <p className="text-sm text-ink">
            Por {admissao.assinaturaNome} em {formatarData(admissao.assinaturaEm, "dd/MM/yyyy HH:mm")}
            {admissao.assinaturaIp && <> · IP {admissao.assinaturaIp}</>}
          </p>
        </div>
      )}

      {admissao.enviadoContadorEm && (
        <p className="flex items-center gap-1.5 text-xs text-ink-muted" data-painel-contador>
          <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden /> Enviado ao contador em {formatarData(admissao.enviadoContadorEm, "dd/MM/yyyy HH:mm")}.
        </p>
      )}

      {admissao.admitidoEm && (
        <p className="flex items-center gap-1.5 text-sm text-ok-texto" data-painel-admitido>
          <Check className="w-4 h-4 shrink-0" aria-hidden /> Admitido em {formatarData(admissao.admitidoEm)}.
        </p>
      )}

      {admissao.cancelamentoMotivo && (
        <div className="bg-atrasado-claro border border-atrasado/20 rounded-lg px-4 py-3" data-painel-cancelada>
          <p className="text-sm font-semibold text-atrasado-texto">Admissão cancelada</p>
          <p className="text-sm text-ink">{admissao.cancelamentoMotivo}</p>
          <p className="text-xs text-ink-muted">
            {admissao.canceladaPor && <>Por {admissao.canceladaPor} · </>}
            {admissao.canceladaEm && formatarData(admissao.canceladaEm, "dd/MM/yyyy HH:mm")}
          </p>
        </div>
      )}

      <AcoesAdmissao admissao={admissao} variante="botoes" />

      {/* Cancelada ou admitida: o caminho para abrir outra está na lista, não escondido aqui */}
      {(s === "CANCELADA" || s === "ADMITIDO") && (
        <div className="pt-1 flex flex-wrap items-center gap-3">
          <NovaAdmissao
            cargos={cargos} colaborador={colaborador} validadePadrao={validadePadrao}
            rotulo="Abrir nova admissão" variante="secondary"
          />
          <Link href="/admissoes" className="text-sm text-primary-600 hover:underline inline-flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5" aria-hidden /> Ver todas as admissões
          </Link>
        </div>
      )}

      {!admissao.assinaturaEm && admissao.expirado && s !== "CANCELADA" && (
        <p className="flex items-start gap-1.5 text-xs text-atencao-texto">
          <CalendarClock className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
          O prazo do link venceu. “Reenviar o link” dá um prazo novo sem trocar o endereço que o colaborador já tem.
        </p>
      )}

      {admissao.envios === 0 && !admissao.abertoEm && s === "CONVIDADO" && (
        <p className="flex items-start gap-1.5 text-xs text-ink-muted">
          <Send className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
          O convite existe, mas o link ainda não foi enviado.
        </p>
      )}
    </div>
  );
}
