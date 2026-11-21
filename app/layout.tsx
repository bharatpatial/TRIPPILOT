import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "./context/AuthContext";
import { JourneyProvider } from "./context/JourneyContext";

export const metadata: Metadata = {
  title: "TripPilot",
  description:
    "AI travel planning with Zoya",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <JourneyProvider>{children}</JourneyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
