// DaisyUI 5: https://daisyui.com/components/alert/
import type { ReactNode } from "react";

type AlertTone = "error" | "success" | "warning" | "info";

type AlertProps = {
  readonly tone?: AlertTone;
  readonly children: ReactNode;
};

const alertClass: Record<AlertTone, string> = {
  error: "alert-error",
  success: "alert-success",
  warning: "alert-warning",
  info: "alert-info",
};

const alertIcon: Record<AlertTone, Readonly<{ d: string }>> = {
  error: {
    d: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  success: {
    d: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  warning: {
    d: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z",
  },
  info: {
    d: "M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z",
  },
};

export function Alert({ tone = "info", children }: AlertProps) {
  return (
    <div role="alert" className={`alert ${alertClass[tone]}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d={alertIcon[tone].d}
        />
      </svg>
      <span>{children}</span>
    </div>
  );
}
