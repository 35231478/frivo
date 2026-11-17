import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { ColaboradorForm } from "@/components/forms/colaborador-form";
import { documentosDoColaborador } from "@/lib/colaborador/documentos-server";
import { VALIDADE_PADRAO } from "@/lib/admissao/admissao";
import { admissaoDoColaborador, configDaEmpresa } from "@/lib/admissao/admissao-server";
import { documentosDoColaborador as documentosGeradosDoColaborador } from "@/lib/documentos/documentos-server";

export const metadata: Metadata = { title: "Editar colaborador" };

export default async function EditarColaboradorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  // Ficha completa (CPF, RG, endereço, documentos): mesma permissão que a API exige (CA9)
  if (!pode(session!.user!.permissoes, "equipes", "gerenciar", session!.user!.role)) redirect("/sem-permissao");

  const colaborador = await prisma.tecnico.findFirst({
    where: { id, empresaId },
    include: { competencias: { select: { id: true } } },
  });
  if (!colaborador) notFound();

  const user = session!.user!;
  const podeFolha = pode(user.permissoes, "financeiro", "folha", user.role);
  // Documentos da ficha: ver e anexar pede a mesma permissão da ficha completa (já conferida
  // acima); EXCLUIR pede a permissão alta, a mesma de inativar/apagar o colaborador.
  const podeExcluirDocumento = pode(user.permissoes, "equipes", "excluir", user.role);
  const documentos = await documentosDoColaborador(colaborador.id, empresaId);
  // Acesso ao app (criar/ligar login de técnico) é gestão de usuários → exige Configurações › gerenciar.
  const podeAcesso = pode(user.permissoes, "configuracoes", "gerenciar", user.role);
  const loginEmail = (colaborador.email ?? "").trim();
  const loginUsuario = podeAcesso && loginEmail
    ? await prisma.usuario.findFirst({ where: { empresaId, email: { equals: loginEmail, mode: "insensitive" } }, select: { ativo: true, role: true } })
    : null;
  const acessoInicial = { email: colaborador.email ?? null, temLogin: !!loginUsuario, acessoAtivo: !!loginUsuario?.ativo, role: loginUsuario?.role ?? null };

  // Admissão digital: dado sensível de pessoa, permissão própria ("Admissão digital › gerenciar")
  const podeAdmissao = pode(user.permissoes, "admissao", "gerenciar", user.role);
  const [admissao, cfgAdmissao, cargos, contratoLinha] = podeAdmissao
    ? await Promise.all([
        admissaoDoColaborador(empresaId, colaborador.id),
        configDaEmpresa(empresaId),
        prisma.cargo.findMany({ where: { empresaId, ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
        // O contrato assinado aparece na MESMA seção Documentos. Só para quem tem a permissão da
        // admissão: é lá que esse papel nasce.
        prisma.admissao.findFirst({
          where: { empresaId, colaboradorId: colaborador.id, assinaturaEm: { not: null } },
          orderBy: { assinaturaEm: "desc" },
          select: { assinaturaEm: true, assinaturaNome: true, contratoTexto: true },
        }),
      ])
    : [null, null, [], null];
  // Documentos gerados por modelo: quem pode gerar vê o botão e o histórico; o disciplinar é
  // filtrado no servidor, não na tela.
  const podeGerarDocumento = pode(user.permissoes, "documentos", "criar", user.role);
  const podeDisciplinar = pode(user.permissoes, "documentos", "disciplinar", user.role);
  const [modelosDoc, emitidos] = podeGerarDocumento
    ? await Promise.all([
        prisma.documentoModelo.findMany({
          where: { empresaId, ativo: true },
          orderBy: { nome: "asc" },
          select: { id: true, nome: true, tipo: true, texto: true, temItens: true, exigeAssinatura: true, validadeDias: true },
        }),
        documentosGeradosDoColaborador(colaborador.id, empresaId, podeDisciplinar),
      ])
    : [[], []];

  const contratoAssinado = contratoLinha?.contratoTexto && contratoLinha.assinaturaEm
    ? { texto: contratoLinha.contratoTexto, assinadoEm: contratoLinha.assinaturaEm.toISOString(), assinadoPor: contratoLinha.assinaturaNome }
    : null;

  // Serializa para o client (Decimal/Date → tipos simples). O salário NÃO vai para o navegador:
  // quem tem a permissão de folha vê/edita na aba "Dados financeiros / Folha" (API própria).
  const { salario: _salario, ...semSalario } = colaborador;
  const initialData = {
    ...semSalario,
    dataNascimento: colaborador.dataNascimento ? colaborador.dataNascimento.toISOString() : null,
    dataAdmissao: colaborador.dataAdmissao ? colaborador.dataAdmissao.toISOString() : null,
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Editar colaborador" description={colaborador.nome} backHref="/colaboradores"
        actions={<InativarRegistro url={`/api/tecnicos/${colaborador.id}`} modulo="equipes" acaoReativar="gerenciar" variante="botao" ativo={colaborador.ativo} nome={colaborador.nome} entidade="colaborador" />}
      />
      {!colaborador.ativo && (
        <div data-aviso-inativo className="mb-4 bg-surface-page border border-surface-border text-ink rounded-card px-4 py-3 text-sm">
          Este colaborador está <strong>inativo</strong>: não aparece nas listas nem nos seletores de técnico. Use “Reativar” para voltar a usá-lo.
        </div>
      )}
      <ColaboradorForm
        key={`${colaborador.ativo}-${colaborador.statusColaborador}`} initialData={initialData}
        somenteLeitura={!pode(user.permissoes, "equipes", "gerenciar", user.role)}
        podeFolha={podeFolha}
        podeAcesso={podeAcesso}
        acessoInicial={acessoInicial}
        podeAdmissao={podeAdmissao}
        admissao={admissao}
        cargosAdmissao={cargos.map((c) => ({ value: c.id, label: c.nome }))}
        validadeAdmissao={cfgAdmissao?.validadeDias ?? VALIDADE_PADRAO}
        documentosIniciais={documentos}
        podeGerarDocumento={podeGerarDocumento}
        podeDisciplinar={podeDisciplinar}
        modelosDocumento={modelosDoc}
        emitidosIniciais={emitidos}
        podeExcluirDocumento={podeExcluirDocumento}
        contratoAssinado={contratoAssinado}
      />
    </div>
  );
}
