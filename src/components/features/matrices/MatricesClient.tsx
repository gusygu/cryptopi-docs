"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Matrix, { type MatrixCell } from "@/components/features/matrices/Matrix";
import MooAuxCard from "@/components/features/moo-aux/MooAuxCard";
import { withAlpha, type FrozenStage } from "@/components/features/matrices/colors";
import CinMatricesPanel from "@/components/features/cin-aux/CinMatricesPanel";

import {
  MUTED_BACKGROUND,
  NEGATIVE_SHADES,
  POSITIVE_SHADES,
  PREVIEW_RING_COLORS,
  FROZEN_RING_COLORS,
  SIGN_FLIP_RING_COLORS,
  loadPreviewSymbolSet,
  resolveCellPresentation,
  type MatrixColorRules,
} from "@/app/matrices/colouring";
import { useSettings, selectCoins } from "@/lib/settings/client";

const DEFAULT_POLL_MS = 40_000;
const defaultSessionId = process.env.NEXT_PUBLIC_CIN_DEFAULT_SESSION_ID || "";

// ... (todas as types, helpers, MATRIX_DESCRIPTORS, etc.)

function StatCard(/* ... */) { /* ... */ }

function EmptyState() { /* ... */ }

export default function MatricesClient() {
  // 👇 cola aqui o corpo inteiro do teu MatricesPage atual
  // (o que começa em `export default function MatricesPage() { ... }`)
}
