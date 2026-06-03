import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { OrcamentoDocumento } from "@/components/orcamento/orcamento-documento";
import { PropostaDocumento } from "@/components/orcamento/proposta-documento";
import { AprovacaoPublica } from "@/components/orcamento/aprovacao-publica";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { LABELS_STATUS_ORCAMENTO, CLASSE_STATUS_ORCAMENTO, formatarData, cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Printer } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Orçamento",
  robots: { index: false, follow: false },
};

export default async function OrcamentoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const orcamento = await prisma.orcamento.findUnique({
    where: { tokenPublico: token },
    include: {
      empresa: true,
      cliente: true,
      responsavelTecnico: { select: { nome: true, crea: true } },
      servicos: { orderBy: { ordem: "asc" } },
      produtos: { orderBy: { ordem: "asc" } },
    },
  });

  if (!orcamento) notFound();

  const proposta = orcamento.tipo === "PROPOSTA_CONTRATO";
  const equipamentos = proposta && orcamento.equipamentosCobertos.length
    ? (await prisma.equipamento.findMany({
        where: { id: { in: orcamento.equipamentosCobertos }, empresaId: orcamento.empresaId },
        select: { id: true, marca: true, modelo: true, numeroSerie: true, unidade: { select: { nome: true } } },
      })).map((e) => ({ id: e.id, rotulo: [e.marca, e.modelo, e.numeroSerie ? `(${e.numeroSerie})` : "", e.unidade?.nome ? `— ${e.unidade.nome}` : ""].filter(Boolean).join(" ") }))
    : [];

  const expirado = orcamento.validadeEm ? orcamento.validadeEm < new Date() : false;
  const cancelado = orcamento.status === "CANCELADO";
  const aprovado = orcamento.status === "APROVADO";
  const podeAprovar = orcamento.status === "ENVIADO" && !expirado;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Topo */}
      <header className="bg-sidebar text-white py-4 px-6 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <FrivoLogo size="sm" showSubtitle={false} />
          <Link
            href={`/orcamento/${token}/imprimir`}
            target="_blank"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
          >
            <Printer className="w-4 h-4" /> Imprimir / PDF
          </Link>
        </div>
      </header>

      <main className="flex-1 py-8 px-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Aviso de status */}
          {cancelado && (
            <StatusAviso
              tipo="erro"
              titulo="Orçamento cancelado"
              mensagem="Este orçamento foi cancelado pela empresa e não pode mais ser aprovado."
            />
          )}
          {expirado && !aprovado && !cancelado && (
            <StatusAviso
              tipo="atencao"
              titulo="Orçamento expirado"
              mensagem={`Válido até ${formatarData(orcamento.validadeEm)}. Entre em contato com a empresa para uma nova proposta.`}
            />
          )}
          {aprovado && (
            <div className="bg-success-50 border-2 border-success-500 text-success-700 rounded-xl px-5 py-4 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
              <div>
                <p className="font-bold">Orçamento aprovado!</p>
                <p className="text-sm">
                  Aprovado por {orcamento.assinadoPor} em{" "}
                  {formatarData(orcamento.assinadoEm, "dd/MM/yyyy 'às' HH:mm")}.
                </p>
              </div>
            </div>
          )}

          {/* Documento */}
          <div className="bg-white rounded-2xl shadow-card p-6 md:p-10">
            {proposta ? (
              <PropostaDocumento
                orcamento={orcamento}
                empresa={orcamento.empresa}
                cliente={orcamento.cliente}
                responsavelTecnico={orcamento.responsavelTecnico}
                equipamentos={equipamentos}
              />
            ) : (
              <OrcamentoDocumento
                orcamento={orcamento}
                empresa={orcamento.empresa}
                cliente={orcamento.cliente}
              />
            )}
          </div>

          {/* Aprovação */}
          {podeAprovar && <AprovacaoPublica token={token} />}
          {orcamento.status === "RASCUNHO" && (
            <div className="bg-white border border-surface-border rounded-xl px-5 py-4 text-center">
              <span className={cn("inline-flex mb-2", CLASSE_STATUS_ORCAMENTO[orcamento.status])}>
                {LABELS_STATUS_ORCAMENTO[orcamento.status]}
              </span>
              <p className="text-sm text-ink-muted">
                Este orçamento ainda não foi formalmente enviado pela empresa.
              </p>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-surface-border py-6 text-center text-xs text-ink-subtle">
        <p>
          {orcamento.empresa.nomeFantasia ?? orcamento.empresa.nome}
          {orcamento.empresa.email && ` · ${orcamento.empresa.email}`}
        </p>
        <p className="mt-1">Documento eletrônico — Frivo</p>
      </footer>
    </div>
  );
}

function StatusAviso({ tipo, titulo, mensagem }: { tipo: "erro" | "atencao"; titulo: string; mensagem: string }) {
  const classes = tipo === "erro"
    ? "bg-red-50 border-red-300 text-red-700"
    : "bg-amber-50 border-amber-300 text-amber-700";
  return (
    <div className={cn("border-2 rounded-xl px-5 py-4 flex items-center gap-3", classes)}>
      <AlertTriangle className="w-6 h-6 shrink-0" />
      <div>
        <p className="font-bold">{titulo}</p>
        <p className="text-sm">{mensagem}</p>
      </div>
    </div>
  );
}
