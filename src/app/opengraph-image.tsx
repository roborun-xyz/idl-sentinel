import { ImageResponse } from "next/og";

export const alt = "IDL Sentinel: Solana program IDL change monitoring";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#0a0a0a",
        color: "#fafafa",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 20,
            height: 20,
            background: "#fafafa",
            borderRadius: 4,
          }}
        />
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: -0.5 }}>IDL Sentinel</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2 }}>
          Know when a Solana program&apos;s interface changes.
        </div>
        <div style={{ fontSize: 30, color: "#a3a3a3", lineHeight: 1.4 }}>
          On-chain IDL polling, versioned snapshots, severity-classified diffs, and Slack or
          Telegram alerts.
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 24, color: "#a3a3a3" }}>
        {["critical", "high", "medium", "low"].map((level, index) => (
          <div key={level} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: ["#ef4444", "#f97316", "#eab308", "#3b82f6"][index],
              }}
            />
            <div>{level}</div>
          </div>
        ))}
      </div>
    </div>,
    size
  );
}
