import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getQrConfig } from "@/lib/qr-config";
import { PageHeader } from "@/components/ui/page-header";
import { QrConfigClient } from "@/components/config/qr-config-client";

export const metadata: Metadata = { title: "QR Code" };

export default async function ConfigQrCodePage() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const config = await getQrConfig(empresaId);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="QR Code"
        description="Configure a página pública acessada pelo QR Code dos equipamentos"
        backHref="/configuracoes"
      />
      <QrConfigClient inicial={config} />
    </div>
  );
}
