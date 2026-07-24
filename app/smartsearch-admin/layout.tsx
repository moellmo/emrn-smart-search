import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "EMRN SmartSearch Admin",
  description: "SmartSearch controls and analytics for EMRN.",
  icons: {
    icon: [{ url: "/smartsearch-admin/icon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/smartsearch-admin/icon.svg", type: "image/svg+xml" }],
  },
};

export default function SmartSearchAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
