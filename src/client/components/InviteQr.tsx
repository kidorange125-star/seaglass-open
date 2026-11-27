// The invite link as a QR code, made on the device (the link holds the invite code, so it never goes to a QR service).
// A phone's camera opens the join screen straight away.
import qrcode from "qrcode-generator";
import { useMemo } from "react";

export function InviteQr({ link, size = 168 }: { link: string; size?: number }) {
  const { path, n } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(link);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { path: d, n };
  }, [link]);
  // Dark modules on white with a 4-module quiet zone, in light and dark themes alike (scanners need the contrast).
  return (
    <svg className="hh-qr" width={size} height={size} viewBox={`0 0 ${n + 8} ${n + 8}`} role="img" aria-label="QR code for the invite link" shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill="#fff" rx="2" />
      <path d={path} fill="#0d2a30" />
    </svg>
  );
}
