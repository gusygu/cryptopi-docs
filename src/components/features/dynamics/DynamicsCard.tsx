// src/components/features/dynamics/DynamicsCard.tsx
"use client";

import React from "react";
import { classNames } from "./utils";

export type DynamicsCardProps = {
  title: string;
  subtitle?: string;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
};

export function DynamicsCard({
  title,
  subtitle,
  status,
  actions,
  children,
  className,
  contentClassName,
}: DynamicsCardProps) {
  const hasStatus = !!status;
  const hasActions = !!actions;
  const headerAside =
    hasStatus || hasActions ? (
      <div
        className={classNames(
          "flex items-center gap-2 text-[11px] text-slate-300",
          "ml-auto min-h-[1.25rem]"
        )}
      >
        {hasStatus ? (
          typeof status === "string" ? (
            <span className="truncate" title={status}>
              {status}
            </span>
          ) : (
            status
          )
        ) : null}
        {hasActions ? <span className="flex items-center gap-2">{actions}</span> : null}
      </div>
    ) : null;

  return (
    <section className={classNames("cp-card flex h-full flex-col gap-4", className)}>
      <header className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100">{title}</div>
          {subtitle ? <div className="text-[11px] text-slate-400">{subtitle}</div> : null}
        </div>
        {headerAside}
      </header>
      <div className={classNames("flex-1 min-h-0", contentClassName)}>{children}</div>
    </section>
  );
}
