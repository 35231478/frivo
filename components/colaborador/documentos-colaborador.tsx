"use client";

import { useRef, useState } from "react";
import { CalendarClock, Download, FileText, Paperclip, ScrollText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { InputData } from "@/components/ui/input-data";
import { FormField } from "@/components/ui/form-field";
import { ItemMenu, MenuAcoes, SeparadorMenu } from "@/components/ui/menu-acoes";
import { StatusPill } from "@/components/ui/status-pill";
import { toast, confirmar } from "@/components/ui/avisos";
import { PLANILHA } from "@/lib/planilha";
import { cn, formatarData } from "@/lib/utils";
import {
  CATEGORIA_PADRAO, NOME_MAX, ROTULO_ORIGEM, TOM_VALIDADE,
  categoriaVenceNormalmente, categoriasPorGrupo, formatoEmPalavras, resumoValidade, rotuloCategoria,
  rotuloValidade, situacaoValidade, tamanhoEmPalavras,
} from "@/lib/colaborador/documentos";
import type { DocumentoLinha } from "@/lib/colaborador/documentos-server";

/** O contrato congelado no momento da assinatura, quando a pessoa veio pela admissão digital. */
export interface ContratoAssinado {
  texto: string;
  assinadoEm: string;
  assinadoPor: string | null;
}

const TAMANHO_MAX_MB = 8;

export const AJUDA_DOCUMENTOS =
  "Os papéis desta pessoa num lugar só: o que o RH anexa aqui e o que o próprio colaborador mandou "
  + "pela admissão digital. Excluir tira o documento da ficha e guarda quem tirou e quando.";

/** Lê o arquivo escolhido como data URL. O tipo real é conferido no servidor, pelos bytes. */
function lerArquivo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === "string" ? resolve(r.result) : reject(new Error("falhou")));
    r.onerror = () => reject(new Error("falhou"));
    r.readAsDataURL(file);
  });
}

function SeloValidade({ data }: { data: string | null }) {
  const v = situacaoValidade(data);
  const texto = rotuloValidade(v);
  if (!texto) {
    // Sem selo (em dia): a data é informação secundária — mesmo tamanho do resto da linha, no
    // cartão do celular e na planilha do desktop.
    return data
      ? <span className={cn(PLANILHA.data, PLANILHA.apagado, "text-xs")}>{formatarData(data)}</span>
      : <span className="text-ink-subtle">—</span>;
  }
  return (
    <StatusPill tom={TOM_VALIDADE[v.situacao] === "atrasado" ? "atrasado" : "atencao"} data-validade={v.situacao}>
      {texto}
    </StatusPill>
  );
}

/** O que a linha diz do arquivo: "PDF · 240 KB". Vazio quando não se sabe (documento antigo). */
function detalheArquivo(d: DocumentoLinha): string {
  return [formatoEmPalavras(d.arquivoTipo), tamanhoEmPalavras(d.tamanho)].filter(Boolean).join(" · ");
}

interface Props {
  colaboradorId: string;
  documentosIniciais: DocumentoLinha[];
  /** "Equipes / Colaboradores › excluir": sem ela o item de excluir não existe. */
  podeExcluir?: boolean;
  somenteLeitura?: boolean;
  contratoAssinado?: ContratoAssinado | null;
  /** Avisa a ficha quando a lista muda (o contador da aba e o aviso de vencido vivem lá em cima). */
  onMudou?: (docs: DocumentoLinha[]) => void;
}

