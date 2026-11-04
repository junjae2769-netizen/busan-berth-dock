import type { BerthRecord } from "./types";

/**
 * BPT 접속이 안 될 때 쓰는 샘플. 2026-11-04 신선대·감만 실제 배정표를 바탕으로
 * 날짜만 '오늘' 기준으로 옮겨 넣는다.
 */
export function sampleRecords(now = new Date()): BerthRecord[] {
  const base = new Date(now);
  base.setMinutes(0, 0, 0);
  const at = (hoursFromNow: number): string => {
    const d = new Date(base.getTime() + hoursFromNow * 3600_000);
    return d.toISOString();
  };
  const mk = (
    terminal: "신선대" | "감만", berth: number, voyage: string, vessel: string,
    side: "S" | "P", operator: string, eta: number, etd: number,
    discharge: number, load: number, route: string, arrived: boolean,
  ): BerthRecord => ({
    terminal, berth, voyage, vessel, side, operator,
    eta: at(eta), ata: arrived ? at(eta) : null, workEnd: null, etd: at(etd),
    cutoff: at(eta - 14), discharge, load, shift: 0, route, quarantine: false,
  });
  return [
    mk("신선대", 1, "HSWH-53", "HANSUNG WEIHAI", "S", "SKR", -9, 6, 97, 117, "SKX1", true),
    mk("신선대", 2, "JHYA-39", "HE YANG", "S", "DYS", -20, 1, 372, 225, "BNJ", true),
    mk("신선대", 3, "SWPC-37", "SAWASDEE PACIFIC", "S", "SKR", -34, -3, 679, 531, "KQS", true),
    mk("신선대", 4, "SDTR-34", "SENDAI TRADER", "S", "SKR", -21, 4, 308, 577, "PVS2", true),
    mk("신선대", 5, "DJFT-47", "DONGJIN FORTUNE", "S", "DJS", -22, -2, 273, 313, "KJK", true),
    mk("감만", 6, "GNZA-8", "TS GUANGZHOU", "S", "TSL", -38, -2, 401, 450, "PAS", true),
    mk("감만", 7, "PVIC-41", "PANCON VICTORY", "S", "PCL", -24, -3, 483, 239, "KQP", true),
    mk("감만", 8, "FTLX-32", "FU TU LIAN XING", "S", "SIT", -18, 5, 382, 290, "CKS1", true),
    mk("신선대", 3, "HAHM-14", "HEUNG-A HOCHIMINH", "S", "HAS", 2, 20, 661, 600, "KVX", false),
    mk("신선대", 5, "KPRG-20", "PROGRESS", "P", "KMD", 3, 18, 250, 300, "JEK2", false),
    mk("감만", 6, "HAJN-42", "HEUNG-A JANICE", "S", "HAS", 5, 22, 413, 397, "CJV", false),
    mk("신선대", 2, "HTVY-44", "HAKATA VOYAGER", "S", "SKR", 6, 16, 250, 200, "JSW", false),
    mk("감만", 7, "EAOS-40", "EASLINE OSAKA", "P", "EAS", 8, 24, 500, 500, "CKT", false),
    mk("신선대", 1, "MJEP-60", "MOJI EXPRESS", "S", "SKR", 9, 17, 150, 150, "KMJ", false),
    mk("신선대", 4, "IEGA-9", "INTERASIA ENGAGE", "S", "IAL", 12, 30, 650, 400, "CJV2", false),
  ];
}
