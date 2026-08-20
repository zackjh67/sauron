export const metadata = {
  title: "fixer",
  description: "Sentry error auto-investigator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
