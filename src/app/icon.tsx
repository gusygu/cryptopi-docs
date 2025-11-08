// src/app/icon.tsx
import { ImageResponse } from "next/og";

// 32×32 minimal dark circle with “Cπ”
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b1020",
          color: "#9ad5ff",
          fontSize: 18,
          borderRadius: 8,
          fontWeight: 700,
        }}
      >
        Cπ
      </div>
    ),
    size
  );
}
