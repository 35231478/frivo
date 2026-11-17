"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Eye, FileSignature, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InputData } from "@/components/ui/input-data";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { CapturaFoto } from "@/components/ui/captura-foto";
import { toast } from "@/components/ui/avisos";
import { PLANILHA } from "@/lib/planilha";
import { cn } from "@/lib/utils";
import {
  ITENS_MAX, camposAPreencher, ehSensivel, erroDosItens, limparItens, rotuloTipo, tipoDe,
  type CampoDoTipo, type ItemDocumento,
} from "@/lib/documentos/modelos";

/** O modelo como a tela precisa dele (o que a lista do cadastro devolve). */
export interface ModeloDaLista {
  id: string;
  nome: string;
  tipo: string;
  texto: string;
  temItens: boolean;
  exigeAssinatura: boolean;
  validadeDias: number | null;
}

/** O papel gerado, como o servidor devolve (EmitidoResumo). */
export interface EmitidoDaTela {
  id: string;
  tipo: string;
  tipoRotulo: string;
  titulo: string;
  criadoEm: string;
  criadoPor: string | null;
  assinadoEm: string | null;
  assinadoPor: string | null;
  exigeAssinatura: boolean;
  canceladoEm: string | null;
  cancelamentoMotivo: string | null;
  documentoId: string | null;
  itens: number;
}

const ITEM_VAZIO: ItemDocumento = { descricao: "", ca: "", quantidade: 1, entregaEm: "" };

/** "AAAA-MM-DD" do dia de hoje, que é o padrão das datas de entrega. */
const hojeISO = () => new Date().toISOString().slice(0, 10);

/**
 * GERAR DOCUMENTO na ficha do colaborador: escolher o modelo, completar o que o sistema não sabe,
 * ver a prévia e gerar. Se o modelo pede assinatura, ela acontece aqui mesmo, na hora da entrega —
 * nome digitado e foto, com o servidor gravando IP, navegador e hora.
 *
 * O que a tela NÃO faz: decidir o que vale. Quem recusa item sem CA, campo obrigatório em branco e
 * papel sensível sem permissão é o servidor; aqui as mesmas regras puras só evitam a ida à toa.
 */
