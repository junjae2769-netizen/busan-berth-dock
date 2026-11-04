export type Terminal = "신선대" | "감만";

export interface BerthRecord {
  terminal: Terminal;
  berth: number;
  voyage: string;       // 모선항차 예: HAHM-14
  vessel: string;       // 선박명
  side: "S" | "P" | ""; // 접안현: S=우현, P=좌현
  operator: string;     // 선사 코드
  eta: string | null;   // 입항 예정일시 (ISO, KST)
  ata: string | null;   // 입항일시
  workEnd: string | null;
  etd: string | null;   // 출항일시
  cutoff: string | null;
  discharge: number;    // 양하
  load: number;         // 선적
  shift: number;        // S/H
  route: string;        // 항로
  quarantine: boolean;  // 검역
}

export interface BerthFeed {
  fetchedAt: string;
  source: "live" | "sample";
  error?: string;
  records: BerthRecord[];
}