export function DocumentosColaborador({
  colaboradorId, documentosIniciais, podeExcluir = false, somenteLeitura = false,
  contratoAssinado = null, onMudou,
}: Props) {
  const [docs, setDocs] = useState<DocumentoLinha[]>(documentosIniciais);
  const [anexando, setAnexando] = useState(false);
  const [editando, setEditando] = useState<DocumentoLinha | null>(null);
  const [verContrato, setVerContrato] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  function aplicar(novos: DocumentoLinha[]) {
    setDocs(novos);
    onMudou?.(novos);
  }

  const { vencidos, vencendo } = resumoValidade(docs.map((d) => ({ dataVencimento: d.dataVencimento })));

  async function excluir(d: DocumentoLinha) {
    const ok = await confirmar({
      titulo: "Excluir o documento",
      mensagem: `“${d.nome}” sai da ficha. Fica registrado no sistema que foi excluído, por quem e quando.`,
      confirmarTexto: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    setOcupado(d.id);
    try {
      const r = await fetch(`/api/tecnicos/${colaboradorId}/documentos/${d.id}`, { method: "DELETE" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        toast(e?.erro ?? "Não foi possível excluir o documento.", "erro");
        return;
      }
      aplicar(docs.filter((x) => x.id !== d.id));
      toast("Documento excluído.");
    } catch {
      toast("Erro de conexão. Tente novamente.", "erro");
    } finally {
      setOcupado(null);
    }
  }

  const vazio = docs.length === 0 && !contratoAssinado;

  return (
    <div className="space-y-4" data-secao-documentos>
      {(vencidos > 0 || vencendo > 0) && (
        <div
          data-aviso-validade={vencidos > 0 ? "vencido" : "vencendo"}
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            vencidos > 0
              ? "bg-atrasado-claro border-atrasado/20 text-atrasado-texto"
              : "bg-atencao-claro border-atencao/20 text-atencao-texto",
          )}
        >
          <CalendarClock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {vencidos > 0 && <strong>{vencidos === 1 ? "1 documento vencido" : `${vencidos} documentos vencidos`}</strong>}
            {vencidos > 0 && vencendo > 0 && " e "}
            {vencendo > 0 && <span>{vencendo === 1 ? "1 documento vence em breve" : `${vencendo} documentos vencem em breve`}</span>}
            {vencidos > 0 ? ". Atualize o arquivo antes de a pessoa ir para o campo." : "."}
          </span>
        </div>
      )}

      {!somenteLeitura && (
        <Button type="button" variant="secondary" onClick={() => setAnexando(true)} data-anexar-documento>
          <Paperclip className="w-4 h-4" /> Anexar documento
        </Button>
      )}

      {vazio ? (
        <p className="text-sm text-ink-subtle py-6 text-center border border-dashed border-surface-border rounded-lg">
          Nenhum documento nesta ficha. Anexe o contrato, o ASO e os certificados de NR.
        </p>
      ) : (
        <>
          {/* Desktop: planilha */}
          <div className="hidden sm:block overflow-x-auto">
            <table className={PLANILHA.tabela} data-tabela-documentos>
              <thead>
                <tr className={PLANILHA.cabecalho}>
                  <th className={cn(PLANILHA.th, "text-left")}>Documento</th>
                  <th className={cn(PLANILHA.th, "text-left")}>Categoria</th>
                  <th className={cn(PLANILHA.th, "text-left")}>Validade</th>
                  <th className={cn(PLANILHA.th, "text-left")}>Enviado</th>
                  <th className={cn(PLANILHA.th, "w-10")}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {contratoAssinado && <LinhaContrato contrato={contratoAssinado} onVer={() => setVerContrato(true)} />}
                {docs.map((d) => (
                  <tr key={d.id} className={cn(PLANILHA.linha, PLANILHA.linhaHover)} data-documento={d.id}>
                    <td className={PLANILHA.td}>
                      <span className={PLANILHA.nome}>{d.nome}</span>
                      {detalheArquivo(d) && <span className={cn(PLANILHA.apagado, "ml-2 text-[11px]")}>{detalheArquivo(d)}</span>}
                    </td>
                    <td className={cn(PLANILHA.td, PLANILHA.apagado)}>{rotuloCategoria(d)}</td>
                    <td className={PLANILHA.td}><SeloValidade data={d.dataVencimento} /></td>
                    <td className={cn(PLANILHA.td, PLANILHA.apagado)}>
                      <span className={PLANILHA.data}>{formatarData(d.criadoEm)}</span>
                      <span className="block text-[11px]">{quemEnviou(d)}</span>
                    </td>
                    <td className={cn(PLANILHA.td, "text-right")}>
                      <AcoesDocumento
                        doc={d} colaboradorId={colaboradorId} podeExcluir={podeExcluir}
                        somenteLeitura={somenteLeitura} ocupado={ocupado === d.id}
                        onEditar={() => setEditando(d)} onExcluir={() => excluir(d)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: cartões */}
          <div className="sm:hidden space-y-2" data-cartoes-documentos>
            {contratoAssinado && (
              <div className="border border-surface-border rounded-lg p-3 space-y-1" data-cartao-contrato>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-ink flex items-center gap-1.5"><ScrollText className="w-4 h-4 text-acento" /> Contrato assinado</span>
                  <Button type="button" variant="secondary" onClick={() => setVerContrato(true)} className="text-xs py-1 px-2.5 h-auto">Ver o contrato</Button>
                </div>
                <p className="text-xs text-ink-muted">
                  {ROTULO_ORIGEM.ADMISSAO} · {formatarData(contratoAssinado.assinadoEm)}
                  {contratoAssinado.assinadoPor ? ` · ${contratoAssinado.assinadoPor}` : ""}
                </p>
              </div>
            )}
            {docs.map((d) => (
              <div key={d.id} className="border border-surface-border rounded-lg p-3 space-y-1.5" data-cartao-documento={d.id}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-ink">{d.nome}</span>
                  <AcoesDocumento
                    doc={d} colaboradorId={colaboradorId} podeExcluir={podeExcluir}
                    somenteLeitura={somenteLeitura} ocupado={ocupado === d.id}
                    onEditar={() => setEditando(d)} onExcluir={() => excluir(d)}
                  />
                </div>
                <p className="text-xs text-ink-muted">
                  {rotuloCategoria(d)}
                  {detalheArquivo(d) ? ` · ${detalheArquivo(d)}` : ""}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {d.dataVencimento && <SeloValidade data={d.dataVencimento} />}
                  <span className="text-xs text-ink-subtle">{formatarData(d.criadoEm)} · {quemEnviou(d)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {anexando && (
        <ModalAnexar
          colaboradorId={colaboradorId}
          onFechar={() => setAnexando(false)}
          onPronto={(novo) => { aplicar([novo, ...docs]); setAnexando(false); }}
        />
      )}

      {editando && (
        <ModalAlterar
          colaboradorId={colaboradorId} doc={editando}
          onFechar={() => setEditando(null)}
          onPronto={(salvo) => { aplicar(docs.map((x) => (x.id === salvo.id ? salvo : x))); setEditando(null); }}
        />
      )}

      {verContrato && contratoAssinado && (
        <Modal aberto onFechar={() => setVerContrato(false)} titulo="Contrato assinado" tamanho="lg">
          <p className="text-sm text-ink-muted mb-3">
            Assinado em {formatarData(contratoAssinado.assinadoEm)}
            {contratoAssinado.assinadoPor ? ` por ${contratoAssinado.assinadoPor}` : ""}. É o texto congelado no
            momento da assinatura — mudar o modelo depois não altera este.
          </p>
          <pre className="whitespace-pre-wrap text-sm text-ink bg-surface-alt border border-surface-border rounded-lg p-4 max-h-[60vh] overflow-y-auto font-sans">
            {contratoAssinado.texto}
          </pre>
        </Modal>
      )}
    </div>
  );
}

/** Quem pôs o arquivo aqui. Sem nome (documento antigo ou vindo do link), diz a origem. */
function quemEnviou(d: DocumentoLinha): string {
  if (d.origem === "ADMISSAO") return ROTULO_ORIGEM.ADMISSAO;
  return d.criadoPorNome ? `${ROTULO_ORIGEM.MANUAL}: ${d.criadoPorNome}` : ROTULO_ORIGEM.MANUAL;
}

function LinhaContrato({ contrato, onVer }: { contrato: ContratoAssinado; onVer: () => void }) {
  return (
    <tr className={cn(PLANILHA.linha, PLANILHA.linhaHover)} data-linha-contrato>
      <td className={PLANILHA.td}>
        <span className={cn(PLANILHA.nome, "inline-flex items-center gap-1.5")}>
          <ScrollText className="w-3.5 h-3.5 text-acento" /> Contrato assinado
        </span>
      </td>
      <td className={cn(PLANILHA.td, PLANILHA.apagado)}>Contrato de trabalho</td>
      <td className={cn(PLANILHA.td, "text-ink-subtle")}>—</td>
      <td className={cn(PLANILHA.td, PLANILHA.apagado)}>
        <span className={PLANILHA.data}>{formatarData(contrato.assinadoEm)}</span>
        <span className="block text-[11px]">{ROTULO_ORIGEM.ADMISSAO}</span>
      </td>
      <td className={cn(PLANILHA.td, "text-right")}>
        <Button type="button" variant="secondary" onClick={onVer} className="text-xs py-1 px-2.5 h-auto" data-ver-contrato>
          Ver o contrato
        </Button>
      </td>
    </tr>
  );
}

function AcoesDocumento({ doc, colaboradorId, podeExcluir, somenteLeitura, ocupado, onEditar, onExcluir }: {
  doc: DocumentoLinha; colaboradorId: string; podeExcluir: boolean; somenteLeitura: boolean;
  ocupado: boolean; onEditar: () => void; onExcluir: () => void;
}) {
  const base = `/api/tecnicos/${colaboradorId}/documentos/${doc.id}`;
  return (
    <MenuAcoes ocupado={ocupado} rotulo={`Ações de ${doc.nome}`}>
      {(fechar) => (
        <>
          <ItemMenu
            id="baixar" icone={Download} href={doc.temArquivo ? base : undefined} novaAba
            desabilitado={!doc.temArquivo} motivo={doc.temArquivo ? null : "Este documento não tem arquivo anexado."}
          >
            Baixar
          </ItemMenu>
          {!somenteLeitura && (
            <ItemMenu id="alterar" icone={CalendarClock} onClick={() => { fechar(); onEditar(); }}>
              Editar categoria e validade
            </ItemMenu>
          )}
          {!somenteLeitura && podeExcluir && (
            <>
              <SeparadorMenu />
              <ItemMenu id="excluir" icone={Trash2} perigo onClick={() => { fechar(); onExcluir(); }}>
                Excluir
              </ItemMenu>
            </>
          )}
        </>
      )}
    </MenuAcoes>
  );
}

function SeletorCategoria({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <Select value={valor} onChange={(e) => onChange(e.target.value)} data-categoria>
      {categoriasPorGrupo().map((g) => (
        <optgroup key={g.grupo} label={g.rotulo}>
          {g.itens.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

function ModalAnexar({ colaboradorId, onFechar, onPronto }: {
  colaboradorId: string; onFechar: () => void; onPronto: (d: DocumentoLinha) => void;
}) {
  const [categoria, setCategoria] = useState(CATEGORIA_PADRAO);
  const [nome, setNome] = useState("");
  const [validade, setValidade] = useState("");
  const [arquivo, setArquivo] = useState<{ nome: string; dataUrl: string } | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (campo.current) campo.current.value = "";
    if (!f) return;
    if (f.size > TAMANHO_MAX_MB * 1024 * 1024) {
      setErro(`Arquivo muito grande. O limite é ${TAMANHO_MAX_MB} MB.`);
      return;
    }
    setErro("");
    try {
      setArquivo({ nome: f.name, dataUrl: await lerArquivo(f) });
      if (!nome.trim()) setNome(f.name.slice(0, NOME_MAX));
    } catch {
      setErro("Não foi possível ler o arquivo.");
    }
  }

  async function salvar() {
    if (!arquivo) return;
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch(`/api/tecnicos/${colaboradorId}/documentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoria, nome: nome.trim(), arquivoUrl: arquivo.dataUrl, dataVencimento: validade || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d?.erro ?? "Não foi possível anexar o documento."); return; }
      toast("Documento anexado.");
      onPronto(d.documento as DocumentoLinha);
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto onFechar={onFechar} titulo="Anexar documento">
      <div className="space-y-4">
        <FormField label="Categoria">
          <SeletorCategoria valor={categoria} onChange={setCategoria} />
        </FormField>
        <FormField label="Nome do documento" hint="Como ele aparece na lista">
          <Input value={nome} onChange={(e) => setNome(e.target.value.slice(0, NOME_MAX))} placeholder="Ex.: Contrato de trabalho 2024" />
        </FormField>
        <FormField label="Validade" hint="Deixe em branco para documento sem vencimento">
          <InputData value={validade} onChange={(v) => setValidade(v)} />
        </FormField>
        {categoriaVenceNormalmente(categoria) && !validade && (
          <p className="-mt-2 text-sm text-atencao-texto" data-lembrete-validade>
            {rotuloCategoria({ categoria })} costuma ter validade. Sem ela, este documento não entra
            nos avisos de vencimento.
          </p>
        )}

        <input ref={campo} type="file" onChange={escolher} className="hidden" accept="application/pdf,image/*" data-campo-arquivo />
        <div className="flex items-center gap-2 flex-wrap">
          <Button type="button" variant="secondary" onClick={() => campo.current?.click()}>
            <Upload className="w-4 h-4" /> {arquivo ? "Trocar o arquivo" : "Escolher o arquivo"}
          </Button>
          {arquivo && (
            <span className="text-sm text-ink-muted inline-flex items-center gap-1.5">
              <FileText className="w-4 h-4" /> {arquivo.nome}
            </span>
          )}
        </div>

        {erro && <p className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro>{erro}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={!arquivo || salvando} data-salvar-documento>
            {salvando ? "Anexando…" : "Anexar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ModalAlterar({ colaboradorId, doc, onFechar, onPronto }: {
  colaboradorId: string; doc: DocumentoLinha; onFechar: () => void; onPronto: (d: DocumentoLinha) => void;
}) {
  const [categoria, setCategoria] = useState(doc.categoria ?? CATEGORIA_PADRAO);
  const [nome, setNome] = useState(doc.nome);
  const [validade, setValidade] = useState(doc.dataVencimento ? doc.dataVencimento.slice(0, 10) : "");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch(`/api/tecnicos/${colaboradorId}/documentos/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoria, nome: nome.trim(), dataVencimento: validade || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d?.erro ?? "Não foi possível editar o documento."); return; }
      toast("Documento salvo.");
      onPronto(d.documento as DocumentoLinha);
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto onFechar={onFechar} titulo="Editar o documento">
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          O arquivo não muda por aqui. Para trocar, anexe o novo e exclua o antigo.
        </p>
        <FormField label="Categoria">
          <SeletorCategoria valor={categoria} onChange={setCategoria} />
        </FormField>
        <FormField label="Nome do documento">
          <Input value={nome} onChange={(e) => setNome(e.target.value.slice(0, NOME_MAX))} />
        </FormField>
        <FormField label="Validade" hint="Deixe em branco para documento sem vencimento">
          <InputData value={validade} onChange={(v) => setValidade(v)} />
        </FormField>

        {erro && <p className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro>{erro}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={!nome.trim() || salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
