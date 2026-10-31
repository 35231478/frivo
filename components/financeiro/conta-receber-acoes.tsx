"use client";

import { confirmar, toast } from "@/components/ui/avisos";
import { useEffect, useState } from "react";
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
  TrendingDown, RotateCcw, Undo2, Handshake, Unlink,
} from "lucide-react";
import { RenegociarCobrancas } from "@/components/financeiro/renegociar-modal";
import { motivoNaoRenegociar, motivoTextoDesfazer } from "@/lib/financeiro/renegociacao";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import {
  ORIGEM_RECEBIMENTO, motivoNaoEstornar, motivoNaoMarcarPerda, motivoTextoInvalido, temBaixaAntiga,
} from "@/lib/financeiro/perda-estorno";
import {
  motivoNaoParcelar, motivoParcialComBoleto, motivoValorRecebimento, quitaConta, saldoDaConta, type ParcelaPlano,
} from "@/lib/financeiro/parcelas";
import { EditorParcelas } from "@/components/financeiro/editor-parcelas";
import { chaveDiaCivil, chaveHojeBR } from "@/lib/fuso";
import { InputData } from "@/components/ui/input-data";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";
import { Dica } from "@/components/ui/dica";

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
  /** Perda: quanto foi dado como perdido (o saldo na hora da marcação) */
  valorPerda?: number | null;
  /** Faz parte de uma renegociação (a conta nova ou parcela dela) / renegociada em qual */
  renegociacao?: boolean;
  renegociadaEmNumero?: string | null;
}
type Categoria = { id: string; nome: string; cor: string; ativo: boolean };
type Modais = null | "whatsapp" | "email" | "receber" | "parcelar" | "editar" | "cancelar" | "excluir" | "boletoEmitir" | "boletoConfig" | "boletoEmitido"
  | "perda" | "reverterPerda" | "estornar" | "renegociar" | "desfazerReneg";

/** Quem não tem a permissão vê a ação apagada com o porquê (o servidor recusa do mesmo jeito) */
export const SEM_PERMISSAO_PERDAS = "Sem permissão: Financeiro › Perdas (peça a um gerente).";

/**
 * Ações da conta a receber num menu ⋮ só (o que o status permite; o que não pode aparece apagado com ⓘ
 * dizendo por quê). As regras são as mesmas do servidor: lib/financeiro/conta-receber-gestao.
 */
