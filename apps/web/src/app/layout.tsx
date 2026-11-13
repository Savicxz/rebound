import "./globals.css";
import React from "react";

export const metadata = {
  title: "Rebound — Self-Healing IT Incident Automation",
  description:
    "Autonomous IT incident detection, AI-assisted diagnosis, allowlisted recovery, and verified audit logging for service operations.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark">
      <body className="min-h-screen bg-background text-slate-900 antialiased flex flex-col">
        <a
          href="#main-content"
          className="skip-link ui-button ui-button-primary"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
