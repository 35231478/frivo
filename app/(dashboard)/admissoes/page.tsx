import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Send, UserPlus } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { Dica } from "@/components/ui/dica";
import { ListaUrl, BuscaSimplesUrl, FiltroSelectUrl, ConteudoUrl, PaginacaoUrl, TabelaProUrl } from "@/components/listagem/lista-url";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { PLANILHA } from "@/lib/planilha";
import { cn, formatarData, formatarTelefone } from "@/lib/utils";
import { SITUACOES, ROTULO_SITUACAO, type SituacaoAdmissao } from "@/lib/admissao/admissao";
import { admissoesDaEmpresa, configDaEmpresa, type AdmissaoDoRh } from "@/lib/admissao/admissao-server";
import { AcoesAdmissao, SeloSituacao } from "@/components/admissao/acoes-admissao";
import { NovaAdmissao } from "@/components/admissao/nova-admissao";

export const metadata: Metadata = { title: "Admissões" };

/** Princípio 7: a explicação da tela sai do corpo e vira o ⓘ do título. */
const AJUDA = "O RH pré-cadastra o colaborador (nome, CPF, cargo e salário) e manda um link pessoal. Pelo link, no celular, o colaborador aceita o tratamento dos dados, preenche a ficha, envia os documentos e assina o contrato — com nome, IP, navegador, data e foto como prova. Depois de assinado, o RH marca o envio ao contador e conclui a admissão.";

const POR_PAGINA = 25;

/** O progresso em palavras: onde parou e quantos documentos obrigatórios chegaram. */
function progressoCurto(a: AdmissaoDoRh): string {
  if (a.situacao === "CANCELADA") return "Cancelada";
  if (a.assinaturaEm) return "Assinado";
  const docs = a.documentosObrigatorios > 0 ? `${a.documentosEnviados}/${a.documentosObrigatorios} documentos` : "";
  if (!a.abertoEm) return ["Não abriu o link", docs].filter(Boolean).join(" · ");
  return [a.etapa ? `Parou em ${a.etapa.toLowerCase()}` : "Preenchendo", docs].filter(Boolean).join(" · ");
}

/**
 * ADMISSÕES (Equipe › Admissões): a fila de admissões digitais da empresa. Busca por nome ou CPF,
 * filtro por situação, e por linha as ações do RH — enviar o link, acompanhar, invalidar, cancelar
 * com razão, marcar enviado ao contador e admitir.
 *
 * Exige "Admissão digital › gerenciar": é dado sensível de pessoa (CPF, documentos, salário).
 */