export function ContaReceberAcoes({ conta, categorias = [], clientes = [], onDetalhes }: {
  conta: ContaAcoes; categorias?: Categoria[]; clientes?: { id: string; nome: string }[]; onDetalhes: () => void;
}) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const podePerdas = pode("financeiro", "perdas");
  const [modal, setModal] = useState<Modais>(null);
  const [boleto, setBoleto] = useState({ linhaDigitavel: conta.boletoLinhaDigitavel, codigoBarras: conta.boletoCodigoBarras });
  const [baixando, setBaixando] = useState(false);
  const fechar = () => setModal(null);
  const pronto = () => { fechar(); router.refresh(); };

  const regra = { ...conta, notas: conta.notas ?? [] };
  const emPerda = conta.status === "PERDA";
  const renegociada = conta.status === "RENEGOCIADO";
  // Em perda: nada de cobrar/receber direto — o caminho é "Reverter perda". Renegociada: o dinheiro está na renegociação
  const quitada = conta.status === "RECEBIDO" || conta.status === "CANCELADO" || emPerda || renegociada;
  const boletoEmitido = conta.boletoStatus === "EMITIDO";
  const naoReceber = motivoNaoReceber(regra);
  const naoCancelar = motivoNaoCancelar(regra);
  const naoExcluir = motivoNaoExcluir(regra);
  const naoRecibo = motivoNaoRecibo(regra);
  const naoParcelar = motivoNaoParcelar(regra);
  const naoPerda = podePerdas ? motivoNaoMarcarPerda(conta) : SEM_PERMISSAO_PERDAS;
  const temEstorno = (conta.valorRecebido ?? 0) > 0 || temBaixaAntiga(conta);
  const naoEstornar = emPerda || renegociada ? motivoNaoEstornar(conta) : null;
  const naoRenegociar = podePerdas ? motivoNaoRenegociar(conta) : SEM_PERMISSAO_PERDAS;
  const podeDesfazer = !!conta.renegociacao && conta.status !== "CANCELADO";
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
              {emPerda && (
                <ItemMenu icone={RotateCcw} onClick={() => { f(); setModal("reverterPerda"); }} desabilitado={!podePerdas} motivo={podePerdas ? null : SEM_PERMISSAO_PERDAS} id="reverter-perda">Reverter perda</ItemMenu>
              )}
              {!quitada && conta.status !== "PARCELADO" && (
                <ItemMenu icone={Handshake} onClick={() => { f(); setModal("renegociar"); }} desabilitado={!!naoRenegociar} motivo={naoRenegociar} id="renegociar">Renegociar</ItemMenu>
              )}
              {podeDesfazer && (
                <ItemMenu icone={Unlink} onClick={() => { f(); setModal("desfazerReneg"); }} desabilitado={!podePerdas} motivo={podePerdas ? null : SEM_PERMISSAO_PERDAS} id="desfazer-renegociacao">Desfazer renegociação</ItemMenu>
              )}
              {temEstorno && <ItemMenu icone={Undo2} onClick={() => { f(); setModal("estornar"); }} desabilitado={!!naoEstornar} motivo={naoEstornar} id="estornar">Estornar recebimento</ItemMenu>}
              <SeparadorMenu />
              {(!quitada || boletoEmitido) && (
                <ItemMenu icone={FileText} onClick={() => { f(); abrirBoleto(); }} id="boleto">{boletoEmitido ? "Boleto (linha digitável)" : "Emitir boleto"}</ItemMenu>
              )}
              {boletoEmitido && <ItemMenu icone={Download} onClick={() => { f(); baixarPdfBoleto(); }} id="boleto-pdf">Baixar boleto (PDF)</ItemMenu>}
              {!quitada && conta.whatsapp && <ItemMenu icone={MessageSquare} onClick={() => { f(); setModal("whatsapp"); }} id="cobrar-whatsapp">Enviar cobrança por WhatsApp</ItemMenu>}
              {!quitada && conta.email && <ItemMenu icone={Mail} onClick={() => { f(); setModal("email"); }} id="cobrar-email">Enviar cobrança por e-mail</ItemMenu>}
              <ItemMenu icone={Receipt} href={`/financeiro/contas-receber/${conta.id}/recibo`} novaAba desabilitado={!!naoRecibo} motivo={naoRecibo} id="recibo">Emitir recibo (PDF)</ItemMenu>
              <SeparadorMenu />
              {!quitada && conta.status !== "PARCELADO" && (
                <ItemMenu icone={TrendingDown} onClick={() => { f(); setModal("perda"); }} desabilitado={!!naoPerda} motivo={naoPerda} perigo id="perda">Marcar como perda</ItemMenu>
              )}
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
      <Modal aberto={modal === "perda"} onFechar={fechar} titulo={`Marcar ${conta.numero} como perda`} tamanho="sm">
        <MarcarPerda conta={conta} onPronto={pronto} onCancelar={fechar} />
      </Modal>
      <Modal aberto={modal === "reverterPerda"} onFechar={fechar} titulo={`Reverter perda — ${conta.numero}`}>
        <ReverterPerda conta={conta} onPronto={pronto} onCancelar={fechar} />
      </Modal>
      <Modal aberto={modal === "estornar"} onFechar={fechar} titulo={`Estornar recebimento — ${conta.numero}`}>
        <EstornarRecebimento conta={conta} onPronto={pronto} onCancelar={fechar} />
      </Modal>
      <Modal aberto={modal === "renegociar"} onFechar={fechar} titulo={`Renegociar — ${conta.clienteNome}`} tamanho="lg">
        {modal === "renegociar" && <RenegociarCobrancas clienteId={conta.clienteId} clienteNome={conta.clienteNome} iniciais={[conta.id]} onPronto={pronto} onCancelar={fechar} />}
      </Modal>
      <Modal aberto={modal === "desfazerReneg"} onFechar={fechar} titulo={`Desfazer renegociação — ${conta.numero}`} tamanho="sm">
        <DesfazerRenegociacao conta={conta} onPronto={pronto} onCancelar={fechar} />
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

/**
 * Marcar como perda (inadimplência): o que falta receber sai do a receber e vira perda. O já recebido
 * continua recebido; a nota fiscal não é cancelada. Volta atrás por "Reverter perda".
 */