export function GerarDocumento({
  colaboradorId, modelos, podeDisciplinar, aberto, onFechar, onGerado, emitidoInicial = null,
}: {
  colaboradorId: string;
  modelos: ModeloDaLista[];
  podeDisciplinar: boolean;
  aberto: boolean;
  onFechar: () => void;
  onGerado: (emitido: EmitidoDaTela) => void;
  /** Quando vem preenchido, o diálogo abre direto na assinatura de um papel que já existe. */
  emitidoInicial?: EmitidoDaTela | null;
}) {
  const [modeloId, setModeloId] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [itens, setItens] = useState<ItemDocumento[]>([{ ...ITEM_VAZIO, entregaEm: hojeISO() }]);
  const [previa, setPrevia] = useState<{ texto: string; desconhecidos: string[] } | null>(null);
  const [emitido, setEmitido] = useState<EmitidoDaTela | null>(null);
  const [nome, setNome] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  /** Modelo que a pessoa pode usar: o disciplinar some de quem não tem a permissão. */
  const disponiveis = useMemo(
    () => modelos.filter((m) => podeDisciplinar || !ehSensivel(m.tipo)),
    [modelos, podeDisciplinar],
  );
  const modelo = disponiveis.find((m) => m.id === modeloId) ?? null;
  const campos: CampoDoTipo[] = modelo ? camposAPreencher(modelo.texto, modelo.tipo) : [];

  useEffect(() => {
    if (aberto) { setEmitido(emitidoInicial); return; }
    // fechar limpa tudo: o próximo documento começa do zero, não do rascunho do anterior
    setModeloId(""); setValores({}); setItens([{ ...ITEM_VAZIO, entregaEm: hojeISO() }]);
    setPrevia(null); setEmitido(null); setNome(""); setSelfie(null); setErro(""); setOcupado(false);
  }, [aberto]);

  function trocarModelo(id: string) {
    setModeloId(id);
    setPrevia(null);
    setErro("");
    const m = disponiveis.find((x) => x.id === id);
    // A data de entrega já nasce hoje: é o dia da entrega em quase todo caso, e quem precisa de
    // outra troca em um toque. Deixar vazio só faria o RH digitar a data de hoje todo dia.
    const datas = m ? camposAPreencher(m.texto, m.tipo).filter((c) => c.formato === "data") : [];
    setValores(Object.fromEntries(datas.map((c) => [c.id, hojeISO()])));
    setItens(m?.temItens ? [{ ...ITEM_VAZIO, entregaEm: hojeISO() }] : []);
  }

  const corpo = () => ({
    modeloId,
    valores,
    itens: modelo?.temItens ? limparItens(itens) : [],
  });

  /** O que as regras puras já sabem dizer sem ir ao servidor. */
  function problemaLocal(): string | null {
    if (!modelo) return "Escolha o modelo do documento.";
    const faltando = campos.filter((c) => c.obrigatorio && !valores[c.id]?.trim()).map((c) => c.rotulo);
    if (faltando.length) return `Preencha: ${faltando.join(", ")}.`;
    if (modelo.temItens) return erroDosItens(limparItens(itens), modelo.tipo);
    return null;
  }

  async function chamar(url: string, dados: unknown): Promise<any | null> {
    setErro(""); setOcupado(true);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(json?.erro ?? "Não foi possível concluir."); return null; }
      return json;
    } catch {
      setErro("Erro de conexão. Tente novamente.");
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function verPrevia() {
    const problema = problemaLocal();
    if (problema) { setErro(problema); return; }
    const r = await chamar(`/api/tecnicos/${colaboradorId}/documentos-gerados/previa`, corpo());
    if (r) setPrevia({ texto: r.texto, desconhecidos: r.desconhecidos ?? [] });
  }

  async function gerar() {
    const problema = problemaLocal();
    if (problema) { setErro(problema); return; }
    const r = await chamar(`/api/tecnicos/${colaboradorId}/documentos-gerados`, corpo());
    if (!r) return;
    setEmitido(r);
    onGerado(r);
    if (!r.exigeAssinatura) {
      toast("Documento gerado e guardado nos documentos da ficha.");
      onFechar();
    }
  }

  async function assinar() {
    if (!emitido) return;
    const r = await chamar(`/api/documentos-gerados/${emitido.id}/assinar`, { nome, selfie });
    if (!r) return;
    onGerado(r);
    toast("Documento assinado e guardado na ficha.");
    onFechar();
  }

  function mexerItem(i: number, campo: keyof ItemDocumento, valor: string) {
    setItens((lista) => lista.map((it, n) => (n === i ? { ...it, [campo]: campo === "quantidade" ? Number(valor.replace(/\D/g, "")) || 0 : valor } : it)));
  }

  const titulo = emitido ? "Assinar o documento" : "Gerar documento";

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={titulo} tamanho="lg">
      <div className="space-y-4" data-gerar-documento>
        {erro && (
          <div role="alert" data-erro-gerar className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2">
            {erro}
          </div>
        )}

        {/* ───────── passo 2: a assinatura, depois de gerado ───────── */}
        {emitido ? (
          <>
            <p className="text-sm text-ink-muted">
              <strong className="text-ink">{emitido.titulo}</strong> está gerado e aguardando a assinatura.
              Enquanto não for assinado, ele não entra nos documentos da ficha.
            </p>
            <FormField label="Nome completo de quem assina" required
              hint="É a assinatura. Fica registrada com data, hora, endereço de IP e navegador.">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} caixa="nome" data-assinatura-nome autoComplete="name" />
            </FormField>
            <CapturaFoto valor={selfie} onValor={setSelfie} onErro={setErro} rotulo="Foto de quem está recebendo" />
            <div className="flex flex-col sm:flex-row gap-2 sm:justify-end pt-1">
              <a href={`/api/documentos-gerados/${emitido.id}/pdf?ver=1`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 text-sm text-ink-muted hover:text-ink px-3 py-2" data-ver-previa-pdf>
                <Eye className="w-4 h-4" /> Ver o PDF
              </a>
              <Button type="button" variant="secondary" onClick={onFechar}>Assinar depois</Button>
              <Button type="button" loading={ocupado} onClick={assinar} disabled={nome.trim().length < 3 || !selfie} data-assinar-documento>
                <Check className="w-4 h-4" /> Assinar
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* ───────── passo 1: o modelo e os campos ───────── */}
            <FormField label="Modelo" required>
              <Select value={modeloId} onChange={(e) => trocarModelo(e.target.value)} data-escolher-modelo>
                <option value="">Escolha o modelo…</option>
                {disponiveis.map((m) => (
                  <option key={m.id} value={m.id}>{m.nome} · {rotuloTipo(m.tipo)}</option>
                ))}
              </Select>
            </FormField>

            {disponiveis.length === 0 && (
              <div className="flex items-start gap-2 bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-3 py-2" data-sem-modelo>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Nenhum modelo cadastrado ainda. Crie em Configurações › Modelos de documento.</span>
              </div>
            )}

            {modelo && campos.length > 0 && (
              <FormGrid>
                {campos.map((c) => (
                  <FormField key={c.id} label={c.rotulo} required={c.obrigatorio}
                    className={c.formato === "textoLongo" ? "sm:col-span-2" : undefined}>
                    {c.formato === "data" ? (
                      <div data-campo-valor={c.id}>
                        <InputData value={valores[c.id] ?? ""} onChange={(v) => setValores((x) => ({ ...x, [c.id]: v }))} aria-label={c.rotulo} />
                      </div>
                    ) : c.formato === "textoLongo" ? (
                      <Textarea value={valores[c.id] ?? ""} rows={3} data-campo-valor={c.id}
                        onChange={(e) => setValores((x) => ({ ...x, [c.id]: e.target.value }))} />
                    ) : (
                      <Input value={valores[c.id] ?? ""} data-campo-valor={c.id}
                        inputMode={c.formato === "numero" ? "numeric" : undefined}
                        onChange={(e) => setValores((x) => ({ ...x, [c.id]: e.target.value }))} />
                    )}
                  </FormField>
                ))}
              </FormGrid>
            )}

            {/* ───────── a lista de itens (a ficha de EPI) ───────── */}
            {modelo?.temItens && (
              <div data-itens-documento>
                <p className="text-sm font-semibold text-ink mb-1.5">
                  Itens entregues
                  {tipoDe(modelo.tipo).id === "EPI" && (
                    <span className="block text-xs font-normal text-ink-subtle">
                      O número do CA é o que dá valor legal à ficha. Material sem CA não é EPI: vai num termo de responsabilidade.
                    </span>
                  )}
                </p>
                <div className="overflow-x-auto">
                  <table className={PLANILHA.tabela}>
                    <thead>
                      <tr className={PLANILHA.cabecalho}>
                        <th className={cn(PLANILHA.th, "text-left")}>Item</th>
                        <th className={cn(PLANILHA.th, "text-left w-28")}>CA</th>
                        <th className={cn(PLANILHA.th, "text-left w-20")}>Qtd.</th>
                        <th className={cn(PLANILHA.th, "text-left w-36")}>Entrega</th>
                        <th className={cn(PLANILHA.th, "w-10")}><span className="sr-only">Ações</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((it, i) => (
                        <tr key={i} className={PLANILHA.linha} data-item-linha={i}>
                          <td className={PLANILHA.td}>
                            <Input value={it.descricao} placeholder="Ex.: Luva de vaqueta" data-item-descricao={i}
                              onChange={(e) => mexerItem(i, "descricao", e.target.value)} />
                          </td>
                          <td className={PLANILHA.td}>
                            <Input value={it.ca ?? ""} placeholder="12345" data-item-ca={i} inputMode="numeric"
                              onChange={(e) => mexerItem(i, "ca", e.target.value)} />
                          </td>
                          <td className={PLANILHA.td}>
                            <Input value={String(it.quantidade ?? "")} inputMode="numeric" data-item-quantidade={i}
                              onChange={(e) => mexerItem(i, "quantidade", e.target.value)} />
                          </td>
                          <td className={PLANILHA.td}>
                            <div data-item-entrega={i}>
                              <InputData value={it.entregaEm ?? ""} onChange={(v) => mexerItem(i, "entregaEm", v)} aria-label={`Entrega do item ${i + 1}`} />
                            </div>
                          </td>
                          <td className={cn(PLANILHA.td, "text-right")}>
                            {itens.length > 1 && (
                              <button type="button" aria-label={`Tirar o item ${i + 1}`} data-tirar-item={i}
                                onClick={() => setItens((l) => l.filter((_, n) => n !== i))}
                                className="text-ink-subtle hover:text-atrasado p-1">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {itens.length < ITENS_MAX && (
                  <Button type="button" variant="secondary" className="mt-2" data-mais-um-item
                    onClick={() => setItens((l) => [...l, { ...ITEM_VAZIO, entregaEm: hojeISO() }])}>
                    <Plus className="w-4 h-4" /> Mais um item
                  </Button>
                )}
              </div>
            )}

            {/* ───────── a prévia ───────── */}
            {previa && (
              <div data-previa-documento>
                <p className="text-sm font-semibold text-ink mb-1.5">Prévia — ainda não gerado</p>
                {previa.desconhecidos.length > 0 && (
                  <div className="flex items-start gap-2 bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-3 py-2 mb-2" data-previa-desconhecidos>
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      O modelo usa <strong className="font-mono">{previa.desconhecidos.map((c) => `{{${c}}}`).join(", ")}</strong>,
                      que o sistema não conhece — sai assim mesmo no documento. Corrija o modelo em Configurações.
                    </span>
                  </div>
                )}
                <pre className="text-xs text-ink whitespace-pre-wrap break-words font-sans bg-surface-alt border border-surface-border rounded-lg p-3 max-h-64 overflow-y-auto">
                  {previa.texto}
                </pre>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 sm:justify-end pt-1">
              <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
              <Button type="button" variant="secondary" onClick={verPrevia} disabled={!modelo} loading={ocupado && !emitido} data-ver-previa>
                <Eye className="w-4 h-4" /> Ver a prévia
              </Button>
              <Button type="button" onClick={gerar} disabled={!modelo} loading={ocupado} data-gerar>
                <FileSignature className="w-4 h-4" /> Gerar
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