export default async function AdmissoesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  const user = session!.user!;
  if (!pode(user.permissoes, "admissao", "gerenciar", user.role)) redirect("/sem-permissao");
  const empresaId = user.empresaId;

  const busca = (sp.q ?? "").trim();
  const situacao = SITUACOES.includes(sp.situacao as SituacaoAdmissao) ? (sp.situacao as SituacaoAdmissao) : "";
  const pagina = Math.max(1, Number(sp.pagina) || 1);

  const [todas, cfg, cargos] = await Promise.all([
    admissoesDaEmpresa(empresaId, { busca, situacao: situacao || null, take: 200 }),
    configDaEmpresa(empresaId),
    prisma.cargo.findMany({ where: { empresaId, ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  // A fila de admissões é curta (uma por contratação): a página é cortada aqui, sem segunda consulta
  const itens = todas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const colunas = [
    { id: "colaborador", titulo: "Colaborador", obrigatoria: true, classe: "truncate" },
    { id: "cargo", titulo: "Cargo", largura: 180, classe: "truncate" },
    { id: "situacao", titulo: "Situação", largura: 170 },
    { id: "progresso", titulo: "Progresso", largura: 210, classe: "truncate" },
    { id: "prazo", titulo: "Prazo do link", largura: 140 },
    { id: "envio", titulo: "Envio", largura: 150, oculta: true },
    { id: "criado", titulo: "Criada em", largura: 120, oculta: true },
    { id: "acoes", titulo: "Ações", largura: 56, fixa: true, semTitulo: true, alinhar: "direita" as const },
  ];

  const linhas = itens.map((a) => ({
    id: a.id,
    atributos: { "data-admissao": a.id, "data-situacao": a.situacao },
    celulas: {
      colaborador: (
        <Link href={`/colaboradores/${a.colaborador.id}/editar`} className={cn(PLANILHA.nome, "truncate hover:text-primary-600")} data-linha-nome>
          {a.colaborador.nome}
        </Link>
      ),
      cargo: <span className="truncate">{a.colaborador.cargo ?? "—"}</span>,
      situacao: <SeloSituacao situacao={a.situacao} />,
      progresso: <span className={PLANILHA.apagado} data-linha-progresso>{progressoCurto(a)}</span>,
      prazo: (
        <span className={cn(PLANILHA.data, a.expirado && !a.assinaturaEm ? "text-atrasado font-medium" : PLANILHA.apagado)} data-linha-prazo>
          {a.assinaturaEm ? "—" : formatarData(a.expiraEm)}
        </span>
      ),
      envio: (
        <span className={PLANILHA.apagado} data-linha-envio>
          {a.enviadoEm ? `${formatarData(a.enviadoEm)} · ${a.envios}×` : "Não enviado"}
        </span>
      ),
      criado: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarData(a.criadoEm)}</span>,
      acoes: <AcoesAdmissao admissao={a} />,
    },
    titulos: { colaborador: a.colaborador.nome, progresso: progressoCurto(a) },
  }));

  const cartoes = (
    <ul className="divide-y divide-surface-linha" data-cartoes-admissoes>
      {itens.map((a) => (
        <li key={a.id} className="py-3 flex items-start justify-between gap-3" data-cartao-admissao={a.id}>
          <div className="min-w-0 space-y-1">
            <Link href={`/colaboradores/${a.colaborador.id}/editar`} className="font-semibold text-ink hover:text-primary-600 block truncate">
              {a.colaborador.nome}
            </Link>
            <p className="text-xs text-ink-muted truncate">
              {[a.colaborador.cargo, a.colaborador.telefone ? formatarTelefone(a.colaborador.telefone) : null].filter(Boolean).join(" · ") || "Sem cargo"}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <SeloSituacao situacao={a.situacao} />
              <span className="text-xs text-ink-muted">{progressoCurto(a)}</span>
            </div>
            {!a.assinaturaEm && (
              <p className={`text-xs flex items-center gap-1 ${a.expirado ? "text-atrasado" : "text-ink-muted"}`}>
                <CalendarClock className="w-3 h-3" aria-hidden /> Link até {formatarData(a.expiraEm)}
              </p>
            )}
          </div>
          <AcoesAdmissao admissao={a} />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-alt rounded-lg"><UserPlus className="w-5 h-5 text-ink-muted" aria-hidden /></div>
          <h1 className="page-title flex items-center gap-1.5">
            Admissões
            <Dica rotulo="Admissão digital" lado="direita" texto={AJUDA} />
          </h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full" data-total-admissoes>{todas.length}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <NovaAdmissao cargos={cargos.map((c) => ({ value: c.id, label: c.nome }))} validadePadrao={cfg.validadeDias} />
        </div>
      </div>

      <ListaUrl chave="admissoes" paramBusca="q" qAtual={busca}>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="flex-1 min-w-0">
            <BuscaSimplesUrl placeholder="Pesquisar por nome ou CPF" rotulo="Pesquisar admissões" />
          </div>
          <FiltroSelectUrl
            param="situacao" vazio="Todas as situações" rotulo="Situação"
            opcoes={SITUACOES.map((s) => ({ value: s, label: ROTULO_SITUACAO[s] }))}
          />
        </div>

        <ConteudoUrl>
          {itens.length === 0 ? (
            <div className="bg-white rounded-card shadow-card border border-surface-border">
              <ListaVazia
                mensagem={busca || situacao ? "Nenhuma admissão com esse filtro." : "Nenhuma admissão por aqui. Use “Nova admissão” para convidar o primeiro colaborador."}
                busca={busca}
              />
            </div>
          ) : (
            <TabelaProUrl
              tela="admissoes" colunas={colunas} linhas={linhas} cartoes={cartoes} padrao="criado"
              atributos={{ "data-tabela-admissoes": true }}
              barra={
                <span className="text-sm text-ink-muted flex items-center gap-1.5">
                  {todas.length.toLocaleString("pt-BR")} {todas.length === 1 ? "admissão" : "admissões"}
                  <Dica
                    rotulo="Como a admissão anda"
                    texto="Convidado → Preenchendo → Aguardando assinatura → Assinado → Enviado ao contador → Admitido. Cancelar não apaga: guarda a razão. Invalidar mata o link na hora; reenviar dá prazo novo."
                  />
                </span>
              }
            />
          )}
        </ConteudoUrl>

        <PaginacaoUrl total={todas.length} pagina={pagina} porPagina={POR_PAGINA} rotulo="admissões" />
      </ListaUrl>
    </div>
  );
}
