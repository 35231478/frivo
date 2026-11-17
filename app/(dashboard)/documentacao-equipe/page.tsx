import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarClock, FolderOutput, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { Dica } from "@/components/ui/dica";
import { ListaUrl, BuscaSimplesUrl, FiltroSelectUrl, ConteudoUrl, PaginacaoUrl, TabelaProUrl } from "@/components/listagem/lista-url";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { PLANILHA } from "@/lib/planilha";
import { cn, formatarData, formatarDataHora } from "@/lib/utils";
import { ROTULO_LINK, ROTULO_VIA, type SituacaoLink } from "@/lib/documentacao/pacote";
import { listarEnvios, type EnvioDaLista } from "@/lib/documentacao/pacote-server";
import { AcoesEnvio } from "@/components/documentacao/acoes-envio";
import { SeloLink } from "@/components/documentacao/selo-link";

export const metadata: Metadata = { title: "Documentação da equipe" };

/** Princípio 7: a explicação da tela sai do corpo e vira o ⓘ do título. */
const AJUDA = "Monta o pacote com os documentos dos colaboradores que atendem um cliente (ASO, NRs, treinamentos, fichas) e entrega por link, zip ou e-mail. Documento vencido não sai: o envio segura e mostra o que venceu e de quem. Cada envio fica aqui com a linha do tempo, inclusive quando o cliente abriu e baixou.";

const POR_PAGINA = 25;
const SITUACOES: SituacaoLink[] = ["ATIVO", "EXPIRADO", "REVOGADO", "SEM_LINK"];

/** A prova de recebimento em uma linha: baixou > abriu > ainda não abriu. Sem link, não há o que provar. */
function recebimento(e: EnvioDaLista): { texto: string; recebeu: boolean } {
  if (e.clienteBaixouEm) return { texto: `Baixou em ${formatarDataHora(e.clienteBaixouEm)}`, recebeu: true };
  if (e.clienteAbriuEm) return { texto: `Abriu em ${formatarDataHora(e.clienteAbriuEm)}`, recebeu: true };
  if (e.link === "SEM_LINK") return { texto: "—", recebeu: false };
  return { texto: "Ainda não abriu", recebeu: false };
}

const vias = (e: EnvioDaLista) => e.vias.map((v) => ROTULO_VIA[v]).join(" · ") || "—";
const conteudo = (e: EnvioDaLista) =>
  `${e.arquivos} ${e.arquivos === 1 ? "arquivo" : "arquivos"} · ${e.colaboradores} ${e.colaboradores === 1 ? "colaborador" : "colaboradores"}`;

/**
 * DOCUMENTAÇÃO DA EQUIPE (Equipes › Documentação da equipe): o histórico dos pacotes enviados aos
 * clientes. Por linha: ver o envio e a linha do tempo, copiar o link, baixar o zip, mandar o
 * e-mail de novo, gerar um link novo e revogar.
 *
 * Exige "Documentos › Enviar ao cliente": é dado de pessoa saindo da empresa. Quem não tem a
 * permissão não vê o item no menu, é barrado aqui e é recusado em cada rota.
 */
