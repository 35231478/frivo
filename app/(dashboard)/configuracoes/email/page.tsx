import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { EmailConfigClient } from "@/components/config/email-config-client";

export const metadata: Metadata = { title: "E-mail" };

export default function EmailConfigPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="E-mail transacional" description="Configure o envio de e-mails automáticos via Resend" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <EmailConfigClient />
      </div>
    </div>
  );
}