function MarcarPerda({ conta, onPronto, onCancelar }: { conta: ContaAcoes; onPronto: () => void; onCancelar: () => void }) {
  const saldo = saldoDaConta(conta);
  const recebido = conta.valorRecebido ?? 0;
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  async function marcar() {
    const inv = motivoTextoInvalido(motivo, "o motivo da perda");
    if (inv) { setErro(inv); return; }
    setErro(""); setSalvando(true);
    const e = await enviar(`/api/contas-receber/${conta.id}/perda`, "POST", { motivo: motivo.trim() });
    setSalvando(false);
    if (e) { setErro(e); return; }
    toast(`${conta.numero}: perda de ${formatarMoeda(saldo)} registrada.`, "sucesso");
    onPronto();
  }
  return (
    <div className="space-y-4" data-marcar-perda>
      <Erro texto={erro} />
      <dl className="bg-surface-alt rounded-lg p-3 text-sm grid grid-cols-2 gap-2">
        <div><dt className="text-xs text-ink-muted">Vira perda</dt><dd className="font-semibold text-atrasado-texto tabular-nums" data-valor-perda-modal>{formatarMoeda(saldo)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Já recebido (continua)</dt><dd className="font-semibold text-success-700 tabular-nums">{formatarMoeda(recebido)}</dd></div>
      </dl>
      <p className="text-sm text-ink-muted">
        Sai do a receber. A nota fiscal continua emitida.
        {" "}<Dica rotulo="Perda" texto="Use quando o cliente não vai pagar (falência, acordo perdido, valor pequeno demais para cobrar). Se ele pagar depois, use “Reverter perda”." />
      </p>
      <FormField label="Motivo" required>
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ex.: cliente faliu; sem retorno há 6 meses" aria-label="Motivo da perda" />
      </FormField>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Voltar</Button>
        <Button variant="danger" loading={salvando} onClick={marcar} data-confirmar-perda><TrendingDown className="w-4 h-4" /> Marcar como perda</Button>
      </div>
    </div>
  );
}

/** Reverter perda: volta a receber, ou o cliente pagou (registra o recebimento da recuperação) */
function ReverterPerda({ conta, onPronto, onCancelar }: { conta: ContaAcoes; onPronto: () => void; onCancelar: () => void }) {
  const perdido = Number(conta.valorPerda ?? 0) || Math.max(0, Math.round((conta.valor - (conta.valorRecebido ?? 0)) * 100) / 100);
  const [modo, setModo] = useState<"REABRIR" | "RECUPERAR">("RECUPERAR");
  const [valor, setValor] = useState(String(perdido));
  const [data, setData] = useState(chaveHojeBR());
  const [forma, setForma] = useState(conta.formaPagamento ?? "");
  const [contaBancariaId, setContaBancariaId] = useState(conta.contaBancariaId ?? "");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const v = Number(valor);
  const parcial = modo === "RECUPERAR" && v > 0 && Math.round(v * 100) < Math.round(perdido * 100);
  const invalido = modo === "RECUPERAR" ? (!(v > 0) ? "Informe o valor recebido." : Math.round(v * 100) > Math.round(perdido * 100) ? `O valor passa do que estava perdido (${formatarMoeda(perdido)}).` : null) : null;

  async function reverter() {
    if (modo === "RECUPERAR" && !data) { setErro("Informe a data do recebimento."); return; }
    if (invalido) { setErro(invalido); return; }
    setErro(""); setSalvando(true);
    const e = await enviar(`/api/contas-receber/${conta.id}/perda/reverter`, "POST", {
      modo, motivo: motivo.trim() || null,
      ...(modo === "RECUPERAR" && {
        valor: v, data, formaPagamento: forma || null,
        ...(contaBancariaId !== (conta.contaBancariaId ?? "") && { contaBancariaId: contaBancariaId || null }),
      }),
    });
    setSalvando(false);
    if (e) { setErro(e); return; }
    toast(modo === "RECUPERAR" ? `${conta.numero}: recuperação de ${formatarMoeda(v)} registrada.` : `${conta.numero} voltou a receber.`, "sucesso");
    onPronto();
  }
  const opcao = (m: typeof modo, titulo: string, texto: string) => (
    <label className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${modo === m ? "border-primary-300 bg-primary-50" : "border-surface-border"}`}>
      <input type="radio" name="modo-reverter" checked={modo === m} onChange={() => setModo(m)} className="mt-1 accent-primary-600" data-modo-reverter={m} />
      <span><span className="block text-sm font-semibold text-ink">{titulo}</span><span className="block text-xs text-ink-muted">{texto}</span></span>
    </label>
  );
  return (
    <div className="space-y-4" data-reverter-perda>
      <Erro texto={erro} />
      <p className="text-sm text-ink-muted"><strong className="text-ink">{conta.clienteNome}</strong> · perda de <strong className="text-ink">{formatarMoeda(perdido)}</strong></p>
      <div className="grid gap-2 sm:grid-cols-2">
        {opcao("RECUPERAR", "O cliente pagou", "Volta e já registra o recebimento.")}
        {opcao("REABRIR", "Voltar a cobrar", "Volta para o a receber, sem recebimento.")}
      </div>
      {modo === "RECUPERAR" && (
        <>
          <FormGrid>
            <FormField label="Valor recebido" required dica="Menos que o perdido = o restante volta a ficar em aberto.">
              <Input type="number" step="0.01" min="0.01" max={perdido} value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Valor recebido" data-valor-recuperado />
            </FormField>
            <FormField label="Data do recebimento" required><InputData value={data} onChange={setData} aria-label="Data do recebimento" /></FormField>
          </FormGrid>
          {parcial && !invalido && <p className="text-sm text-atencao-texto" data-aviso-parcial>Continuam em aberto <strong>{formatarMoeda(Math.round((perdido - v) * 100) / 100)}</strong>.</p>}
          {invalido && valor !== "" && <p role="alert" className="text-sm text-atrasado-texto" data-invalido-recuperacao>{invalido}</p>}
          <FormGrid>
            <FormField label="Forma de pagamento">
              <Select value={forma} onChange={(e) => setForma(e.target.value)} aria-label="Forma de pagamento">
                <option value="">Não informada</option>
                {Object.entries(LABELS_FORMA_PAGAMENTO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </FormField>
            <FormField label="Conta bancária">
              <SeletorCadastro entidade="contas-bancarias" valor={contaBancariaId} vazio="Não informada" onChange={setContaBancariaId} nome="contaBancariaId" />
            </FormField>
          </FormGrid>
        </>
      )}
      <FormField label="Comentário" dica="Fica na linha do tempo da conta."><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} aria-label="Comentário" /></FormField>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Voltar</Button>
        <Button loading={salvando} onClick={reverter} disabled={!!invalido} data-confirmar-reverter>
          <RotateCcw className="w-4 h-4" /> {modo === "RECUPERAR" ? "Registrar recuperação" : "Voltar a cobrar"}
        </Button>
      </div>
    </div>
  );
}

interface RecebimentoLista {
  id: string; valor: number; data: string; origem: string; formaPagamento: string | null; usuario: string | null; estornadoEm: string | null;
}

/**
 * Estornar recebimento (baixa informada errada): escolhe qual — ou a baixa antiga, de antes do histórico —
 * e o motivo. O valor volta a faltar; o estorno fica riscado no histórico. O pago pelo boleto não se estorna aqui.
 */
function EstornarRecebimento({ conta, onPronto, onCancelar }: { conta: ContaAcoes; onPronto: () => void; onCancelar: () => void }) {
  const [lista, setLista] = useState<RecebimentoLista[] | null>(null);
  const [escolhido, setEscolhido] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const antiga = temBaixaAntiga(conta);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/contas-receber/${conta.id}/recebimentos`).then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((d: RecebimentoLista[]) => {
        if (!vivo) return;
        const ativos = d.filter((r) => !r.estornadoEm);
        setLista(ativos);
        // Um só que dá para estornar: já vem escolhido
        const podem = ativos.filter((r) => !motivoNaoEstornar(conta, r));
        if (podem.length === 1 && !antiga) setEscolhido(podem[0].id);
        else if (antiga && ativos.length === 0) setEscolhido("ANTIGA");
      });
    return () => { vivo = false; };
  }, [conta.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const valorEscolhido = escolhido === "ANTIGA" ? conta.valor : lista?.find((r) => r.id === escolhido)?.valor ?? 0;
  async function estornar() {
    if (!escolhido) { setErro("Escolha o recebimento a estornar."); return; }
    const inv = motivoTextoInvalido(motivo, "o motivo do estorno");
    if (inv) { setErro(inv); return; }
    setErro(""); setSalvando(true);
    const e = await enviar(`/api/contas-receber/${conta.id}/recebimentos/estornar`, "POST", {
      ...(escolhido !== "ANTIGA" && { recebimentoId: escolhido }), motivo: motivo.trim(),
    });
    setSalvando(false);
    if (e) { setErro(e); return; }
    toast(`Estorno de ${formatarMoeda(valorEscolhido)} em ${conta.numero}. O valor volta a faltar.`, "sucesso");
    onPronto();
  }
  const linha = (id: string, rotulo: string, detalhe: string, valor: number, bloqueio: string | null) => (
    <li key={id}>
      <label className={`flex items-start gap-2 px-3 py-2 ${bloqueio ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-surface-alt"} ${escolhido === id ? "bg-primary-50" : ""}`} data-opcao-estorno={id}>
        <input type="radio" name="recebimento-estorno" disabled={!!bloqueio} checked={escolhido === id} onChange={() => setEscolhido(id)} className="mt-1 accent-primary-600" />
        <span className="flex-1 min-w-0">
          <span className="flex justify-between gap-2"><span className="text-sm font-medium text-ink">{rotulo}</span><span className="text-sm font-semibold tabular-nums text-ink">{formatarMoeda(valor)}</span></span>
          <span className="block text-xs text-ink-muted">{detalhe}</span>
          {bloqueio && <span className="block text-xs text-atencao-texto" data-bloqueio-estorno>{bloqueio}</span>}
        </span>
      </label>
    </li>
  );
  return (
    <div className="space-y-4" data-estornar-recebimento>
      <Erro texto={erro} />
      <p className="text-sm text-ink-muted">
        Para desfazer um recebimento informado errado. O valor volta a faltar e o estorno fica no histórico.
        {" "}<Dica rotulo="Estorno" texto="Pago pelo boleto no banco não se estorna aqui: o banco confirmou o pagamento. Se a fatura estava paga, ela volta ao passo anterior." />
      </p>
      {lista === null ? <p className="text-sm text-ink-muted" data-carregando-recebimentos>Carregando recebimentos…</p> : (
        <ul className="border border-surface-border rounded-lg divide-y divide-surface-border overflow-hidden" data-lista-estorno>
          {lista.map((r) => linha(r.id, formatarData(r.data), [ORIGEM_RECEBIMENTO[r.origem] ?? r.origem, r.formaPagamento ? LABELS_FORMA_PAGAMENTO[r.formaPagamento] ?? r.formaPagamento : null, r.usuario].filter(Boolean).join(" · "), r.valor, motivoNaoEstornar(conta, r)))}
          {antiga && lista.length === 0 && linha("ANTIGA", "Baixa antiga", "Recebida antes do histórico de recebimentos.", conta.valor, motivoNaoEstornar(conta))}
          {lista.length === 0 && !antiga && <li className="px-3 py-2 text-sm text-ink-muted">Nenhum recebimento para estornar.</li>}
        </ul>
      )}
      <FormField label="Motivo" required>
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ex.: baixa lançada na conta errada; cheque devolvido" aria-label="Motivo do estorno" />
      </FormField>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Voltar</Button>
        <Button variant="danger" loading={salvando} onClick={estornar} disabled={!escolhido} data-confirmar-estorno><Undo2 className="w-4 h-4" /> Estornar {escolhido ? formatarMoeda(valorEscolhido) : ""}</Button>
      </div>
    </div>
  );
}

/** Desfazer a renegociação: a conta nova é cancelada e as cobranças originais voltam a receber */
function DesfazerRenegociacao({ conta, onPronto, onCancelar }: { conta: ContaAcoes; onPronto: () => void; onCancelar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  async function desfazer() {
    const inv = motivoTextoDesfazer(motivo);
    if (inv) { setErro(inv); return; }
    setErro(""); setSalvando(true);
    try {
      const res = await fetch(`/api/contas-receber/${conta.id}/renegociacao/desfazer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo: motivo.trim() }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível desfazer."); return; }
      toast(`Renegociação ${d.numero} desfeita: ${(d.originais as string[]).join(", ")} voltaram a receber.`, "sucesso");
      onPronto();
    } catch { setErro("Sem conexão. Tente novamente."); } finally { setSalvando(false); }
  }
  return (
    <div className="space-y-4" data-desfazer-renegociacao>
      <Erro texto={erro} />
      <p className="text-sm text-ink-muted">
        A renegociação é cancelada e as cobranças originais voltam a receber.
        {" "}<Dica rotulo="Desfazer" texto="Só dá enquanto nenhuma cobrança da renegociação teve recebimento, boleto emitido, perda ou outra renegociação." />
      </p>
      <FormField label="Motivo" required>
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ex.: cliente desistiu do acordo; valores errados" aria-label="Motivo" />
      </FormField>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Voltar</Button>
        <Button variant="danger" loading={salvando} onClick={desfazer} data-confirmar-desfazer><Unlink className="w-4 h-4" /> Desfazer renegociação</Button>
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
