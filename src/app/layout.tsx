import "./globals.css";

export const metadata = {
  title: "Sauron",
  description: "Sentry error auto-investigator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
