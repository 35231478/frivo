import { CalendarClock, Download, FileText, FolderDown } from "lucide-react";
import { agruparItens } from "@/lib/documentacao/pacote";
import { tamanhoEmPalavras } from "@/lib/colaborador/documentos";
import { formatarData } from "@/lib/utils";
import type { DocumentacaoPublica } from "@/lib/documentacao/pacote-server";

/**
 * O QUE O CLIENTE VÊ quando abre o link da documentação da equipe. Sem login e sem estado: é uma
 * lista de arquivos com dois jeitos de baixar — tudo de uma vez (zip) ou um por um.
 *
 * Feita para o celular: quem recebe o link no e-mail costuma abrir ali mesmo, na portaria ou no
 * almoxarifado. Um cartão por pessoa (ou por tipo, se foi assim que a empresa organizou), o botão
 * de baixar tudo em cima, e cada linha grande o bastante para o dedo.
 *
 * Não há nada aqui além do pacote: nem outro colaborador, nem outro documento, nem dado da ficha.
 */
export function DocumentacaoPublicaLista({ token, dados }: { token: string; dados: DocumentacaoPublica }) {
  const base = `/api/publico/documentacao/${encodeURIComponent(token)}`;
  const grupos = agruparItens(dados.itens, dados.organizacao);
  const pessoas = new Set(dados.itens.map((i) => i.colaboradorNome)).size;

  if (!dados.itens.length) {
    return (
      <section className="bg-white rounded-card shadow-card p-6 text-center text-sm text-ink-muted" data-documentacao-vazia>
        Os arquivos deste pacote não estão mais disponíveis. Peça um novo envio a {dados.empresa.nome}.
      </section>
    );
  }

  return (
    <div className="space-y-4" data-documentacao-lista>
      <section className="bg-white rounded-card shadow-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <p className="text-sm text-ink-muted" data-documentacao-resumo>
          <strong className="text-ink">{dados.itens.length}</strong> {dados.itens.length === 1 ? "arquivo" : "arquivos"} de{" "}
          <strong className="text-ink">{pessoas}</strong> {pessoas === 1 ? "colaborador" : "colaboradores"}
        </p>
        <a
          href={`${base}/zip`} data-baixar-tudo
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-acento text-white font-semibold text-sm px-4 py-3 hover:bg-acento-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2"
        >
          <FolderDown className="w-4 h-4" aria-hidden /> Baixar tudo (zip)
        </a>
      </section>

      {grupos.map((g) => (
        <section key={g.titulo} className="bg-white rounded-card shadow-card overflow-hidden" data-grupo={g.titulo}>
          <h2 className="px-4 sm:px-5 py-3 text-sm font-semibold text-ink border-b border-surface-linha bg-surface-alt/60">{g.titulo}</h2>
          <ul className="divide-y divide-surface-linha">
            {g.itens.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 sm:px-5 py-3" data-item-documentacao={i.id}>
                <FileText className="w-5 h-5 shrink-0 text-ink-subtle" aria-hidden />
                <div className="min-w-0 flex-1">
                  <a
                    href={`${base}/arquivo/${encodeURIComponent(i.id)}?ver=1`} target="_blank" rel="noopener noreferrer"
                    className="block text-sm font-medium text-ink hover:text-primary-600 truncate" data-ver-item
                  >
                    {i.rotulo} · {i.nome}
                  </a>
                  <p className="text-xs text-ink-muted flex flex-wrap items-center gap-x-2">
                    {tamanhoEmPalavras(i.tamanho) && <span>{tamanhoEmPalavras(i.tamanho)}</span>}
                    {i.dataVencimento && (
                      <span className={i.vencido ? "text-atrasado font-medium inline-flex items-center gap-1" : "inline-flex items-center gap-1"} data-validade-item={i.vencido ? "vencido" : "em-dia"}>
                        <CalendarClock className="w-3 h-3" aria-hidden />
                        {i.vencido ? `Venceu em ${formatarData(i.dataVencimento)}` : `Válido até ${formatarData(i.dataVencimento)}`}
                      </span>
                    )}
                  </p>
                </div>
                <a
                  href={`${base}/arquivo/${encodeURIComponent(i.id)}`} data-baixar-item aria-label={`Baixar ${i.rotulo} de ${i.colaboradorNome}`}
                  className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-lg border border-surface-border text-ink-muted hover:text-primary-600 hover:bg-primary-50"
                >
                  <Download className="w-4 h-4" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