export default async function DocumentacaoEquipePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await auth();
  const user = session!.user!;
  if (!pode(user.permissoes, "documentos", "enviar", user.role)) redirect("/sem-permissao");

  const busca = (sp.q ?? "").trim();
  const situacao = SITUACOES.includes(sp.situacao as SituacaoLink) ? (sp.situacao as SituacaoLink) : "";
  const pagina = Math.max(1, Number(sp.pagina) || 1);

  const { envios, total } = await listarEnvios(user.empresaId, { busca, situacao: situacao || null, pagina, porPagina: POR_PAGINA });

  const colunas = [
    { id: "cliente", titulo: "Cliente", obrigatoria: true, classe: "truncate" },
    // A soma das larguras cabe num notebook sem rolagem lateral: o pacote (arquivos e pessoas) e o
    // prazo ficam em "Colunas" para quem quiser — o detalhe do envio já mostra os dois.
    { id: "conteudo", titulo: "Pacote", largura: 210, classe: "truncate", oculta: true },
    { id: "via", titulo: "Via", largura: 100, classe: "truncate" },
    { id: "link", titulo: "Link", largura: 125 },
    { id: "validade", titulo: "Vale até", largura: 110, oculta: true },
    { id: "recebimento", titulo: "Recebimento", largura: 240, classe: "truncate" },
    { id: "quando", titulo: "Enviado em", largura: 160 },
    { id: "por", titulo: "Por", largura: 130, classe: "truncate" },
    { id: "acoes", titulo: "Ações", largura: 56, fixa: true, semTitulo: true, alinhar: "direita" as const },
  ];

  const linhas = envios.map((e) => {
    const r = recebimento(e);
    return {
      id: e.id,
      atributos: { "data-envio": e.id, "data-link": e.link },
      celulas: {
        cliente: <span className={cn(PLANILHA.nome, "truncate")} data-linha-cliente>{e.clienteNome}</span>,
        conteudo: <span className={PLANILHA.apagado} data-linha-pacote>{conteudo(e)}</span>,
        via: <span className={PLANILHA.apagado} data-linha-via>{vias(e)}</span>,
        link: <SeloLink situacao={e.link} />,
        validade: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{e.expiraEm && e.link !== "SEM_LINK" ? formatarData(e.expiraEm) : "—"}</span>,
        recebimento: <span className={r.recebeu ? "text-ok-texto font-medium" : PLANILHA.apagado} data-linha-recebimento>{r.texto}</span>,
        quando: <span className={cn(PLANILHA.data, PLANILHA.apagado)} data-linha-quando>{formatarDataHora(e.criadoEm)}</span>,
        por: <span className={cn(PLANILHA.apagado, "truncate")} data-linha-por>{e.criadoPor ?? "—"}</span>,
        acoes: <AcoesEnvio envio={e} />,
      },
      titulos: { cliente: e.clienteNome, conteudo: conteudo(e), recebimento: r.texto, por: e.criadoPor ?? "" },
    };
  });

  const cartoes = (
    <ul className="divide-y divide-surface-linha" data-cartoes-envios>
      {envios.map((e) => {
        const r = recebimento(e);
        return (
          <li key={e.id} className="py-3 flex items-start justify-between gap-3" data-cartao-envio={e.id}>
            <div className="min-w-0 space-y-1">
              <p className="font-semibold text-ink truncate">{e.clienteNome}</p>
              <p className="text-xs text-ink-muted truncate">{conteudo(e)} · {vias(e)}</p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <SeloLink situacao={e.link} />
                <span className={cn("text-xs", r.recebeu ? "text-ok-texto font-medium" : "text-ink-muted")}>{r.texto}</span>
              </div>
              <p className="text-xs text-ink-muted flex items-center gap-1">
                <CalendarClock className="w-3 h-3" aria-hidden /> {formatarDataHora(e.criadoEm)}{e.criadoPor ? ` · ${e.criadoPor}` : ""}
              </p>
            </div>
            <AcoesEnvio envio={e} />
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-alt rounded-lg"><FolderOutput className="w-5 h-5 text-ink-muted" aria-hidden /></div>
          <h1 className="page-title flex items-center gap-1.5">
            Documentação da equipe
            <Dica rotulo="Documentação da equipe" lado="direita" texto={AJUDA} />
          </h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full" data-total-envios>{total}</span>
        </div>
        <Link href="/documentacao-equipe/novo" className="btn-primary w-full sm:w-auto justify-center" data-novo-envio>
          <Plus className="w-4 h-4" aria-hidden /> Novo envio
        </Link>
      </div>

      <ListaUrl chave="documentacao-equipe" paramBusca="q" qAtual={busca}>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="flex-1 min-w-0">
            <BuscaSimplesUrl placeholder="Pesquisar pelo cliente" rotulo="Pesquisar envios" />
          </div>
          <FiltroSelectUrl
            param="situacao" vazio="Todos os links" rotulo="Situação do link"
            opcoes={SITUACOES.map((s) => ({ value: s, label: ROTULO_LINK[s] }))}
          />
        </div>

        <ConteudoUrl>
          {envios.length === 0 ? (
            <div className="bg-white rounded-card shadow-card border border-surface-border">
              <ListaVazia
                mensagem={busca || situacao ? "Nenhum envio com esse filtro." : "Nenhum envio por aqui. Use “Novo envio” para montar o primeiro pacote."}
                busca={busca}
              />
            </div>
          ) : (
            <TabelaProUrl
              tela="documentacao-equipe" colunas={colunas} linhas={linhas} cartoes={cartoes} padrao="quando"
              atributos={{ "data-tabela-envios": true }}
              barra={
                <span className="text-sm text-ink-muted flex items-center gap-1.5">
                  {total.toLocaleString("pt-BR")} {total === 1 ? "envio" : "envios"}
                  <Dica
                    rotulo="O que a coluna Recebimento mostra"
                    texto="Quando o cliente abriu o link e quando baixou. O detalhe do envio traz a linha do tempo inteira, com o endereço de onde ele acessou."
                  />
                </span>
              }
            />
          )}
        </ConteudoUrl>

        <PaginacaoUrl total={total} pagina={pagina} porPagina={POR_PAGINA} rotulo="envios" />
      </ListaUrl>
    </div>
  );
}
