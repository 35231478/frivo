"use client";

import { confirmar, toast } from "@/components/ui/avisos";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { whatsappLink, formatarMoeda, formatarData, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import { ItemMenu, MenuAcoes, SeparadorMenu } from "@/components/ui/menu-acoes";
import {
  motivoNaoCancelar, motivoNaoExcluir, motivoNaoReceber, motivoNaoRecibo, motivoNaoTrocarCliente, origemComLink, travasDaConta,
} from "@/lib/financeiro/conta-receber-gestao";
import {
  MessageCircle, MessageSquare, Mail, FileText, CheckCircle2, Eye, Settings, Download, Ban, Pencil, Trash2, Receipt, ExternalLink, Split,
} from "lucide-react";
import {
  motivoNaoParcelar, motivoParcialComBoleto, motivoValorRecebimento, quitaConta, saldoDaConta, type ParcelaPlano,
} from "@/lib/financeiro/parcelas";
import { EditorParcelas } from "@/components/financeiro/editor-parcelas";
import { chaveDiaCivil, chaveHojeBR } from "@/lib/fuso";
import { InputData } from "@/components/ui/input-data";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

export interface ContaAcoes {
  id: string; numero: string; descricao: string; categoriaId?: string | null; categoria?: string | null; valor: number;
  dataVencimento: string | null; status: string; banco: string | null;
  clienteId: string; clienteNome: string; whatsapp: string | null; email: string | null;
  notificacaoEnviadaEm?: string | null;
  formaPagamento?: string | null; observacao?: string | null;
  centroCustoId?: string | null; contaBancariaId?: string | null;
  medicaoId?: string | null; orcamentoId?: string | null; contratoId?: string | null;
  medicaoNumero?: string | null; orcamentoCodigo?: string | null; contratoNumero?: string | null; medicaoAvulsa?: boolean | null;
  /** Status das notas fiscais ligadas (só o status importa para as regras) */
  notas?: { status: string }[];
  interAtivo: boolean;
  boletoStatus: string | null;
  boletoEmitidoEm: string | null;
  boletoVencimento: string | null;
  boletoLinhaDigitavel: string | null;
  boletoCodigoBarras: string | null;
  /** Baixa parcial (quanto já entrou) e parcela (de qual lançamento, n/N) */
  valorRecebido?: number;
  lancamentoId?: string | null; lancamentoNumero?: string | null; parcelaNumero?: number | null; parcelaTotal?: number | null;
}
type Categoria = { id: string; nome: string; cor: string; ativo: boolean };
type Modais = null | "whatsapp" | "email" | "receber" | "parcelar" | "editar" | "cancelar" | "excluir" | "boletoEmitir" | "boletoConfig" | "boletoEmitido";

/**
 * Ações da conta a receber num menu ⋮ só (o que o status permite; o que não pode aparece apagado com ⓘ
 * dizendo por quê). As regras são as mesmas do servidor: lib/financeiro/conta-receber-gestao.
 */
export function ContaReceberAcoes({ conta, categorias = [], clientes = [], onDetalhes }: {
  conta: ContaAcoes; categorias?: Categoria[]; clientes?: { id: string; nome: string }[]; onDetalhes: () => void;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<Modais>(null);
  const [boleto, setBoleto] = useState({ linhaDigitavel: conta.boletoLinhaDigitavel, codigoBarras: conta.boletoCodigoBarras });
  const [baixando, setBaixando] = useState(false);
  const fechar = () => setModal(null);
  const pronto = () => { fechar(); router.refresh(); };

  const regra = { ...conta, notas: conta.notas ?? [] };
  const quitada = conta.status === "RECEBIDO" || conta.status === "CANCELADO";
  const boletoEmitido = conta.boletoStatus === "EMITIDO";
  const naoReceber = motivoNaoReceber(regra);
  const naoCancelar = motivoNaoCancelar(regra);
  const naoExcluir = motivoNaoExcluir(regra);
  const naoRecibo = motivoNaoRecibo(regra);
  const naoParcelar = motivoNaoParcelar(regra);
  const saldo = saldoDaConta(conta);
  const venc = conta.dataVencimento ? formatarData(conta.dataVencimento) : "—";
  // A cobrança é do que falta (a parte já paga não se cobra de novo)
  const msg = `Olá ${conta.clienteNome}, lembramos que há uma pendência financeira no valor de ${formatarMoeda(saldo || conta.valor)} com vencimento em ${venc}. Entre em contato para regularização.`;

  async function registrarCobranca(canal: "whatsapp" | "email") {
    try { await fetch(`/api/contas-receber/${conta.id}/notificar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canal }) }); } catch {}
    router.refresh();
  }
  function abrirBoleto() {
    if (boletoEmitido) setModal("boletoEmitido");
    else if (conta.interAtivo) setModal("boletoEmitir");
    else setModal("boletoConfig");
  }
  async function baixarPdfBoleto() {
    setBaixando(true);
    try { await abrirPdfBoleto(conta.id); } finally { setBaixando(false); }
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <MenuAcoes ocupado={baixando}>
          {(f) => (
            <>
              <ItemMenu icone={Eye} onClick={() => { f(); onDetalhes(); }} id="detalhes">Ver detalhes</ItemMenu>
              <ItemMenu icone={Pencil} onClick={() => { f(); setModal("editar"); }} id="editar">Editar</ItemMenu>
              {!quitada && <ItemMenu icone={CheckCircle2} onClick={() => { f(); setModal("receber"); }} desabilitado={!!naoReceber} motivo={naoReceber} id="receber">Informar recebimento</ItemMenu>}
              {!quitada && <ItemMenu icone={Split} onClick={() => { f(); setModal("parcelar"); }} desabilitado={!!naoParcelar} motivo={naoParcelar} id="parcelar">Parcelar</ItemMenu>}
              <SeparadorMenu />
              {(!quitada || boletoEmitido) && (
                <ItemMenu icone={FileText} onClick={() => { f(); abrirBoleto(); }} id="boleto">{boletoEmitido ? "Boleto (linha digitável)" : "Emitir boleto"}</ItemMenu>
              )}
              {boletoEmitido && <ItemMenu icone={Download} onClick={() => { f(); baixarPdfBoleto(); }} id="boleto-pdf">Baixar boleto (PDF)</ItemMenu>}
              {!quitada && conta.whatsapp && <ItemMenu icone={MessageSquare} onClick={() => { f(); setModal("whatsapp"); }} id="cobrar-whatsapp">Enviar cobrança por WhatsApp</ItemMenu>}
              {!quitada && conta.email && <ItemMenu icone={Mail} onClick={() => { f(); setModal("email"); }} id="cobrar-email">Enviar cobrança por e-mail</ItemMenu>}
              <ItemMenu icone={Receipt} href={`/financeiro/contas-receber/${conta.id}/recibo`} novaAba desabilitado={!!naoRecibo} motivo={naoRecibo} id="recibo">Emitir recibo (PDF)</ItemMenu>
              <SeparadorMenu />
              {conta.status !== "CANCELADO" && conta.status !== "RECEBIDO" && (
                <ItemMenu icone={Ban} onClick={() => { f(); setModal("cancelar"); }} desabilitado={!!naoCancelar} motivo={naoCancelar} perigo id="cancelar">Cancelar</ItemMenu>
              )}
              <ItemMenu icone={Trash2} onClick={() => { f(); setModal("excluir"); }} desabilitado={!!naoExcluir} motivo={naoExcluir} perigo id="excluir">Excluir</ItemMenu>
            </>
          )}
        </MenuAcoes>
      </div>

      {/* Cobrança: WhatsApp */}
      <Modal aberto={modal === "whatsapp"} onFechar={fechar} titulo="Enviar cobrança por WhatsApp" tamanho="sm">
        <p className="text-sm text-ink-muted mb-2">Prévia da mensagem para <strong>{conta.clienteNome}</strong>:</p>
        <div className="bg-surface-alt rounded-lg p-3 text-sm text-ink whitespace-pre-wrap">{msg}</div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={fechar}>Cancelar</Button>
          <Button onClick={() => { registrarCobranca("whatsapp"); window.open(whatsappLink(conta.whatsapp, msg), "_blank"); fechar(); }}><MessageCircle className="w-4 h-4" /> Abrir WhatsApp</Button>
        </div>
      </Modal>

      {/* Cobrança: e-mail */}
      <Modal aberto={modal === "email"} onFechar={fechar} titulo="Enviar cobrança por e-mail" tamanho="sm">
        <p className="text-sm text-ink-muted mb-2">Prévia para <strong>{conta.email}</strong>:</p>
        <div className="bg-surface-alt rounded-lg p-3 text-sm text-ink whitespace-pre-wrap">{msg}</div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={fechar}>Cancelar</Button>
          <Button onClick={() => { registrarCobranca("email"); window.location.href = `mailto:${conta.email}?subject=${encodeURIComponent(`Pendência financeira — ${conta.numero}`)}&body=${encodeURIComponent(msg)}`; fechar(); }}><Mail className="w-4 h-4" /> Abrir e-mail</Button>
        </div>
      </Modal>

      {/* Boleto: integração não configurada */}
      <Modal aberto={modal === "boletoConfig"} onFechar={fechar} titulo="Emitir boleto" tamanho="sm">
        <p className="text-sm text-ink-muted">A integração com o Banco Inter ainda não está ativa. Configure as credenciais e o certificado para emitir boletos.</p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={fechar}>Fechar</Button>
          <Link href={hrefSecaoConfig("banco-inter")} className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold"><Settings className="w-4 h-4" /> Configurar</Link>
        </div>
      </Modal>

      <Modal aberto={modal === "boletoEmitir"} onFechar={fechar} titulo="Emitir boleto — Banco Inter">
        <EmitirBoleto conta={conta} onEmitido={(b) => { setBoleto(b); setModal("boletoEmitido"); router.refresh(); }} />
      </Modal>
      <Modal aberto={modal === "boletoEmitido"} onFechar={fechar} titulo="Boleto">
        <BoletoEmitido conta={conta} boleto={boleto} onAlterado={pronto} />
      </Modal>

      <Modal aberto={modal === "receber"} onFechar={fechar} titulo={`Informar recebimento — ${conta.numero}`}>
        <InformarRecebimento conta={conta} onPronto={pronto} onCancelar={fechar} />
      </Modal>
      <Modal aberto={modal === "parcelar"} onFechar={fechar} titulo={`Parcelar ${conta.numero}`} tamanho="lg">
        <ParcelarConta conta={conta} onPronto={pronto} onCancelar={fechar} />
      </Modal>
      <Modal aberto={modal === "editar"} onFechar={fechar} titulo={`Editar ${conta.numero}`} tamanho="lg">
        <EditarCobranca conta={conta} categorias={categorias} clientes={clientes} onPronto={pronto} onCancelar={fechar} />
      </Modal>
      <Modal aberto={modal === "cancelar"} onFechar={fechar} titulo={`Cancelar ${conta.numero}`} tamanho="sm">
        <CancelarConta conta={conta} onPronto={pronto} onCancelar={fechar} />
      </Modal>
      <Modal aberto={modal === "excluir"} onFechar={fechar} titulo={`Excluir ${conta.numero}`} tamanho="sm">
        <ExcluirConta conta={conta} onPronto={pronto} onCancelar={fechar} />
      </Modal>
    </>
  );
}

/** Abre o PDF do boleto (vem do Banco Inter pelo nosso servidor). */
export async function abrirPdfBoleto(id: string) {
  try {
    const res = await fetch(`/api/contas-receber/${id}/boleto/pdf`);
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.pdf) window.open(d.pdf, "_blank");
    else toast(d.erro ?? "Erro ao baixar o boleto.", "erro");
  } catch { toast("Sem conexão. Tente novamente.", "erro"); }
}

const Erro = ({ texto }: { texto: string }) =>
  texto ? <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-conta>{texto}</div> : null;

async function enviar(url: string, method: string, corpo: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    if (res.ok) return null;
    const e = await res.json().catch(() => ({}));
    return e.erro ?? "Não foi possível salvar.";
  } catch { return "Sem conexão. Tente novamente."; }
}

function EditarCobranca({ conta, categorias, clientes, onPronto, onCancelar }: {
  conta: ContaAcoes; categorias: Categoria[]; clientes: { id: string; nome: string }[]; onPronto: () => void; onCancelar: () => void;
}) {
  const regra = { ...conta, notas: conta.notas ?? [] };
  const travas = travasDaConta(regra);
  const naoTrocarCliente = motivoNaoTrocarCliente(regra);
  const origem = origemComLink(conta);
  const [clienteId, setClienteId] = useState(conta.clienteId);
  const [descricao, setDescricao] = useState(conta.descricao);
  const [categoriaId, setCategoriaId] = useState(conta.categoriaId ?? "");
  // Conta antiga cujo nome não casou com nenhuma categoria: mostra o texto e pede a escolha
  const textoAntigo = !conta.categoriaId && conta.categoria ? conta.categoria : null;
  const [centroCustoId, setCentroCustoId] = useState(conta.centroCustoId ?? "");
  const [forma, setForma] = useState(conta.formaPagamento ?? "");
  const [contaBancariaId, setContaBancariaId] = useState(conta.contaBancariaId ?? "");
  const bancoAntigo = !conta.contaBancariaId && conta.banco ? conta.banco : null;
  const [valor, setValor] = useState(String(conta.valor));
  const [vencimento, setVencimento] = useState(conta.dataVencimento ? chaveDiaCivil(conta.dataVencimento) : "");
  const [observacao, setObservacao] = useState(conta.observacao ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    if (!descricao.trim()) { setErro("Informe a descrição."); return; }
    if (!travas.valor && !(Number(valor) > 0)) { setErro("Informe um valor maior que zero."); return; }
    setErro(""); setSalvando(true);
    const e = await enviar(`/api/contas-receber/${conta.id}`, "PUT", {
      descricao: descricao.trim(),
      ...(!travas.valor && { valor: Number(valor) }),
      ...(!travas.vencimento && { dataVencimento: vencimento || null }),
      formaPagamento: forma || null,
      observacao: observacao.trim() || null,
      ...(clienteId !== conta.clienteId && { clienteId }),
      // Vínculos por ID, só se mudaram (editar outra coisa não apaga o texto antigo de quem não tem vínculo)
      ...(categoriaId !== (conta.categoriaId ?? "") && { categoriaId: categoriaId || null }),
      ...(centroCustoId !== (conta.centroCustoId ?? "") && { centroCustoId: centroCustoId || null }),
      ...(contaBancariaId !== (conta.contaBancariaId ?? "") && { contaBancariaId: contaBancariaId || null }),
    });
    setSalvando(false);
    if (e) { setErro(e); return; }
    toast(`${conta.numero} atualizada.`, "sucesso");
    onPronto();
  }

  return (
    <div className="space-y-4" data-editar-conta>
      <Erro texto={erro} />
      <FormGrid>
        <FormField label="Cliente" dica={naoTrocarCliente ?? undefined}>
          {naoTrocarCliente
            ? <p className="text-sm text-ink py-2" data-cliente-leitura>{conta.clienteNome}</p>
            : (
              <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)} aria-label="Cliente" data-cliente-select>
                {!clientes.some((c) => c.id === conta.clienteId) && <option value={conta.clienteId}>{conta.clienteNome}</option>}
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            )}
        </FormField>
        <FormField label="Origem">
          <p className="text-sm py-2" data-origem-leitura>
            {origem ? <Link href={origem.href} className="text-acento hover:underline inline-flex items-center gap-1">{origem.rotulo} <ExternalLink className="w-3 h-3" aria-hidden /></Link> : <span className="text-ink-muted">Lançamento manual</span>}
          </p>
        </FormField>
      </FormGrid>
      <FormField label="Descrição" required><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={500} /></FormField>
      <FormGrid>
        <FormField label="Valor" required>
          <Input type="number" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} disabled={!!travas.valor} aria-label="Valor" />
          {travas.valor && <p className="text-xs text-ink-muted mt-1" data-trava-valor>{travas.valor}</p>}
        </FormField>
        <FormField label="Vencimento">
          <InputData value={vencimento} onChange={setVencimento} disabled={!!travas.vencimento} aria-label="Vencimento" />
          {travas.vencimento && <p className="text-xs text-ink-muted mt-1" data-trava-vencimento>{travas.vencimento}</p>}
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Categoria">
          {/* Só ativas para nova escolha; a categoria atual segue visível mesmo inativa */}
          <SeletorCadastro entidade="categorias-financeiras" itens={categorias} valor={categoriaId} vazio={textoAntigo ? "Escolha a categoria…" : "Sem categoria"} onChange={setCategoriaId} />
          {textoAntigo && !categoriaId && (
            <p className="text-xs text-atencao-texto mt-1" data-categoria-antiga>Categoria antiga: “{textoAntigo}” (sem cadastro). Escolha uma categoria para ligar esta conta.</p>
          )}
        </FormField>
        <FormField label="Centro de custo">
          <SeletorCadastro entidade="centros-custo" valor={centroCustoId} vazio="Sem centro de custo" onChange={setCentroCustoId} nome="centroCustoId" />
        </FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Forma de pagamento">
          <Select value={forma} onChange={(e) => setForma(e.target.value)} aria-label="Forma de pagamento">
            <option value="">Não definida</option>
            {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
        <FormField label="Conta bancária" dica="Onde o dinheiro entra. Cadastre em Financeiro › Contas bancárias.">
          <SeletorCadastro entidade="contas-bancarias" valor={contaBancariaId} vazio={bancoAntigo ? "Escolha a conta…" : "Não definida"} onChange={setContaBancariaId} nome="contaBancariaId" />
          {bancoAntigo && !contaBancariaId && <p className="text-xs text-ink-muted mt-1" data-banco-antigo>Banco informado antes: “{bancoAntigo}”.</p>}
        </FormField>
      </FormGrid>
      <FormField label="Observações"><Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} maxLength={2000} /></FormField>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
        <Button loading={salvando} onClick={salvar} data-salvar-conta>Salvar</Button>
      </div>
    </div>
  );
}

function InformarRecebimento({ conta, onPronto, onCancelar }: { conta: ContaAcoes; onPronto: () => void; onCancelar: () => void }) {
  const saldo = saldoDaConta(conta);
  const recebido = conta.valorRecebido ?? 0;
  // Padrão: o que falta (baixa total). Menos que isso = baixa PARCIAL: o resto continua em aberto
  const [valor, setValor] = useState(String(saldo));
  const [data, setData] = useState(chaveHojeBR());
  const [forma, setForma] = useState(conta.formaPagamento ?? "");
  const [contaBancariaId, setContaBancariaId] = useState(conta.contaBancariaId ?? "");
  const [comentario, setComentario] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const v = Number(valor);
  const parcial = v > 0 && !quitaConta(conta, v);
  const invalido = motivoValorRecebimento(conta, v) ?? motivoParcialComBoleto(conta, v);

  async function confirmarBaixa() {
    if (!data) { setErro("Informe a data do recebimento."); return; }
    if (invalido) { setErro(invalido); return; }
    setErro(""); setSalvando(true);
    const e = await enviar(`/api/contas-receber/${conta.id}/recebimentos`, "POST", {
      valor: v, data, formaPagamento: forma || null, comentario: comentario.trim() || null,
      // Só se mudou (a conta bancária da conta vale por padrão; inativa não é escolha nova)
      ...(contaBancariaId !== (conta.contaBancariaId ?? "") && { contaBancariaId: contaBancariaId || null }),
    });
    setSalvando(false);
    if (e) { setErro(e); return; }
    toast(parcial ? `Recebimento parcial de ${formatarMoeda(v)} em ${conta.numero}. Falta ${formatarMoeda(Math.round((saldo - v) * 100) / 100)}.` : `${conta.numero} recebida.`, "sucesso");
    onPronto();
  }

  return (
    <div className="space-y-4" data-informar-recebimento>
      <Erro texto={erro} />
      <dl className="bg-surface-alt rounded-lg p-3 text-sm grid grid-cols-3 gap-2" data-resumo-baixa>
        <div><dt className="text-xs text-ink-muted">Valor da conta</dt><dd className="font-semibold text-ink tabular-nums">{formatarMoeda(conta.valor)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Já recebido</dt><dd className="font-semibold text-success-700 tabular-nums">{formatarMoeda(recebido)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Falta receber</dt><dd className="font-semibold text-atencao-texto tabular-nums" data-valor-baixa>{formatarMoeda(saldo)}</dd></div>
      </dl>
      <FormGrid>
        <FormField label="Valor recebido" required dica="Menos que o que falta = recebimento parcial: o restante continua em aberto, no mesmo vencimento.">
          <Input type="number" step="0.01" min="0.01" max={saldo} value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Valor recebido" data-valor-recebido />
        </FormField>
        <FormField label="Data do recebimento" required><InputData value={data} onChange={setData} aria-label="Data do recebimento" /></FormField>
      </FormGrid>
      {parcial && !invalido && (
        <p className="text-sm text-atencao-texto" data-aviso-parcial>Recebimento parcial: continuam em aberto <strong>{formatarMoeda(Math.round((saldo - v) * 100) / 100)}</strong>.</p>
      )}
      {invalido && valor !== "" && <p role="alert" className="text-sm text-atrasado-texto" data-invalido-baixa>{invalido}</p>}
      <FormGrid>
        <FormField label="Forma de pagamento">
          <Select value={forma} onChange={(e) => setForma(e.target.value)} aria-label="Forma de pagamento">
            <option value="">Não informada</option>
            {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
      </FormGrid>
      <FormField label="Conta bancária">
        <SeletorCadastro entidade="contas-bancarias" valor={contaBancariaId} vazio="Não informada" onChange={setContaBancariaId} nome="contaBancariaId" />
      </FormField>
      <FormField label="Comentário" dica="Fica na linha do tempo da conta."><Textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={500} /></FormField>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
        <Button loading={salvando} onClick={confirmarBaixa} disabled={!!invalido} data-confirmar-recebimento><CheckCircle2 className="w-4 h-4" /> {parcial ? "Confirmar recebimento parcial" : "Confirmar recebimento"}</Button>
      </div>
    </div>
  );
}

function ParcelarConta({ conta, onPronto, onCancelar }: { conta: ContaAcoes; onPronto: () => void; onCancelar: () => void }) {
  const [plano, setPlano] = useState<ParcelaPlano[]>([]);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  async function parcelar() {
    if (motivo) { setErro(motivo); return; }
    setErro(""); setSalvando(true);
    const e = await enviar(`/api/contas-receber/${conta.id}/parcelar`, "POST", { parcelas: plano });
    setSalvando(false);
    if (e) { setErro(e); return; }
    toast(`${conta.numero} dividida em ${plano.length} parcelas.`, "sucesso");
    onPronto();
  }
  return (
    <div className="space-y-4" data-parcelar-conta>
      <Erro texto={erro} />
      <p className="text-sm text-ink-muted">
        <strong className="text-ink">{conta.clienteNome}</strong> · {formatarMoeda(conta.valor)}. Cada parcela vira uma cobrança, com vencimento e boleto próprios.
      </p>
      <EditorParcelas total={conta.valor} primeiroVencimento={conta.dataVencimento ? chaveDiaCivil(conta.dataVencimento) : null}
        onChange={(p, m) => { setPlano(p); setMotivo(m); }} />
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Voltar</Button>
        <Button loading={salvando} onClick={parcelar} disabled={!!motivo} data-confirmar-parcelar><Split className="w-4 h-4" /> Parcelar em {plano.length}×</Button>
      </div>
    </div>
  );
}

function CancelarConta({ conta, onPronto, onCancelar }: { conta: ContaAcoes; onPronto: () => void; onCancelar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  async function cancelar() {
    if (motivo.trim().length < 3) { setErro("Informe o motivo do cancelamento."); return; }
    setErro(""); setSalvando(true);
    const e = await enviar(`/api/contas-receber/${conta.id}`, "PUT", { status: "CANCELADO", motivoCancelamento: motivo.trim() });
    setSalvando(false);
    if (e) { setErro(e); return; }
    toast(`${conta.numero} cancelada.`, "sucesso");
    onPronto();
  }
  return (
    <div className="space-y-4" data-cancelar-conta>
      <Erro texto={erro} />
      <p className="text-sm text-ink-muted">A conta sai dos valores a receber. O registro e o histórico ficam.</p>
      <FormField label="Motivo" required><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ex.: serviço não realizado, cobrança em duplicidade" aria-label="Motivo" /></FormField>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Voltar</Button>
        <Button variant="danger" loading={salvando} onClick={cancelar} data-confirmar-cancelar><Ban className="w-4 h-4" /> Cancelar conta</Button>
      </div>
    </div>
  );
}

function ExcluirConta({ conta, onPronto, onCancelar }: { conta: ContaAcoes; onPronto: () => void; onCancelar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  async function excluir() {
    setErro(""); setSalvando(true);
    const e = await enviar(`/api/contas-receber/${conta.id}`, "DELETE", { motivo: motivo.trim() || undefined });
    setSalvando(false);
    if (e) { setErro(e); return; }
    toast(`${conta.numero} excluída.`, "sucesso");
    onPronto();
  }
  return (
    <div className="space-y-4" data-excluir-conta>
      <Erro texto={erro} />
      <p className="text-sm text-ink">
        <strong>{conta.descricao}</strong> · {formatarMoeda(conta.valor)}
      </p>
      <p className="text-sm text-ink-muted">A conta sai da lista e dos totais. O registro e o histórico ficam guardados.</p>
      <FormField label="Motivo"><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="Opcional" aria-label="Motivo" /></FormField>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Voltar</Button>
        <Button variant="danger" loading={salvando} onClick={excluir} data-confirmar-excluir><Trash2 className="w-4 h-4" /> Excluir</Button>
      </div>
    </div>
  );
}

function EmitirBoleto({ conta, onEmitido }: { conta: ContaAcoes; onEmitido: (b: { linhaDigitavel: string | null; codigoBarras: string | null }) => void }) {
  const [vencimento, setVencimento] = useState(conta.dataVencimento ? chaveDiaCivil(conta.dataVencimento) : chaveHojeBR(7));
  const [mensagem, setMensagem] = useState("");
  const [desconto, setDesconto] = useState("");
  const [multa, setMulta] = useState("2");
  const [juros, setJuros] = useState("1");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function emitir() {
    setErro(""); setSalvando(true);
    try {
      const res = await fetch(`/api/contas-receber/${conta.id}/boleto`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vencimento, mensagem: mensagem || undefined, descontoValor: desconto ? Number(desconto) : undefined, multaPercentual: multa ? Number(multa) : undefined, jurosPercentualMes: juros ? Number(juros) : undefined }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao emitir boleto."); return; }
      const d = await res.json();
      onEmitido({ linhaDigitavel: d.boletoLinhaDigitavel ?? null, codigoBarras: d.boletoCodigoBarras ?? null });
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-4">
      <Erro texto={erro} />
      <div className="bg-surface-alt rounded-lg p-3 text-sm">
        <p className="font-semibold text-ink">{conta.clienteNome}</p>
        <p className="text-ink-muted">Valor: <strong className="text-success-700">{formatarMoeda(saldoDaConta(conta))}</strong>{(conta.valorRecebido ?? 0) > 0 && <span> (o que falta receber)</span>}</p>
      </div>
      <FormGrid>
        <FormField label="Vencimento"><InputData value={vencimento} onChange={(v) => setVencimento(v)} /></FormField>
        <FormField label="Desconto (R$)" hint="Opcional"><Input type="number" step="0.01" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" /></FormField>
      </FormGrid>
      <FormGrid>
        <FormField label="Multa por atraso (%)"><Input type="number" step="0.01" value={multa} onChange={(e) => setMulta(e.target.value)} /></FormField>
        <FormField label="Juros ao mês (%)"><Input type="number" step="0.01" value={juros} onChange={(e) => setJuros(e.target.value)} /></FormField>
      </FormGrid>
      <FormField label="Mensagem / instrução"><Textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={2} placeholder="Instrução que aparece no boleto" /></FormField>
      <div className="flex justify-end gap-2">
        <Button loading={salvando} onClick={emitir}><FileText className="w-4 h-4" /> Emitir Boleto</Button>
      </div>
    </div>
  );
}

function BoletoEmitido({ conta, boleto, onAlterado }: { conta: ContaAcoes; boleto: { linhaDigitavel: string | null; codigoBarras: string | null }; onAlterado: () => void }) {
  const [baixando, setBaixando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const linha = boleto.linhaDigitavel ?? boleto.codigoBarras ?? "—";

  async function baixarPdf() {
    setBaixando(true);
    try { await abrirPdfBoleto(conta.id); } finally { setBaixando(false); }
  }

  async function cancelar() {
    if (!(await confirmar({ mensagem: "Cancelar este boleto no Banco Inter?", perigo: true, confirmarTexto: "Cancelar boleto", cancelarTexto: "Voltar" }))) return;
    setCancelando(true);
    try {
      const res = await fetch(`/api/contas-receber/${conta.id}/boleto`, { method: "DELETE" });
      if (res.ok) onAlterado();
      else { const e = await res.json(); toast(e.erro ?? "Erro ao cancelar.", "erro"); }
    } catch { toast("Erro de conexão.", "erro"); } finally { setCancelando(false); }
  }

  const msgBoleto = `Olá ${conta.clienteNome}, segue seu boleto no valor de ${formatarMoeda(conta.valor)} com vencimento em ${formatarData(conta.boletoVencimento)}.\nLinha digitável: ${linha}`;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1">Linha digitável</p>
        <div className="bg-surface-alt rounded-lg p-3 font-mono text-sm text-ink break-all">{linha}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={baixando} onClick={baixarPdf}><Download className="w-4 h-4" /> Baixar PDF</Button>
        {conta.whatsapp && <Button variant="secondary" onClick={() => window.open(whatsappLink(conta.whatsapp, msgBoleto), "_blank")}><MessageCircle className="w-4 h-4" /> WhatsApp</Button>}
        {conta.email && <Button variant="secondary" onClick={() => { window.location.href = `mailto:${conta.email}?subject=${encodeURIComponent(`Boleto — ${conta.numero}`)}&body=${encodeURIComponent(msgBoleto)}`; }}><Mail className="w-4 h-4" /> E-mail</Button>}
        {conta.boletoStatus === "EMITIDO" && <Button variant="secondary" loading={cancelando} onClick={cancelar} className="text-atrasado"><Ban className="w-4 h-4" /> Cancelar boleto</Button>}
      </div>
    </div>
  );
}
