import iconv from "iconv-lite";
import type { BerthRecord, Terminal } from "./types";

const BPT_URL = "https://info.bptc.co.kr/Berth_status_text_servlet_sw_kr";

/** "2026/11/03 03:00" (KST) → ISO 문자열. 빈 값이면 null */
function toIso(s: string): string | null {
  const m = s.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
}

function num(s: string): number {
  const n = parseInt(s.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

/** BPT 선석배정 현황(T) HTML 표를 레코드 배열로 변환 */
export function parseBptHtml(html: string): BerthRecord[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const out: BerthRecord[] = [];
  for (const row of rows) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(strip);
    if (cells.length < 17) continue;
    if (cells[0] === "구분") continue; // 헤더
    const terminal = cells[0] as Terminal;
    if (terminal !== "신선대" && terminal !== "감만") continue;
    const sideRaw = cells[4].toUpperCase();
    out.push({
      terminal,
      berth: num(cells[1]),
      voyage: cells[2],
      vessel: cells[3],
      side: sideRaw === "S" || sideRaw === "P" ? sideRaw : "",
      operator: cells[5],
      eta: toIso(cells[6]),
      ata: toIso(cells[7]),
      workEnd: toIso(cells[8]),
      etd: toIso(cells[9]),
      cutoff: toIso(cells[10]),
      discharge: num(cells[11]),
      load: num(cells[12]),
      shift: num(cells[13]),
      route: cells[15],
      quarantine: cells[16].includes("검역"),
    });
  }
  return out;
}

/** BPT 정보조회서비스에서 최근 4일치 선석배정 현황을 받아온다 (EUC-KR) */
export async function fetchBptRecords(): Promise<BerthRecord[]> {
  const body = new URLSearchParams({
    v_time: "3days",
    v_gu: "A",
    ORDER: "item1",
    ROCD: "ALL",
    v_oper_cd: "",
  }).toString();

  const res = await fetch(BPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (busan-berth-dock game)",
      Referer: "https://info.bptc.co.kr/content/sw/frame/berth_status_text_frame_sw_kr.jsp",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`BPT 응답 오류 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const html = iconv.decode(buf, "euc-kr");
  const records = parseBptHtml(html);
  if (records.length === 0) throw new Error("BPT 표에서 레코드를 찾지 못함");
  return records;
}
