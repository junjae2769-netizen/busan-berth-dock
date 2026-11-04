import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "신선대·감만 접안 게임",
  description:
    "부산항터미널(BPT) 신선대·감만 선석배정 현황을 실시간으로 반영해, 다음 입항 선박을 배정 선석에 직접 접안시키는 아케이드 게임",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b1d2e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
